import { EnvironmentSupervisor } from "@t3tools/client-runtime/connection";
import { request } from "@t3tools/client-runtime/rpc";
import {
  OrchestratorMcpFailure,
  WS_METHODS,
  type PeerEnvironmentReadInput,
} from "@t3tools/contracts";
import { peerEnvironmentSnapshot } from "@t3tools/shared/peerEnvironmentSnapshot";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

export const readPeerEnvironment = Effect.fn("web.peerEnvironment.read")(function* (
  input: PeerEnvironmentReadInput,
) {
  const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
  if (supervisor.target.environmentId !== input.environmentId)
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "The environment request reached a different connection.",
    });
  const config = yield* request(WS_METHODS.serverGetConfig, {}).pipe(
    Effect.catchTags({
      EnvironmentAuthorizationError: () =>
        Effect.fail(
          new OrchestratorMcpFailure({
            code: "capability_denied",
            message:
              "The app connection does not grant permission to read this environment. Ask the owner to grant orchestration:read access.",
          }),
        ),
    }),
  );
  if (config.environment.environmentId !== input.environmentId)
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "The connected server reported a different environment identity.",
    });
  const projects =
    input.includeProjects === false
      ? []
      : yield* Effect.gen(function* () {
          // Lazy: shell state uses the connection runtime that owns this relay.
          const [{ environmentShell }, { appAtomRegistry }, { waitForAtomValue }] =
            yield* Effect.promise(() =>
              Promise.all([
                import("../state/shell"),
                import("../rpc/atomRegistry"),
                import("../state/waitForAtomValue"),
              ]),
            );
          const atom = environmentShell.stateValueAtom(input.environmentId);
          const live = yield* Effect.promise(() =>
            waitForAtomValue({
              registry: appAtomRegistry,
              atom,
              predicate: (state) => state.status === "live" && Option.isSome(state.snapshot),
              timeoutMs: 10000,
            }),
          );
          const state = appAtomRegistry.get(atom);
          if (!live || state.status !== "live" || Option.isNone(state.snapshot))
            return yield* new OrchestratorMcpFailure({
              code: "orchestration_error",
              message:
                "The app has not synchronized this environment's projects yet. Keep both environments connected and try again, or pass includeProjects:false to inspect its models.",
            });
          return state.snapshot.value.projects;
        });
  return peerEnvironmentSnapshot(config, projects, input, DateTime.formatIso(yield* DateTime.now));
});
