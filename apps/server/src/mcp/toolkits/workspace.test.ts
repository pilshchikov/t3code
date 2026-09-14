import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/unstable/ai";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { MultiworkService } from "../../multiwork/MultiworkService.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { CheckpointStore } from "../../checkpointing/CheckpointStore.ts";
import { McpInvocationContext, type McpCapability } from "../McpInvocationContext.ts";
import {
  setMcpProviderSession,
  clearMcpProviderSession,
  readMcpWorkspaceOverride,
} from "../McpProviderSession.ts";
import { WorkspaceHandlersLive, WorkspaceToolkit } from "./workspace.ts";

const threadId = ThreadId.make("workspace-test");
const projectId = ProjectId.make("workspace-project");
const turnId = TurnId.make("workspace-turn");
const providerInstanceId = ProviderInstanceId.make("claude");
const makeHarness = Effect.fn("makeWorkspaceHarness")(function* () {
  const commands: Array<OrchestrationCommand> = [];
  const creations: Array<unknown> = [];
  const captures: Array<string> = [];
  const now = "2026-09-13T00:00:00.000Z";
  let thread: OrchestrationThreadShell = {
    id: threadId,
    projectId,
    title: "Test",
    branch: "main",
    worktreePath: null,
    modelSelection: { instanceId: providerInstanceId, model: "test" },
    runtimeMode: "full-access",
    interactionMode: "default",
    pullRequests: [],
    latestTurn: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledAt: null,
    settledOverride: null,
    session: {
      threadId,
      providerName: "claudeAgent",
      providerInstanceId,
      runtimeMode: "full-access",
      status: "running",
      activeTurnId: turnId,
      lastError: null,
      updatedAt: now,
    },
    latestUserMessageAt: now,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
  const scope = {
    environmentId: EnvironmentId.make("test"),
    threadId,
    providerSessionId: "session-test",
    providerInstanceId,
    issuedAt: 1,
  };
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      setMcpProviderSession({
        ...scope,
        capabilities: new Set(["workspace"]),
        endpoint: "http://test",
        authorizationHeader: "test",
      }),
    ),
    () => Effect.sync(() => clearMcpProviderSession(threadId)),
  );
  const deps = Layer.mergeAll(
    Path.layer,
    Layer.succeed(
      Crypto.Crypto,
      Crypto.make({
        randomBytes: (size) => new Uint8Array(size).fill(4),
        digest: (_, data) => Effect.succeed(data),
      }),
    ),
    Layer.mock(ServerSettingsService)({ getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS) }),
    Layer.mock(ProjectionSnapshotQuery)({
      getThreadShellById: (id) =>
        Effect.sync(() => (id === threadId ? Option.some({ ...thread }) : Option.none())),
      getThreadCheckpointContext: () =>
        Effect.sync(() =>
          Option.some({
            threadId,
            projectId,
            workspaceRoot: "/repo",
            worktreePath: thread.worktreePath,
            checkpoints: [],
          }),
        ),
      getProjectShellById: () =>
        Effect.succeed(
          Option.some({
            id: projectId,
            title: "Project",
            workspaceRoot: "/repo",
            defaultModelSelection: null,
            scripts: [],
            repositoryIdentity: null,
            createdAt: now,
            updatedAt: now,
          }),
        ),
    }),
    Layer.mock(OrchestrationEngineService)({
      dispatch: (command) =>
        Effect.sync(() => {
          commands.push(command);
          if (command.type === "thread.meta.update")
            thread = {
              ...thread,
              branch: command.branch ?? null,
              worktreePath: command.worktreePath ?? null,
            };
          return { sequence: commands.length };
        }),
    }),
    Layer.mock(GitWorkflowService)({
      localStatus: ({ cwd }) =>
        Effect.succeed({
          isRepo: true,
          hasPrimaryRemote: true,
          isDefaultRef: cwd === "/repo",
          refName: cwd === "/repo" ? "main" : "task",
          hasWorkingTreeChanges: false,
          workingTree: { files: [], insertions: 0, deletions: 0 },
        }),
      listRefs: ({ cursor }) =>
        Effect.succeed({
          isRepo: true,
          hasPrimaryRemote: true,
          totalCount: 2,
          nextCursor: cursor === undefined ? 1 : null,
          refs: [
            {
              name: cursor === undefined ? "main" : "task",
              current: cursor === undefined,
              isDefault: cursor === undefined,
              worktreePath: cursor === undefined ? "/repo" : "/worktrees/task",
            },
          ],
        }),
      createWorktree: (input) =>
        Effect.sync(() => {
          creations.push(input);
          return {
            worktree: { path: "/worktrees/new", refName: input.newRefName ?? input.refName },
          };
        }),
      invalidateStatus: () => Effect.void,
    }),
    Layer.mock(MultiworkService)({
      list: () =>
        Effect.succeed({
          baseDirectory: "/copies",
          copies: [{ path: "/copies/task", name: "task", branch: "task" }],
        }),
      create: (input) =>
        Effect.sync(() => {
          creations.push(input);
          return {
            path: "/copies/new",
            branch: input.branch,
            projectName: "Project",
            reused: false,
          };
        }),
    }),
    Layer.mock(CheckpointStore)({
      hasCheckpointRef: () => Effect.succeed(false),
      captureCheckpoint: ({ cwd }) =>
        Effect.sync(() => {
          captures.push(cwd);
        }),
    }),
  );
  const toolkit = yield* WorkspaceToolkit.pipe(
    Effect.provide(WorkspaceHandlersLive.pipe(Layer.provide(deps))),
  );
  const call = <Name extends keyof typeof WorkspaceToolkit.tools>(
    name: Name,
    input: Parameters<typeof toolkit.handle<Name>>[1],
    capabilities: ReadonlyArray<McpCapability> = ["workspace"],
  ) =>
    toolkit.handle(name, input).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map(
        (chunk) => chunk.at(-1)!.result as Tool.Success<(typeof WorkspaceToolkit.tools)[Name]>,
      ),
      Effect.provideService(McpInvocationContext, {
        ...scope,
        capabilities: new Set(capabilities),
      }),
      Effect.provide(deps),
    );
  return { call, commands, creations, captures };
});

