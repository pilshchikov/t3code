import { createContext, use, type ReactNode } from "react";

const OpenAddProjectCommandPaletteContext = createContext<(() => void) | null>(null);
const OpenCommandPaletteContext = createContext<(() => void) | null>(null);

export function OpenAddProjectCommandPaletteProvider(props: {
  readonly children: ReactNode;
  readonly openAddProject: () => void;
  readonly openCommandPalette: () => void;
}) {
  return (
    <OpenCommandPaletteContext value={props.openCommandPalette}>
      <OpenAddProjectCommandPaletteContext value={props.openAddProject}>
        {props.children}
      </OpenAddProjectCommandPaletteContext>
    </OpenCommandPaletteContext>
  );
}

export function useOpenCommandPalette(): () => void {
  const openCommandPalette = use(OpenCommandPaletteContext);
  if (!openCommandPalette) {
    throw new Error("Command palette actions must be used inside CommandPalette");
  }
  return openCommandPalette;
}

export function useOpenAddProjectCommandPalette(): () => void {
  const openAddProject = use(OpenAddProjectCommandPaletteContext);
  if (!openAddProject) {
    throw new Error("Command palette actions must be used inside CommandPalette");
  }
  return openAddProject;
}

/** Read at event time so the chat tree does not subscribe to transient dialog state. */
export function isCommandPaletteOpen(): boolean {
  return (
    typeof document !== "undefined" && document.querySelector("[data-command-palette]") !== null
  );
}
