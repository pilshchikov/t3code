import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/unstable/reactivity";
import { createElement } from "react";

export let appAtomRegistry = AtomRegistry.make();

export function AppAtomRegistryProvider({ children }: React.PropsWithChildren) {
  return createElement(RegistryContext.Provider, { value: appAtomRegistry }, children);
}

/** Replaces the process-wide registry so isolated hook tests cannot leak atoms between cases. */
export function resetAppAtomRegistryForTests(): void {
  appAtomRegistry.dispose();
  appAtomRegistry = AtomRegistry.make();
}