describe("thread workspace MCP", () => {
  it.effect("rejects ambiguous selection and unsupported multiwork bases without changes", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      for (const input of [{}, { path: "/repo", branch: "main" }]) {
        const error = yield* h.call("thread_workspace_select", input).pipe(Effect.flip);
        expect(error.message).toContain("exactly one");
      }
      yield* h
        .call("thread_workspace_create", { mode: "multiwork", branch: "task", baseRef: "release" })
        .pipe(Effect.flip);
      expect(h.commands).toEqual([]);
      expect(h.creations).toEqual([]);
    }).pipe(Effect.scoped),
  );
  it.effect("inspects without mutation and preserves ref pagination", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const result = yield* h.call("thread_workspace_inspect", {});
      expect(result.cwd).toBe("/repo");
      expect(result.refs.nextCursor).toBe(1);
      expect(result.multiwork.copies[0]?.path).toBe("/copies/task");
      expect(h.commands).toEqual([]);
    }).pipe(Effect.scoped),
  );
  it.effect("creates from the requested base and selects only the token's thread", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const result = yield* h.call("thread_workspace_create", {
        mode: "worktree",
        branch: "task",
        baseRef: "release",
      });
      expect(h.creations).toEqual([
        { cwd: "/repo", refName: "release", newRefName: "task", path: null },
      ]);
      expect(h.commands[0]).toMatchObject({
        type: "thread.meta.update",
        threadId,
        worktreePath: "/worktrees/new",
        branch: "task",
      });
      expect(h.captures).toEqual(["/worktrees/new"]);
      expect(readMcpWorkspaceOverride(threadId, turnId)).toBe(result.cwd);
      expect(readMcpWorkspaceOverride(threadId, "next-turn")).toBeUndefined();
      expect(result.instructions).toContain("previous directory");
    }).pipe(Effect.scoped),
  );
  it.effect("creates a multiwork copy using the configured directory", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const result = yield* h.call("thread_workspace_create", {
        mode: "multiwork",
        branch: "task",
      });
      expect(result.cwd).toBe("/copies/new");
      expect(h.creations[0]).toMatchObject({
        cwd: "/repo",
        branch: "task",
        baseDirectory: DEFAULT_SERVER_SETTINGS.multiworkBaseDirectory,
      });
    }).pipe(Effect.scoped),
  );
  it.effect("selects older worktrees across ref pages and can return to the project root", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      expect((yield* h.call("thread_workspace_select", { branch: "task" })).cwd).toBe(
        "/worktrees/task",
      );
      expect(h.creations).toEqual([]);
      yield* h.call("thread_workspace_select", { path: "/repo/" });
      expect(h.commands.at(-1)).toMatchObject({ worktreePath: null, branch: "main" });
    }).pipe(Effect.scoped),
  );
  it.effect("selects existing multiwork copies but rejects unrelated directories", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      yield* h.call("thread_workspace_select", { path: "/copies/task" });
      expect(h.commands).toHaveLength(1);
      const error = yield* h
        .call("thread_workspace_select", { path: "/unrelated/repo" })
        .pipe(Effect.flip);
      expect(error.message).toContain("not a checkout");
      expect(h.commands).toHaveLength(1);
    }).pipe(Effect.scoped),
  );
  it.effect("rejects missing capabilities and stale sessions before any mutation", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      yield* h
        .call("thread_workspace_create", { mode: "worktree", branch: "task" }, [])
        .pipe(Effect.flip);
      clearMcpProviderSession(threadId);
      const error = yield* h
        .call("thread_workspace_create", { mode: "worktree", branch: "task" })
        .pipe(Effect.flip);
      expect(error.message).toContain("no longer active");
      expect(h.commands).toEqual([]);
      expect(h.creations).toEqual([]);
    }).pipe(Effect.scoped),
  );
});
