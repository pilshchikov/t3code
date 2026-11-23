import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { type EnvironmentId, WS_METHODS } from "@t3tools/contracts";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "./atomRegistry";

const command = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:peer-usage-refresh",
  tag: WS_METHODS.serverRefreshProviders,
  concurrency: { mode: "singleFlight", key: ({ environmentId }) => environmentId },
});

// Lazy-loaded by the relay: its command runtime includes the relay itself.
export const refresh = (environmentId: EnvironmentId) =>
  command.run(appAtomRegistry, { environmentId, input: { fresh: true } });
