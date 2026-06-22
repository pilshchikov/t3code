import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

export function createMultiworkEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:multiwork:create",
      tag: WS_METHODS.multiworkCreate,
    }),
    list: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:multiwork:list",
      tag: WS_METHODS.multiworkList,
    }),
  };
}
