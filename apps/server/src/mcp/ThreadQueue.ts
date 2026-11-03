import {
  CommandId,
  OrchestratorMcpFailure,
  isProviderNativeSubagentThread,
  type RunId,
  type OrchestrationV2Command,
  type ThreadQueueInput,
  type ThreadQueueResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { queuedRunsInDeliveryOrder } from "../orchestration-v2/QueuedRunOrder.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { McpInvocationContext, type McpInvocationScope } from "./McpInvocationContext.ts";
import {
  readThread as readQueueThread,
  assertLiveCaller as assertQueueCaller,
  assertTargetWithinLimits,
  dispatchFailure,
} from "./threadAccess.ts";

const failure = (code: OrchestratorMcpFailure["code"], message: string) =>
  new OrchestratorMcpFailure({ code, message });
export class ThreadQueue extends Context.Service<
  ThreadQueue,
  {
    readonly manage: (
      scope: McpInvocationScope,
      input: ThreadQueueInput,
    ) => Effect.Effect<ThreadQueueResult, OrchestratorMcpFailure>;
  }
>()("t3/mcp/ThreadQueue") {}
const make = Effect.gen(function* () {
  const random = yield* SecureRandom.SecureRandom;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  return ThreadQueue.of({
    manage: Effect.fn("ThreadQueue.manage")(function* (scope, input) {
      return yield* Effect.gen(function* () {
        const context = yield* readQueueThread(input.threadId, ["runs"]);
        const { projection } = context;
        const required = <A>(value: A | undefined, field: string) =>
          value === undefined
            ? Effect.fail(failure("invalid_request", `This action needs ${field}.`))
            : Effect.succeed(value);
        const queued = projection.runs.filter(
          (run) =>
            run.status === "queued" && (input.action !== "read" || run.id === input.queuedRunId),
        );
        const messages =
          input.action === "list" || input.action === "read"
            ? (yield* threadManagement
                .getProjectThreadRecords(
                  { projectId: projection.thread.projectId, threadId: projection.thread.id },
                  ["messages"],
                  {
                    messageIds: queued.flatMap((run) =>
                      run.userMessageId === null ? [] : [run.userMessageId],
                    ),
                  },
                )
                .pipe(
                  Effect.mapError(() =>
                    failure("orchestration_error", "Unable to read queued messages."),
                  ),
                )).messages
            : [];
        const ordered = queuedRunsInDeliveryOrder({ runs: queued, messages });
        const start = input.cursor ?? 0,
          end = start + (input.limit ?? 20);
        const selected = ordered.slice(start, end);
        const entry = (runId: RunId, limit: number) => {
          const run = projection.runs.find((run) => run.id === runId && run.status === "queued");
          const message = messages.find((message) => message.id === run?.userMessageId);
          if (!run || !message) return undefined;
          const chars = Array.from(message.text);
          return {
            queuedRunId: run.id,
            messageId: message.id,
            text: chars.slice(0, limit).join(""),
            truncated: chars.length > limit,
          };
        };
        if (input.action === "list") {
          return {
            items: selected.flatMap((run) => {
              const item = entry(run.id, 1000);
              return item ? [item] : [];
            }),
            nextCursor: end < ordered.length ? end : null,
            activeRunId: ThreadManagementService.latestActiveRun(projection)?.id ?? null,
          };
        }
        const runId = yield* required(input.queuedRunId, "queuedRunId");
        if (input.action === "read")
          return (
            entry(runId, 16000) ??
            (yield* failure("invalid_request", "The queued message was not found."))
          );
        if (scope.client?.access === "read-only")
          return yield* failure("capability_denied", "This client has read-only access.");
        yield* assertQueueCaller(context);
        yield* assertTargetWithinLimits(context.limits, projection.thread);
        if (isProviderNativeSubagentThread(projection.thread))
          return yield* failure(
            "thread_not_sendable",
            "Use the provider's native messaging tools for this subagent.",
          );
        const common = {
          threadId: projection.thread.id,
          commandId: CommandId.make(
            [
              "command",
              "mcp-queue",
              scope.requestNamespace,
              input.action,
              input.clientRequestId ?? (yield* random.uuidV4()),
            ]
              .map(encodeURIComponent)
              .join(":"),
          ),
        };
        let command: OrchestrationV2Command;
        switch (input.action) {
          case "edit":
            command = {
              ...common,
              type: "queued-run.edit",
              runId,
              text: yield* required(input.text, "text"),
            };
            break;
          case "reorder":
            command = {
              ...common,
              type: "queued-run.reorder",
              runId,
              beforeRunId: yield* required(input.beforeRunId, "beforeRunId"),
            };
            break;
          case "promote_to_steer":
            command = {
              ...common,
              type: "queued-message.promote-to-steer",
              queuedRunId: runId,
              targetRunId: yield* required(input.targetRunId, "targetRunId"),
            };
            break;
          default:
            command = { ...common, type: "queued-run.cancel", runId };
        }
        const result = yield* threadManagement
          .dispatch(command)
          .pipe(Effect.mapError(dispatchFailure));
        return { sequence: result.sequence };
      }).pipe(
        Effect.provideService(McpInvocationContext, scope),
        Effect.provideService(ThreadManagementService.ThreadManagementService, threadManagement),
      );
    }),
  });
});
export const layer = Layer.effect(ThreadQueue, make);
