import { FolderGit2Icon, FolderGitIcon, FolderIcon, FoldersIcon, HistoryIcon } from "lucide-react";
import { memo, useMemo } from "react";
import type { EnvironmentId, MultiworkCopy } from "@t3tools/contracts";
import { multiworkEnvironment } from "../state/multiwork";
import { useEnvironmentQuery } from "../state/query";

import { cn } from "../lib/utils";

import {
  isExplicitWorkspaceModeSelectionReason,
  resolveCurrentWorkspaceLabel,
  resolveEnvModeLabel,
  resolveLockedWorkspaceLabel,
  type EnvMode,
} from "./BranchToolbar.logic";
import { composerFloatingLayerProps } from "./chat/composerEventScope";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

const PREVIOUS_WORKTREE_SELECT_VALUE = "previous-worktree";

interface BranchToolbarEnvModeSelectorProps {
  multiworkTarget?: {
    environmentId: EnvironmentId;
    cwd: string;
    onSelect: (copy: MultiworkCopy) => void;
  };
  envLocked: boolean;
  effectiveEnvMode: EnvMode;
  activeWorktreePath: string | null;
  compact?: boolean;
  onEnvModeChange: (mode: EnvMode) => void;
  previousWorktreeLabel?: string | null;
  onUsePreviousWorktree?: () => void;
}

export const BranchToolbarEnvModeSelector = memo(function BranchToolbarEnvModeSelector({
  envLocked,
  effectiveEnvMode,
  activeWorktreePath,
  compact = false,
  onEnvModeChange,
  previousWorktreeLabel,
  onUsePreviousWorktree,
  multiworkTarget,
}: BranchToolbarEnvModeSelectorProps) {
  const copies = useEnvironmentQuery(
    multiworkTarget && !envLocked
      ? multiworkEnvironment.copies({
          environmentId: multiworkTarget.environmentId,
          input: { cwd: multiworkTarget.cwd },
        })
      : null,
  );
  const showPreviousWorktree = Boolean(previousWorktreeLabel && onUsePreviousWorktree);
  const envModeItems = useMemo(
    () => [
      { value: "local", label: resolveCurrentWorkspaceLabel(activeWorktreePath) },
      { value: "worktree", label: resolveEnvModeLabel("worktree") },
      ...(showPreviousWorktree && previousWorktreeLabel
        ? [{ value: PREVIOUS_WORKTREE_SELECT_VALUE, label: previousWorktreeLabel }]
        : []),
      { value: "multiwork", label: resolveEnvModeLabel("multiwork") },
      ...(copies.data?.copies ?? []).map((copy) => ({
        value: `copy:${copy.path}`,
        label: copy.branch || copy.name,
      })),
    ],
    [activeWorktreePath, previousWorktreeLabel, showPreviousWorktree, copies.data],
  );

  if (envLocked) {
    return (
      <span
        className={cn(
          "inline-flex h-7 shrink-0 items-center gap-1 border border-transparent px-[calc(--spacing(3)-1px)] text-sm font-medium text-muted-foreground/70 sm:h-6 sm:text-xs",
          compact && "max-w-28 truncate",
        )}
        data-composer-context-control
      >
        {activeWorktreePath ? (
          <>
            <FolderGitIcon className="size-3" />
            {resolveLockedWorkspaceLabel(activeWorktreePath)}
          </>
        ) : (
          <>
            <FolderIcon className="size-3" />
            {resolveLockedWorkspaceLabel(activeWorktreePath)}
          </>
        )}
      </span>
    );
  }

  return (
    <Select
      modal={false}
      onOpenChange={(open) => {
        if (open) copies.refresh();
      }}
      value={
        copies.data?.copies.some((copy) => copy.path === activeWorktreePath)
          ? `copy:${activeWorktreePath}`
          : effectiveEnvMode
      }
      onValueChange={(value: string | null, eventDetails) => {
        if (!isExplicitWorkspaceModeSelectionReason(eventDetails.reason)) return;
        if (value?.startsWith("copy:")) {
          const copy = copies.data?.copies.find((item) => `copy:${item.path}` === value);
          if (copy) multiworkTarget?.onSelect(copy);
          return;
        }
        if (value === PREVIOUS_WORKTREE_SELECT_VALUE) {
          onUsePreviousWorktree?.();
          return;
        }
        onEnvModeChange(value as EnvMode);
      }}
      items={envModeItems}
    >
      <SelectTrigger
        variant="ghost"
        size="xs"
        className={cn("min-w-0 shrink font-medium", compact && "max-w-28")}
        aria-label="Workspace"
        data-composer-context-control
      >
        {effectiveEnvMode === "worktree" ? (
          <FolderGit2Icon className="size-3" />
        ) : activeWorktreePath ? (
          <FolderGitIcon className="size-3" />
        ) : (
          <FolderIcon className="size-3" />
        )}
        <span
          data-composer-label
          className={cn(
            "min-w-0 max-w-[240px] group-data-[compact]/composer-context:max-w-0",
            compact && "max-w-20",
          )}
        >
          <span
            data-composer-label-motion
            className={cn(
              "block w-full min-w-0 max-w-[240px] truncate transition-opacity duration-180 ease-[cubic-bezier(0.32,0.72,0,1)] group-data-[compact]/composer-context:opacity-0 motion-reduce:transition-opacity",
              compact && "max-w-20",
            )}
          >
            <SelectValue />
          </span>
        </span>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false} {...composerFloatingLayerProps}>
        <SelectGroup>
          <SelectGroupLabel>Workspace</SelectGroupLabel>
          <SelectItem value="local">
            <span className="inline-flex items-center gap-1.5">
              {activeWorktreePath ? (
                <FolderGitIcon className="size-3" />
              ) : (
                <FolderIcon className="size-3" />
              )}
              {resolveCurrentWorkspaceLabel(activeWorktreePath)}
            </span>
          </SelectItem>
          <SelectItem value="worktree">
            <span className="inline-flex items-center gap-1.5">
              <FolderGit2Icon className="size-3" />
              {resolveEnvModeLabel("worktree")}
            </span>
          </SelectItem>
          {showPreviousWorktree && previousWorktreeLabel ? (
            <SelectItem value={PREVIOUS_WORKTREE_SELECT_VALUE}>
              <span className="inline-flex items-center gap-1.5">
                <HistoryIcon className="size-3" />
                {previousWorktreeLabel}
              </span>
            </SelectItem>
          ) : null}
          <SelectItem value="multiwork">
            <span className="inline-flex items-center gap-1.5">
              <FoldersIcon className="size-3" />
              {resolveEnvModeLabel("multiwork")}
            </span>
          </SelectItem>
        </SelectGroup>
        {multiworkTarget && (
          <SelectGroup>
            <SelectGroupLabel>Existing multiwork copies</SelectGroupLabel>
            {copies.error && <p className="px-2 text-xs text-destructive">{copies.error}</p>}
            {copies.data?.copies.map((copy) => (
              <SelectItem key={copy.path} value={`copy:${copy.path}`}>
                <span className="block max-w-64 truncate" title={copy.path}>
                  {copy.branch || copy.name}
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectPopup>
    </Select>
  );
});
