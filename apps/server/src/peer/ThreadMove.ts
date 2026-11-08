// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import {
  CommandId,
  type EnvironmentId,
  type OrchestrationV2HistoricalMessage,
  OrchestratorMcpFailure,
  type PeerThreadMoveInput,
  type PeerThreadMoveRequest,
  type PeerThreadMoveResult,
  type ProjectId,
} from "@t3tools/contracts";
import {
  historicalMessage,
  renderHistory,
  selectHistory,
} from "@t3tools/provider-core/server/handoffBudget";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Tool from "effect/ai/Tool";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import { ProjectToolkit } from "../mcp/toolkits/project/tools.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { normalizeRelativePath } from "../peers/PeerFiles.ts";
import * as PeerOrchestration from "../peers/PeerOrchestration.ts";
import * as Peers from "../peers/Peers.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as PeerForwarding from "./PeerForwarding.ts";
import * as RemoteDelegation from "./RemoteDelegation.ts";

// The launch message caps at 120000 characters; the note and the user's message share the rest.
const HISTORY_BUDGET_BYTES = 90_000;
const HISTORY_KINDS = new Set(["user_message", "assistant_message", "proposed_plan"]);

export class ThreadMove extends Context.Service<
  ThreadMove,
  {
    /**
     * Continues a thread as a new one in another project, here or on another
     * environment: copies the named files there, hands the conversation over in
     * the first message, and archives the old thread when it is idle.
     */
    readonly move: (
      scope: McpInvocationContext.McpInvocationScope,
      input: PeerThreadMoveInput,
    ) => Effect.Effect<PeerThreadMoveResult, OrchestratorMcpFailure>;
    /** `move` for the user of a connected app, at the thread's own modes. */
    readonly moveForUser: (
      input: PeerThreadMoveRequest,
    ) => Effect.Effect<PeerThreadMoveResult, OrchestratorMcpFailure>;
  }
>()("t3/peer/ThreadMove") {}

const movedThreadPrompt = (input: {
  readonly from: { readonly label: string; readonly environmentId: EnvironmentId };
  readonly sameEnvironment: boolean;
  readonly oldThread: { readonly title: string; readonly link: string };
  readonly fromFolder: string | null;
  readonly branch: string | null;
  readonly toFolder: string;
  readonly copied: ReadonlyArray<string>;
  readonly history: ReadonlyArray<OrchestrationV2HistoricalMessage>;
  readonly coverage: string;
  readonly message: string | undefined;
}) => {
  const where = input.sameEnvironment
    ? `another project on this machine`
    : `${input.from.label} (environmentId ${input.from.environmentId})`;
  const files = input.sameEnvironment
    ? input.fromFolder === null
      ? []
      : [`The old folder is still on this machine at ${input.fromFolder}; read from it directly.`]
    : [
        ...(input.copied.length === 0
          ? []
          : [`Copied here into ${input.toFolder}: ${input.copied.join(", ")}.`]),
        `Anything else from there is not here. Fetch it with t3_peer_copy (direction from_peer, environment ${input.from.environmentId}), or through Git when it is committed and pushed.`,
      ];
  const lines = [
    `This thread moved here from ${where}. The previous thread is "${input.oldThread.title}": ${input.oldThread.link}`,
    `${input.fromFolder === null ? "It had no folder" : `It worked in ${input.fromFolder}`}${input.branch === null ? "" : ` on branch ${input.branch}`}. You now work in ${input.toFolder}.`,
    ...files,
    "Its conversation follows. Continue the work from where it stopped; do not redo finished steps.",
    ...(input.message === undefined || input.message.trim() === ""
      ? []
      : [`Next: ${input.message.trim()}`]),
  ];
  const selected = selectHistory({
    messages: input.history,
    coverage: input.coverage,
    budget: HISTORY_BUDGET_BYTES,
  });
  return `${lines.join("\n")}\n\n${renderHistory(selected.messages, selected.context)}`;
};

