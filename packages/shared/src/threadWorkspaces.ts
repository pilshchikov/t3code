import type {
  OrchestrationV2ThreadShell,
  ProjectFolderSettings,
  ProjectTrackedFolder,
  ProjectWorkspaceColor,
  TaskFolder,
  ThreadWorkspaceSelection,
} from "@t3tools/contracts";

export const PRIMARY_WORKSPACE_BUSY_MESSAGE =
  "The primary checkout cannot change while this thread has active or background work. Wait for it to finish or press Stop first.";

/** Work bound to the current provider cwd must survive ordinary checkout selection. */
export function threadHasWorkspaceBoundWork(
  thread:
    | Pick<
        OrchestrationV2ThreadShell,
        "activityRunStatus" | "pendingBackgroundTasks" | "pendingRuntimeRequest"
      >
    | null
    | undefined,
): boolean {
  return (
    thread != null &&
    (thread.activityRunStatus != null ||
      thread.pendingRuntimeRequest != null ||
      (thread.pendingBackgroundTasks?.length ?? 0) > 0)
  );
}

export interface SelectedProjectWorkspace {
  readonly path: string;
  /** The folder as the project stores it, independent of its selected checkout. */
  readonly workspaceRoot: string;
  readonly name?: string | undefined;
  readonly color?: ProjectWorkspaceColor | undefined;
  readonly agentGuidance?: string | undefined;
  readonly branch: string | null;
  readonly primary: boolean;
  /** Its worktree is in the thread's task folder, so it moves with the thread, not on its own. */
  readonly followsTaskFolder: boolean;
}

export function resolveThreadWorkspaces(
  project: {
    readonly workspaceRoot: string;
    readonly trackedFolders?: ReadonlyArray<ProjectTrackedFolder> | undefined;
    readonly folderSettings?: ReadonlyArray<ProjectFolderSettings> | undefined;
  },
  thread: {
    readonly worktreePath: string | null;
    readonly branch: string | null;
    readonly workspaceSelections?: ReadonlyArray<ThreadWorkspaceSelection> | undefined;
  },
  taskFolder?: Pick<TaskFolder, "repositories"> | null,
): ReadonlyArray<SelectedProjectWorkspace> {
  const settings = (path: string) => {
    const entry = project.folderSettings?.find((candidate) => candidate.path === path);
    return {
      ...(entry?.color === undefined ? {} : { color: entry.color }),
      ...(entry?.agentGuidance === undefined ? {} : { agentGuidance: entry.agentGuidance }),
    };
  };
  const primary: SelectedProjectWorkspace = {
    ...settings(project.workspaceRoot),
    workspaceRoot: project.workspaceRoot,
    path: thread.worktreePath ?? project.workspaceRoot,
    branch: thread.branch,
    primary: true,
    followsTaskFolder: false,
  };
  return [
    primary,
    ...(project.trackedFolders ?? []).map((folder): SelectedProjectWorkspace => {
      const inTaskFolder = taskFolder?.repositories.find(
        (repository) => repository.repositoryPath === folder.path,
      );
      const selected = thread.workspaceSelections?.find(
        (selection) => selection.workspaceRoot === folder.path,
      );
      return {
        ...settings(folder.path),
        workspaceRoot: folder.path,
        name: folder.name,
        path: inTaskFolder?.worktreePath ?? selected?.cwd ?? folder.path,
        branch: inTaskFolder === undefined ? (selected?.branch ?? null) : thread.branch,
        primary: false,
        followsTaskFolder: inTaskFolder !== undefined,
      };
    }),
  ];
}

/** Instructions are injected every turn so resumed sessions see newer selections. */
export function threadWorkspaceInstructions(
  roots: ReadonlyArray<SelectedProjectWorkspace>,
  hasControls: boolean,
): string {
  const selected = roots.filter(
    (root) => !root.primary && !root.followsTaskFolder && root.path !== root.workspaceRoot,
  );
  if (selected.length === 0 && !hasControls) return "";
  const listed =
    selected.length === 0
      ? ""
      : `Selected checkouts for this thread:\n${selected
          .map(
            (root) =>
              `- ${root.name ?? "repository"}: repository ${root.workspaceRoot}; selected cwd ${root.path}${root.branch ? `; branch ${root.branch}` : ""}`,
          )
          .join(
            "\n",
          )}\nUse each repository's selected absolute cwd for its commands and file operations. `;
  return `\n\n<project-workspaces>\n${listed}${
    hasControls
      ? `Use thread_workspace_inspect with workspaceRoot to inspect a specific repository (omit it for the primary). For additional repositories, call thread_workspace_select with workspaceRoot and path or branch, or thread_workspace_create with workspaceRoot, mode: worktree and branch BEFORE editing. These tools update this thread's Files selectors; simply running cd or git worktree add does not update them. Select each additional repository independently, then use the returned cwd.${roots.some((root) => root.followsTaskFolder) ? " Repositories in this thread's task folder follow the thread and cannot be selected separately." : ""} The primary checkout is pinned while a turn, question, or background task is active: do not use thread_workspace_create/select to move your own running session. From the project root, use t3_worktree_handoff as the last action with continuationPrompt to resume automatically. If already in a primary worktree, keep this binding and use another checkout's absolute cwd, or launch a separate thread with t3_thread_launch and workspaceStrategy.`
      : "Keep work in these selected checkouts."
  }\n</project-workspaces>`;
}
