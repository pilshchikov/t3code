import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, PeerThreadOperation } from "@t3tools/contracts";
import { WS_METHODS } from "@t3tools/contracts";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "./atomRegistry";

const command = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:peer-thread-request",
  tag: WS_METHODS.peerThreadsRequest,
  concurrency: { mode: "parallel" },
});

/** Loaded lazily by the relay because the command runtime includes that relay. */
export const perform = (environmentId: EnvironmentId, input: PeerThreadOperation) =>
  command.run(appAtomRegistry, { environmentId, input });
