import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createMultiworkEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    copies: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:multiwork:copies",
      tag: WS_METHODS.multiworkList,
      staleTimeMs: 30_000,
    }),
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
