import type { ProjectWorkspace, VcsRef } from "@t3tools/contracts";

export interface FileWorktreeOption {
  readonly path: string;
  readonly refName: string | null;
  readonly current: boolean;
}

function comparablePath(path: string): string {
  const withoutTrailingSeparators = path.replace(/[\\/]+$/, "");
  return withoutTrailingSeparators.length > 0 ? withoutTrailingSeparators : path;
}

/**
 * Turns the local refs response into one entry per live checkout. The active
 * directory remains selectable when it is a standalone clone rather than a
 * linked Git worktree.
 */
export function resolveFileWorktreeOptions(
  activeCwd: string,
  refs: ReadonlyArray<Pick<VcsRef, "current" | "name" | "worktreePath">>,
): ReadonlyArray<FileWorktreeOption> {
  const activePath = comparablePath(activeCwd);
  const byPath = new Map<string, FileWorktreeOption>();

  for (const ref of refs) {
    if (ref.worktreePath === null) continue;
    const key = comparablePath(ref.worktreePath);
    if (byPath.has(key)) continue;
    byPath.set(key, {
      path: ref.worktreePath,
      refName: ref.name,
      current: ref.current || key === activePath,
    });
  }

  if (!byPath.has(activePath)) {
    byPath.set(activePath, { path: activeCwd, refName: null, current: true });
  }

  return [...byPath.values()].toSorted(
    (left, right) =>
      Number(right.current) - Number(left.current) ||
      (left.refName ?? left.path).localeCompare(right.refName ?? right.path),
  );
}

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
