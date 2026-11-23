import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, PeerOrchestrationCall } from "@t3tools/contracts";
import { WS_METHODS } from "@t3tools/contracts";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "./atomRegistry";

const command = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:peer-orchestration-call",
  tag: WS_METHODS.peerOrchestrationCall,
  concurrency: { mode: "parallel" },
});

/** Loaded lazily by the relay because the command runtime includes that relay. */
export const perform = (environmentId: EnvironmentId, input: PeerOrchestrationCall) =>
  command.run(appAtomRegistry, { environmentId, input });