const failure = (code: OrchestratorMcpFailure["code"], message: string) =>
  new OrchestratorMcpFailure({ code, message });

const decodeLaunch = Schema.decodeUnknownEffect(
  ProjectToolkit.tools.t3_thread_launch.successSchema,
);
const encodeLaunch = Schema.encodeUnknownEffect(
  ProjectToolkit.tools.t3_thread_launch.parametersSchema,
);
const decodeProject = Schema.decodeUnknownEffect(
  ProjectToolkit.tools.t3_project_read.successSchema,
);

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const forwarding = yield* PeerForwarding.PeerForwarding;
  const delegation = yield* RemoteDelegation.RemoteDelegation;
  const local = yield* PeerOrchestration.PeerOrchestration;
  const relay = yield* Effect.serviceOption(Peers.Peers);
  const environment = yield* ServerEnvironment.ServerEnvironment;

  const undecodable = () => failure("orchestration_error", "The move's local call did not decode.");
  const invokeHere = <A, E>(
    scope: McpInvocationContext.McpInvocationScope,
    tool: "t3_thread_launch" | "t3_project_read",
    encoded: Record<string, unknown>,
    decode: (value: unknown) => Effect.Effect<A, E>,
  ) =>
    local
      .invoke(scope, tool, encoded)
      .pipe(Effect.flatMap((value) => decode(value).pipe(Effect.mapError(undecodable))));

  const move: ThreadMove["Service"]["move"] = Effect.fn("ThreadMove.move")(
    function* (scope, input) {
      const threadId = input.threadId ?? scope.thread?.threadId;
      if (threadId === undefined)
        return yield* failure("invalid_request", "Pass threadId: there is no calling thread.");
      const shell = yield* threads
        .getThreadShell(threadId)
        .pipe(Effect.mapError(() => failure("thread_not_found", "The thread was not found.")));
      if (shell === null || shell.deletedAt !== null)
        return yield* failure("thread_not_found", "The thread was not found.");
      const sameEnvironment = input.environmentId === scope.environmentId;
      if (sameEnvironment && (input.projectId === undefined || input.projectId === shell.projectId))
        return yield* failure(
          "invalid_request",
          "The thread is already in this project. Pass another projectId, or another environmentId.",
        );
      if (sameEnvironment && (input.copyPaths?.length ?? 0) > 0)
        return yield* failure(
          "invalid_request",
          "copyPaths is for another machine. On this one, read the old folder directly.",
        );
      const copyPaths: Array<string> = [];
      for (const path of input.copyPaths ?? []) {
        const normalized = normalizeRelativePath(path);
        if (normalized === undefined)
          return yield* failure(
            "invalid_request",
            `copyPaths must be relative to the thread's folder, without "..": ${path}`,
          );
        copyPaths.push(normalized);
      }

      const projectId: ProjectId = sameEnvironment
        ? input.projectId!
        : yield* delegation.resolveProject(
            scope,
            input.environmentId,
            shell.projectId,
            input.projectId,
            "projectId",
          );
      const destination: Tool.Success<typeof ProjectToolkit.tools.t3_project_read> = sameEnvironment
        ? yield* invokeHere(scope, "t3_project_read", { projectId }, decodeProject)
        : yield* forwarding.call(scope, ProjectToolkit.tools.t3_project_read, input.environmentId, {
            projectId,
          });
      const here = yield* projects.getById(shell.projectId).pipe(
        Effect.map(Option.getOrUndefined),
        Effect.orElseSucceed(() => undefined),
      );
      const fromFolder = shell.worktreePath ?? here?.workspaceRoot ?? null;

      const copied: Array<{ path: string; files: number; bytes: number }> = [];
      if (copyPaths.length > 0) {
        if (fromFolder === null)
          return yield* failure("invalid_request", "This thread has no folder to copy from.");
        if (Option.isNone(relay))
          return yield* failure("invalid_request", "File copy needs the app relay.");
        for (const path of copyPaths) {
          const result = yield* relay.value
            .copy({
              environmentId: input.environmentId,
              direction: "to_peer",
              localPath: NodePath.join(fromFolder, path),
              peerPath: NodePath.posix.join(destination.workspaceRoot, path),
              overwrite: false,
            })
            .pipe(
              Effect.mapError((error) =>
                failure("orchestration_error", `Copying ${path} failed: ${error.message}`),
              ),
            );
          copied.push({ path, files: result.files, bytes: result.bytes });
        }
      }

      const records = yield* threads
        .getThreadRecords(threadId, ["turnItems"])
        .pipe(Effect.mapError(() => failure("thread_not_found", "The thread was not found.")));
      const history = records.turnItems
        .filter((item) => HISTORY_KINDS.has(item.type))
        .flatMap((item) => {
          const message = historicalMessage(item);
          return message === null ? [] : [message];
        });
      const descriptor = yield* environment.getDescriptor;
      const message = movedThreadPrompt({
        from: { label: descriptor.label, environmentId: scope.environmentId },
        sameEnvironment,
        oldThread: {
          title: shell.title,
          link: McpInvocationContext.threadLinkFor(scope, threadId),
        },
        fromFolder,
        branch: shell.branch,
        toFolder: destination.workspaceRoot,
        copied: copied.map((entry) => entry.path),
        history,
        coverage: `Conversation of thread ${threadId} ("${shell.title}").`,
        message: input.message,
      });
      const launch = {
        projectId,
        title: shell.title,
        modelSelection: shell.modelSelection,
        runtimeMode: shell.runtimeMode,
        interactionMode: shell.interactionMode,
        message,
        clientRequestId: `move:${threadId}:${input.environmentId}:${projectId}`,
      };
      const launched = sameEnvironment
        ? yield* invokeHere(
            scope,
            "t3_thread_launch",
            (yield* encodeLaunch(launch).pipe(Effect.mapError(undecodable))) as Record<
              string,
              unknown
            >,
            decodeLaunch,
          )
        : yield* forwarding.call(
            scope,
            ProjectToolkit.tools.t3_thread_launch,
            input.environmentId,
            launch,
          );

      // A running thread, the caller's own included, stays: archiving would cut its turn off.
      const sourceArchived =
        (input.archiveSource ?? true) && shell.activeRunId === null
          ? yield* threads
              .dispatch({
                type: "thread.archive",
                commandId: CommandId.make(`move:${threadId}:${launched.threadId}:archive`),
                threadId,
              })
              .pipe(
                Effect.as(true),
                Effect.orElseSucceed(() => false),
              )
          : false;
      return {
        threadId: launched.threadId,
        environmentId: input.environmentId,
        projectId: launched.projectId,
        ...(launched.link === undefined ? {} : { link: launched.link }),
        copied,
        sourceArchived,
      };
    },
  );

  const moveForUser: ThreadMove["Service"]["moveForUser"] = Effect.fn("ThreadMove.moveForUser")(
    function* (input) {
      const self = yield* environment.getEnvironmentId;
      const shell = yield* threads
        .getThreadShell(input.threadId)
        .pipe(Effect.mapError(() => failure("thread_not_found", "The thread was not found.")));
      if (shell === null) return yield* failure("thread_not_found", "The thread was not found.");
      const namespace = `app-move:${input.threadId}`;
      return yield* move(
        {
          environmentId: self,
          requestNamespace: namespace,
          capabilities: new Set(["orchestration"]),
          issuedAt: 0,
          thread: undefined,
          client: {
            sessionId: namespace,
            label: "T3 Code",
            access: shell.runtimeMode,
            narrowedTo: { runtimeMode: shell.runtimeMode, interactionMode: shell.interactionMode },
          },
        },
        input,
      );
    },
  );

  return ThreadMove.of({ move, moveForUser });
});

export const layer = Layer.effect(ThreadMove, make);
