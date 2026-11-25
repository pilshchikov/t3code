import type { VcsRef } from "@t3tools/contracts";

export interface FileWorktreeOption {
  readonly path: string;
  readonly refName: string | null;
  readonly current: boolean;
  readonly lastCommitAt: number | null;
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
  refs: ReadonlyArray<Pick<VcsRef, "current" | "lastCommitAt" | "name" | "worktreePath">>,
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
      current: key === activePath,
      lastCommitAt: ref.lastCommitAt ?? null,
    });
  }

  if (!byPath.has(activePath)) {
    byPath.set(activePath, {
      path: activeCwd,
      refName: null,
      current: true,
      lastCommitAt: null,
    });
  }

  return [...byPath.values()].toSorted(
    (left, right) =>
      (right.lastCommitAt ?? -1) - (left.lastCommitAt ?? -1) ||
      Number(right.current) - Number(left.current) ||
      (left.refName ?? left.path).localeCompare(right.refName ?? right.path),
  );
}
