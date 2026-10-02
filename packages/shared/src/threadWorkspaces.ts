import type { ProjectWorkspace, ThreadWorkspaceSelection } from "@t3tools/contracts";

export interface SelectedProjectWorkspace extends ProjectWorkspace {
  /** Configured repository identity, independent of its selected checkout. */
  readonly workspaceRoot: string;
  readonly branch: string | null;
  readonly primary: boolean;
}

export function resolveThreadWorkspaces(
  project: {
    readonly workspaceRoot: string;
    readonly workspaceRoots?: ReadonlyArray<ProjectWorkspace> | undefined;
  },
  thread: {
    readonly worktreePath: string | null;
    readonly branch: string | null;
    readonly workspaceSelections?: ReadonlyArray<ThreadWorkspaceSelection> | undefined;
  },
): ReadonlyArray<SelectedProjectWorkspace> {
  const roots = project.workspaceRoots ?? [];
  const primary = roots.find((root) => root.path === project.workspaceRoot) ?? {
    path: project.workspaceRoot,
  };
  const configured = [primary, ...roots.filter((root) => root.path !== project.workspaceRoot)];
  return configured.map((root) => {
    const primary = root.path === project.workspaceRoot;
    const selected = thread.workspaceSelections?.find(
      (selection) => selection.workspaceRoot === root.path,
    );
    return {
      ...root,
      workspaceRoot: root.path,
      path: primary ? (thread.worktreePath ?? root.path) : (selected?.cwd ?? root.path),
      branch: primary ? thread.branch : (selected?.branch ?? null),
      primary,
    };
  });
}

/** Instructions are injected every turn so resumed sessions see newer selections. */
export function threadWorkspaceInstructions(
  roots: ReadonlyArray<SelectedProjectWorkspace>,
  hasControls: boolean,
): string {
  if (roots.length < 2 && !hasControls) return "";
  return `\n\n<project-workspaces>\nSelected directories for this thread:\n${roots
    .map(
      (root) =>
        `- ${root.primary ? "primary" : (root.label ?? "additional repository")}: repository ${root.workspaceRoot}; selected cwd ${root.path}${root.branch ? `; branch ${root.branch}` : ""}`,
    )
    .join(
      "\n",
    )}\nUse each repository's selected absolute cwd for its commands and file operations. ${
    hasControls
      ? "Use thread_workspace_inspect with workspaceRoot to inspect a specific repository (omit it for the primary). To change repos' checkouts, call thread_workspace_select with workspaceRoot and path or branch, or thread_workspace_create with workspaceRoot, mode: worktree and branch BEFORE editing. These tools update this thread's Files selectors; simply running cd or git worktree add does not update them. Select each repository independently, then use the returned cwd."
      : "Keep work in these selected checkouts."
  }\n</project-workspaces>`;
}
