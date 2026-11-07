import { OrchestratorMcpFailure, type PeerOrchestrationCall } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Tool, Toolkit } from "effect/ai";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import * as ProjectHandlers from "../mcp/toolkits/project/handlers.ts";
import { ProjectToolkit } from "../mcp/toolkits/project/tools.ts";
import * as OrchestratorHandlers from "../mcp/toolkits/orchestrator/handlers.ts";
import { OrchestratorToolkit } from "../mcp/toolkits/orchestrator/tools.ts";
import * as ServerSettings from "../serverSettings.ts";

const toolkit = Toolkit.make(
  ProjectToolkit.tools.t3_thread_launch,
  ProjectToolkit.tools.t3_project_list,
  OrchestratorToolkit.tools.orchestrator_capabilities,
  OrchestratorToolkit.tools.t3_thread_read,
  OrchestratorToolkit.tools.t3_thread_wait,
  OrchestratorToolkit.tools.t3_thread_interrupt,
);
type Dependencies = Tool.HandlerServices<(typeof toolkit.tools)[keyof typeof toolkit.tools]>;
const decodeFailure = Schema.decodeUnknownOption(OrchestratorMcpFailure);

/** Authenticated app connections relay calls; each tool still runs its normal access checks. */
export class PeerOrchestration extends Context.Service<
  PeerOrchestration,
  {
    readonly call: (input: PeerOrchestrationCall) => Effect.Effect<unknown, OrchestratorMcpFailure>;
  }
>()("t3/peers/PeerOrchestration") {}

const make = Effect.gen(function* () {
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const settings = yield* ServerSettings.ServerSettingsService;
  const built = yield* toolkit;
  const dependencies =
    yield* Effect.context<Exclude<Dependencies, McpInvocationContext.McpInvocationContext>>();
  const call: PeerOrchestration["Service"]["call"] = Effect.fn("PeerOrchestration.call")(
    function* (input) {
      const self = yield* environment.getEnvironmentId;
      if (input.environmentId !== self || input.sourceEnvironmentId === self)
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "This relay request reached a different environment.",
        });
      // Never relay again or claim uploads owned by another server.
      if (
        input.arguments.environmentId !== undefined ||
        (Array.isArray(input.arguments.attachments) && input.arguments.attachments.length > 0)
      )
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message:
            "Relay calls cannot forward another target or carry attachment IDs. Copy files with t3_peer_copy.",
        });
      const namespace = `relay:${input.sourceEnvironmentId}:${input.requestNamespace}`;
      const scope = McpInvocationContext.withRuntimeModeCeiling(
        {
          environmentId: self,
          requestNamespace: namespace,
          capabilities: new Set(["orchestration"]),
          issuedAt: 0,
          thread: undefined,
          client: {
            sessionId: namespace,
            label: `T3 Code · ${input.sourceEnvironmentId}`,
            access: input.runtimeMode,
            linked: true,
            narrowedTo: { runtimeMode: input.runtimeMode, interactionMode: input.interactionMode },
          },
        },
        settings.managedPolicy?.limits?.maxRuntimeMode,
      );
      const output = yield* built.handle(input.tool, input.arguments as never).pipe(
        Stream.unwrap,
        Stream.filter((part) => !part.preliminary),
        Stream.runHead,
        Effect.provide(dependencies),
        Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
        Effect.mapError(
          () =>
            new OrchestratorMcpFailure({
              code: "invalid_request",
              message: "The relay call did not match the destination tool schema.",
            }),
        ),
      );
      if (Option.isNone(output))
        return yield* new OrchestratorMcpFailure({
          code: "orchestration_error",
          message: "The destination tool returned no result.",
        });
      if (output.value.isFailure) {
        const failure = decodeFailure(output.value.encodedResult);
        return yield* Option.isSome(failure)
          ? failure.value
          : new OrchestratorMcpFailure({
              code: "orchestration_error",
              message: "The destination could not complete the relay call.",
            });
      }
      return output.value.encodedResult;
    },
  );
  return PeerOrchestration.of({ call });
});

export const layer = Layer.effect(PeerOrchestration, make).pipe(
  Layer.provide(
    Layer.merge(
      McpToolAccess.HandlersLayer.layer(ProjectHandlers.layer),
      McpToolAccess.HandlersLayer.layer(OrchestratorHandlers.layer),
    ),
  ),
);
