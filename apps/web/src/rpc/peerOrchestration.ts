import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, PeerOrchestrationCall } from "@t3tools/contracts";
import { WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "./atomRegistry";

const command = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:peer-orchestration-call",
  tag: WS_METHODS.peerOrchestrationCall,
  concurrency: { mode: "parallel" },
});

/** Loaded lazily by the relay because the command runtime includes that relay. */
export const perform = (environmentId: EnvironmentId, input: PeerOrchestrationCall) =>
  Effect.promise(() => command.run(appAtomRegistry, { environmentId, input })).pipe(
    Effect.flatMap((result) =>
      result._tag === "Success" ? Effect.succeed(result.value) : Effect.failCause(result.cause),
    ),
  );
