import type { EnvironmentId, GitChangeKind, GitFileChange } from "@t3tools/contracts";
import { RefreshCw, RotateCcw, Sparkles } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { cn } from "~/lib/utils";

import {
  commitGitStaged,
  discardGitChanges,
  generateGitCommitMessage,
  stageGitFiles,
  unstageGitFiles,
  useGitDetailedStatus,
} from "./gitChangesState";

interface GitChangesPanelProps {
  environmentId: EnvironmentId;
  cwd: string;
  onOpenFile: (relativePath: string) => void;
}

interface StatusBadge {
  readonly letter: string;
  readonly color: string;
  readonly label: string;
}

const STATUS_BADGE_BY_KIND: Readonly<Record<GitChangeKind, StatusBadge>> = {
  modified: { letter: "M", color: "#4c9ffe", label: "Modified" },
  added: { letter: "A", color: "#3fb950", label: "Added" },
  deleted: { letter: "D", color: "#f85149", label: "Deleted" },
  renamed: { letter: "R", color: "#d29922", label: "Renamed" },
  copied: { letter: "C", color: "#d29922", label: "Copied" },
  typechange: { letter: "T", color: "#d29922", label: "Type changed" },
  unmerged: { letter: "U", color: "#f85149", label: "Unmerged" },
  untracked: { letter: "A", color: "#3fb950", label: "New file" },
};

function badgeForFile(file: GitFileChange): StatusBadge {
  const kind = file.untracked
    ? "untracked"
    : (file.indexStatus ?? file.worktreeStatus ?? "modified");
  return STATUS_BADGE_BY_KIND[kind];
}

function splitPath(path: string): { name: string; directory: string } {
  const slash = path.lastIndexOf("/");
  return slash >= 0
    ? { name: path.slice(slash + 1), directory: path.slice(0, slash) }
    : { name: path, directory: "" };
}

function GitChangeRow({
  file,
  busy,
  onToggleStage,
  onDiscard,
  onOpen,
}: {
  file: GitFileChange;
  busy: boolean;
  onToggleStage: (file: GitFileChange) => void;
  onDiscard: (file: GitFileChange) => void;
  onOpen: (file: GitFileChange) => void;
}) {
  const fullyStaged = file.staged && !file.unstaged;
  const partiallyStaged = file.staged && file.unstaged;
  const badge = badgeForFile(file);
  const { name, directory } = splitPath(file.path);
  const renameFrom = file.origPath ? splitPath(file.origPath).name : null;

  return (
    <div className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-accent/60">
      <input
        type="checkbox"
        className="size-3.5 shrink-0 cursor-pointer accent-[#4c9ffe]"
        checked={fullyStaged}
        ref={(element) => {
          if (element) element.indeterminate = partiallyStaged;
        }}
        disabled={busy}
        aria-label={file.staged ? `Unstage ${file.path}` : `Stage ${file.path}`}
        onChange={() => onToggleStage(file)}
      />
      <span
        className="flex size-4 shrink-0 items-center justify-center rounded-sm text-[10px] font-bold"
        style={{ color: badge.color }}
        title={badge.label}
        aria-hidden="true"
      >
        {badge.letter}
      </span>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
        onClick={() => onOpen(file)}
      >
        <span className="truncate text-xs text-foreground">{name}</span>
        {renameFrom && renameFrom !== name ? (
          <span className="shrink-0 truncate text-[10px] text-muted-foreground">
            ← {renameFrom}
          </span>
        ) : null}
        {directory ? (
          <span className="truncate text-[10px] text-muted-foreground">{directory}</span>
        ) : null}
      </button>
      <button
        type="button"
        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        disabled={busy}
        aria-label={`Discard changes to ${file.path}`}
        title="Discard changes"
        onClick={() => onDiscard(file)}
      >
        <RotateCcw className="size-3" />
      </button>
    </div>
  );
}

