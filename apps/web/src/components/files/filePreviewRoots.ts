import type { ProjectWorkspace } from "@t3tools/contracts";

/**
 * The first project directory follows the thread's active checkout. Secondary
 * directories keep their configured roots because they may be unrelated repos.
 */
export function resolveFilePreviewRoots(
  activePrimaryRoot: string,
  configuredRoots: ReadonlyArray<ProjectWorkspace> | undefined,
): ReadonlyArray<ProjectWorkspace> {
  if (!configuredRoots?.length) {
    return [{ path: activePrimaryRoot, label: "Primary directory" }];
  }

  return [
    { ...configuredRoots[0], path: activePrimaryRoot },
    ...configuredRoots.slice(1).filter((root) => root.path !== activePrimaryRoot),
  ];
}
