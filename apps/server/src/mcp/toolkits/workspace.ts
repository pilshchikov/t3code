import {
  CommandId,
  MultiworkListResult,
  VcsListRefsResult,
  VcsStatusLocalResult,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { Tool, Toolkit } from "effect/unstable/ai";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { MultiworkService } from "../../multiwork/MultiworkService.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { McpInvocationContext, requireMcpCapability } from "../McpInvocationContext.ts";
import { readMcpProviderSession, setMcpWorkspaceOverride } from "../McpProviderSession.ts";
import { CheckpointStore } from "../../checkpointing/CheckpointStore.ts";
import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";

export class ThreadWorkspaceError extends Schema.TaggedError<ThreadWorkspaceError>()(
  "ThreadWorkspaceError",
  { message: Schema.String },
) {}

const selection = Schema.Struct({
  cwd: Schema.String,
  branch: Schema.NullOr(Schema.String),
  instructions: Schema.String,
});
const dependencies = [McpInvocationContext];
const inspect = Tool.make("thread_workspace_inspect", {
  description:
    "Inspect this thread's selected checkout, project root, local changes, branches/worktrees, and existing multiwork copies. Follow nextCursor to list more refs. Does not change anything.",
  parameters: Schema.Struct({
    cursor: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  }),
  success: Schema.Struct({
    projectRoot: Schema.String,
    cwd: Schema.String,
    status: VcsStatusLocalResult,
    refs: VcsListRefsResult,
    multiwork: MultiworkListResult,
  }),
  failure: ThreadWorkspaceError,
  dependencies,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const create = Tool.make("thread_workspace_create", {
  description:
    "Create a named branch in a new worktree or multiwork copy and select it for this thread in T3 Code. Use before editing. Worktree baseRef defaults to HEAD; multiwork uses the project's normal clone base. Uncommitted files are not transferred. Run setup yourself if needed. The running agent must use the returned cwd explicitly until its next turn.",
  parameters: Schema.Struct({
    mode: Schema.Literals(["worktree", "multiwork"]),
    branch: TrimmedNonEmptyString,
    baseRef: Schema.optional(TrimmedNonEmptyString),
  }),
  success: selection,
  failure: ThreadWorkspaceError,
  dependencies,
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false);
const select = Tool.make("thread_workspace_select", {
  description:
    "Select an existing checkout for this thread. Provide a path from thread_workspace_inspect, or a branch name to use its worktree (creating a linked worktree if needed). No force checkout, deletion, or moving uncommitted files. The running agent must use the returned cwd explicitly until its next turn.",
  parameters: Schema.Struct({
    path: Schema.optional(TrimmedNonEmptyString),
    branch: Schema.optional(TrimmedNonEmptyString),
  }),
  success: selection,
  failure: ThreadWorkspaceError,
  dependencies,
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false);
export const WorkspaceToolkit = Toolkit.make(inspect, create, select);

export const WorkspaceHandlersLive = WorkspaceToolkit.toLayer(
  Effect.gen(function* () {
    const git = yield* GitWorkflowService;
    const multiwork = yield* MultiworkService;
    const snapshots = yield* ProjectionSnapshotQuery;
    const engine = yield* OrchestrationEngineService;
    const settings = yield* ServerSettingsService;
    const crypto = yield* Crypto.Crypto;
    const path = yield* Path.Path;
    const mutations = yield* Semaphore.make(1);
    const checkpoints = yield* CheckpointStore;
    const fail = (message: string) => Effect.fail(new ThreadWorkspaceError({ message }));
    const wrap = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ThreadWorkspaceError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        ),
      );
    const context = Effect.gen(function* () {
      const scope = yield* requireMcpCapability("workspace");
      if (readMcpProviderSession(scope.threadId)?.providerSessionId !== scope.providerSessionId) {
        return yield* fail(
          "This MCP session is no longer active. Retry from the current provider session.",
        );
      }
      const thread = yield* snapshots.getThreadShellById(scope.threadId);
      if (Option.isNone(thread)) return yield* fail("Thread not found.");
      const project = yield* snapshots.getProjectShellById(thread.value.projectId);
      if (Option.isNone(project)) return yield* fail("Project not found.");
      return {
        thread: thread.value,
        project: project.value,
        cwd: thread.value.worktreePath ?? project.value.workspaceRoot,
        baseDirectory: (yield* settings.getSettings).multiworkBaseDirectory,
      };
    });
    type WorkspaceContext = Effect.Success<typeof context>;
    const copies = (ctx: WorkspaceContext) =>
      multiwork.list({
        cwd: ctx.project.workspaceRoot,
        baseDirectory: ctx.baseDirectory,
      });
    const attach = Effect.fn("WorkspaceToolkit.attach")(function* (
      ctx: WorkspaceContext,
      cwd: string,
    ) {
      const scope = yield* requireMcpCapability("workspace");
      if (readMcpProviderSession(scope.threadId)?.providerSessionId !== scope.providerSessionId) {
        return yield* fail(
          `Provider session changed while preparing ${cwd}. The checkout was kept; inspect again from the current session.`,
        );
      }
      const current = yield* snapshots.getThreadShellById(ctx.thread.id);
      if (
        Option.isNone(current) ||
        current.value.worktreePath !== ctx.thread.worktreePath ||
        current.value.branch !== ctx.thread.branch
      ) {
        return yield* fail(
          `Thread selection changed while preparing ${cwd}. The checkout was kept; inspect again before selecting it.`,
        );
      }
      const status = yield* git.localStatus({ cwd });
      if (!status.isRepo) return yield* fail("The selected checkout is not a repository.");
      const detail = yield* snapshots.getThreadCheckpointContext(ctx.thread.id);
      if (Option.isNone(detail)) return yield* fail("Thread not found.");
      const turnId = current.value.session?.activeTurnId;
      if (turnId) {
        const turnCount = detail.value.checkpoints.reduce(
          (count, checkpoint) =>
            checkpoint.turnId === turnId ? count : Math.max(count, checkpoint.checkpointTurnCount),
          0,
        );
        const checkpointRef = checkpointRefForThreadTurn(ctx.thread.id, turnCount);
        if (!(yield* checkpoints.hasCheckpointRef({ cwd, checkpointRef }))) {
          yield* checkpoints.captureCheckpoint({ cwd, checkpointRef });
        }
      }
      yield* engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make(
          `server:mcp-workspace:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`,
        ),
        threadId: ctx.thread.id,
        expectedBranch: ctx.thread.branch,
        expectedWorktreePath: ctx.thread.worktreePath,
        branch: status.refName,
        worktreePath: path.resolve(cwd) === path.resolve(ctx.project.workspaceRoot) ? null : cwd,
      });
      if (turnId) setMcpWorkspaceOverride(ctx.thread.id, cwd, turnId);
      yield* git.invalidateStatus(cwd);
      return {
        cwd,
        branch: status.refName,
        instructions:
          "T3 Code now selects this checkout for this thread. Your running tools still default to the previous directory: use this absolute cwd for every command and file operation now. The provider restarts in this cwd on the next turn. Existing terminals and other threads are unchanged. No uncommitted files were moved and no setup script was run.",
      };
    });
    return WorkspaceToolkit.of({
      thread_workspace_inspect: (input) =>
        wrap(
          Effect.gen(function* () {
            const ctx = yield* context;
            return {
              projectRoot: ctx.project.workspaceRoot,
              cwd: ctx.cwd,
              status: yield* git.localStatus({ cwd: ctx.cwd }),
              refs: yield* git.listRefs({ cwd: ctx.cwd, ...input }),
              multiwork: yield* copies(ctx),
            };
          }),
        ),
      thread_workspace_create: (input) =>
        wrap(
          mutations.withPermit(
            Effect.gen(function* () {
              const ctx = yield* context;
              if (input.mode === "multiwork" && input.baseRef !== undefined) {
                return yield* fail(
                  "Multiwork uses the configured clone base. To choose a baseRef, use worktree mode.",
                );
              }
              const cwd =
                input.mode === "multiwork"
                  ? (yield* multiwork.create({
                      cwd: ctx.project.workspaceRoot,
                      branch: input.branch,
                      baseDirectory: ctx.baseDirectory,
                    })).path
                  : (yield* git.createWorktree({
                      cwd: ctx.cwd,
                      refName: input.baseRef ?? "HEAD",
                      newRefName: input.branch,
                      path: null,
                    })).worktree.path;
              return yield* attach(ctx, cwd);
            }),
          ),
        ),
      thread_workspace_select: (input) =>
        wrap(
          mutations.withPermit(
            Effect.gen(function* () {
              const ctx = yield* context;
              // Fetch every page so selection never silently rejects an older worktree.
              if ((input.path === undefined) === (input.branch === undefined)) {
                return yield* fail("Provide exactly one of path or branch.");
              }
              const refs: Array<VcsListRefsResult["refs"][number]> = [];
              let cursor: number | undefined;
              do {
                const page = yield* git.listRefs({
                  cwd: ctx.cwd,
                  ...(cursor === undefined ? {} : { cursor }),
                });
                refs.push(...page.refs);
                cursor = page.nextCursor ?? undefined;
              } while (cursor !== undefined);
              if (input.branch !== undefined) {
                const ref = refs.find((ref) => ref.name === input.branch);
                if (!ref) return yield* fail("Unknown branch. Inspect available refs first.");
                const cwd =
                  ref.worktreePath ??
                  (yield* git.createWorktree({ cwd: ctx.cwd, refName: ref.name, path: null }))
                    .worktree.path;
                return yield* attach(ctx, cwd);
              }
              const allowed = [
                ctx.project.workspaceRoot,
                ctx.cwd,
                ...refs.flatMap((ref) => (ref.worktreePath ? [ref.worktreePath] : [])),
                ...(yield* copies(ctx)).copies.map((copy) => copy.path),
              ];
              const requestedPath = input.path;
              if (requestedPath === undefined) return yield* fail("Provide a checkout path.");
              const cwd = allowed.find(
                (candidate) => path.resolve(candidate) === path.resolve(requestedPath),
              );
              if (!cwd)
                return yield* fail(
                  "Path is not a checkout of this thread's project. Inspect available checkouts first.",
                );
              return yield* attach(ctx, cwd);
            }),
          ),
        ),
    });
  }),
);