function GitChangeGroup({
  title,
  files,
  busy,
  onToggleAll,
  allStaged,
  onToggleStage,
  onDiscard,
  onOpen,
}: {
  title: string;
  files: ReadonlyArray<GitFileChange>;
  busy: boolean;
  allStaged: boolean;
  onToggleAll: (files: ReadonlyArray<GitFileChange>, stage: boolean) => void;
  onToggleStage: (file: GitFileChange) => void;
  onDiscard: (file: GitFileChange) => void;
  onOpen: (file: GitFileChange) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-2 py-1">
        <input
          type="checkbox"
          className="size-3.5 shrink-0 cursor-pointer accent-[#4c9ffe]"
          checked={allStaged}
          disabled={busy}
          aria-label={allStaged ? `Unstage all ${title}` : `Stage all ${title}`}
          onChange={() => onToggleAll(files, !allStaged)}
        />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
          {title}
        </span>
        <span className="text-[10px] text-muted-foreground">{files.length}</span>
      </div>
      {files.map((file) => (
        <GitChangeRow
          key={file.path}
          file={file}
          busy={busy}
          onToggleStage={onToggleStage}
          onDiscard={onDiscard}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

export default function GitChangesPanel({ environmentId, cwd, onOpenFile }: GitChangesPanelProps) {
  const status = useGitDetailedStatus(environmentId, cwd);
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const files = status.data?.files ?? [];
  const { changes, unversioned } = useMemo(() => {
    const tracked: GitFileChange[] = [];
    const untracked: GitFileChange[] = [];
    for (const file of files) {
      (file.untracked ? untracked : tracked).push(file);
    }
    return { changes: tracked, unversioned: untracked };
  }, [files]);

  const stagedCount = useMemo(() => files.filter((file) => file.staged).length, [files]);
  const changesAllStaged =
    changes.length > 0 && changes.every((file) => file.staged && !file.unstaged);
  const unversionedAllStaged = unversioned.length > 0 && unversioned.every((file) => file.staged);

  const runMutation = useCallback(async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await operation();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Git operation failed.");
    } finally {
      setBusy(false);
    }
  }, []);

  const toggleStage = useCallback(
    (file: GitFileChange) =>
      runMutation(() =>
        file.staged && !file.unstaged
          ? unstageGitFiles(environmentId, cwd, [file.path])
          : stageGitFiles(environmentId, cwd, [file.path]),
      ),
    [cwd, environmentId, runMutation],
  );

  const toggleAll = useCallback(
    (groupFiles: ReadonlyArray<GitFileChange>, stage: boolean) => {
      const paths = groupFiles.map((file) => file.path);
      return runMutation(() =>
        stage
          ? stageGitFiles(environmentId, cwd, paths)
          : unstageGitFiles(environmentId, cwd, paths),
      );
    },
    [cwd, environmentId, runMutation],
  );

  const discard = useCallback(
    (file: GitFileChange) => {
      const confirmation = file.untracked
        ? `Delete untracked file ${file.path}? This cannot be undone.`
        : `Discard changes to ${file.path}? This cannot be undone.`;
      if (!window.confirm(confirmation)) return;
      void runMutation(() => discardGitChanges(environmentId, cwd, [file.path]));
    },
    [cwd, environmentId, runMutation],
  );

  const commit = useCallback(() => {
    const trimmed = message.trim();
    if (trimmed.length === 0) return;
    void runMutation(async () => {
      await commitGitStaged(environmentId, cwd, trimmed, amend);
      setMessage("");
      setAmend(false);
    });
  }, [amend, cwd, environmentId, message, runMutation]);

  const generate = useCallback(() => {
    if (busy || generating) return;
    setGenerating(true);
    setActionError(null);
    void (async () => {
      try {
        setMessage(await generateGitCommitMessage(environmentId, cwd));
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Could not generate a commit message.",
        );
      } finally {
        setGenerating(false);
      }
    })();
  }, [busy, cwd, environmentId, generating]);

  const canGenerate = !busy && !generating && stagedCount > 0;
  const canCommit =
    !busy &&
    !generating &&
    message.trim().length > 0 &&
    (stagedCount > 0 || amend) &&
    (status.data?.isRepo ?? false);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">Commit</div>
          <div className="truncate text-[10px] leading-none text-muted-foreground">
            {status.isPending && status.data === null
              ? "Loading…"
              : `${files.length.toLocaleString()} changed · ${stagedCount.toLocaleString()} staged`}
          </div>
        </div>
        <button
          type="button"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Refresh git status"
          onClick={status.refresh}
        >
          <RefreshCw className={cn("size-3.5", status.isPending && "animate-spin")} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {status.error && status.data === null ? (
          <div className="p-4 text-xs leading-relaxed text-destructive">{status.error}</div>
        ) : status.data && !status.data.isRepo ? (
          <div className="p-4 text-xs leading-relaxed text-muted-foreground">
            This workspace is not a Git repository.
          </div>
        ) : files.length === 0 ? (
          <div className="p-4 text-xs leading-relaxed text-muted-foreground">
            No changes. Your working tree is clean.
          </div>
        ) : (
          <>
            <GitChangeGroup
              title="Changes"
              files={changes}
              busy={busy}
              allStaged={changesAllStaged}
              onToggleAll={toggleAll}
              onToggleStage={toggleStage}
              onDiscard={discard}
              onOpen={(file) => onOpenFile(file.path)}
            />
            <GitChangeGroup
              title="Unversioned"
              files={unversioned}
              busy={busy}
              allStaged={unversionedAllStaged}
              onToggleAll={toggleAll}
              onToggleStage={toggleStage}
              onDiscard={discard}
              onOpen={(file) => onOpenFile(file.path)}
            />
          </>
        )}
      </div>

      {status.data?.isRepo ? (
        <div className="flex shrink-0 flex-col gap-2 border-t border-border/60 p-2">
          {actionError ? (
            <div className="text-[11px] leading-snug text-destructive">{actionError}</div>
          ) : null}
          <textarea
            className="min-h-[3.5rem] resize-y rounded border border-border/60 bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-border focus:outline-none"
            placeholder="Commit message"
            value={message}
            disabled={busy || generating}
            onChange={(event) => setMessage(event.target.value)}
          />
          <div className="flex items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground">
              <input
                type="checkbox"
                className="size-3.5 cursor-pointer accent-[#4c9ffe]"
                checked={amend}
                disabled={busy || generating}
                onChange={(event) => setAmend(event.target.checked)}
              />
              Amend last commit
            </label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className={cn(
                  "rounded p-1.5",
                  canGenerate
                    ? "text-foreground hover:bg-accent"
                    : "cursor-not-allowed text-muted-foreground",
                )}
                disabled={!canGenerate}
                aria-label="Generate commit message"
                title="Generate commit message"
                onClick={generate}
              >
                {generating ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
              </button>
              <button
                type="button"
                className={cn(
                  "rounded px-3 py-1 text-xs font-medium",
                  canCommit
                    ? "bg-[#4c9ffe] text-white hover:bg-[#3a8ae8]"
                    : "cursor-not-allowed bg-accent text-muted-foreground",
                )}
                disabled={!canCommit}
                onClick={commit}
              >
                {busy ? "Working…" : amend ? "Amend" : "Commit"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
