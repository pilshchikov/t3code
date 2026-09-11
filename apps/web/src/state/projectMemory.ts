import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";
import { connectionAtomRuntime } from "../connection/runtime";

export const projectMemory = {
  list: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "project-memory:list",
    tag: WS_METHODS.projectMemoryList,
    staleTimeMs: 0,
    refreshIntervalMs: 15_000,
  }),
  read: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "project-memory:read",
    tag: WS_METHODS.projectMemoryRead,
  }),
  save: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "project-memory:save",
    tag: WS_METHODS.projectMemorySave,
  }),
  remove: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "project-memory:remove",
    tag: WS_METHODS.projectMemoryRemove,
  }),
};
