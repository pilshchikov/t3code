import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { m } from "~/i18n/messages";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { joinHostPath } from "./filePath";
import type { EnvironmentId, ProjectEntry } from "@t3tools/contracts";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import { T, useGT, useMessages } from "gt-react";
import { ChevronsDownUpIcon, ChevronsUpDownIcon, Trash2Icon, XIcon } from "lucide-react";
import {
  type Ref,
  useCallback,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupInput } from "~/components/ui/input-group";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useComposerHandleContext } from "~/composerHandleContext";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useTheme } from "~/hooks/useTheme";
import { useWorkspaceMutationRefresh } from "~/hooks/useWorkspaceMutationRefresh";
import { cn, isMacPlatform } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { useFileContextMenu } from "~/fileContextMenu";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";
import { useProjectPathSearch } from "~/state/queries";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";

import { type PreviewAction, subscribePreviewAction } from "../preview/previewActionBus";
import { NativeProjectFileTree } from "./NativeProjectFileTree";
import { useProjectDirectoryListings, useProjectEntriesQuery } from "./projectFilesQueryState";
import { mergeDirectoryListings } from "./directoryListings";
import { useGitDetailedStatus } from "./gitChangesState";

function ExpandedDirectory(props: {
  environmentId: EnvironmentId;
  cwd: string;
  path: string;
  refreshId: number;
  active: boolean;
  workspaceMutationId: string | null;
}) {
  const query = useProjectEntriesQuery(props.environmentId, props.cwd, props.path, props.active);
  useWorkspaceMutationRefresh({
    enabled: props.active,
    mutationId: `${props.refreshId}:${props.workspaceMutationId ?? ""}`,
    resourceKey: props.path,
    refresh: query.refresh,
  });
  return null;
}

interface FileBrowserPanelProps {
  active?: boolean;
  environmentId: EnvironmentId;
  cwd: string;
  projectName: string;
  selectedPath: string | null;
  selectedPathRevealId: number;
  onOpenFile: (relativePath: string) => void;
  /**
   * Set when `cwd` is a host folder outside the workspace rather than the
   * workspace root. Entries then open and mention as host paths. A host folder can
   * be a home directory, so nothing walks it whole: there is no expand-all, and
   * search filters the folders already loaded instead of indexing on the server.
   */
  hostFolder?: boolean;
  onRefreshSelectedFile?: () => void;
  workspaceMutationId?: string | null;
  answersPanelFind?: boolean;
}

function RefreshFilesButton(props: { isPending: boolean; onRefresh: () => void }) {
  const gt = useGT();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={gt("Refresh workspace files")}
            onClick={props.onRefresh}
          />
        }
      >
        <RefreshIcon refreshing={props.isPending} />
      </TooltipTrigger>
      <TooltipPopup>{props.isPending ? gt("Refreshing…") : gt("Refresh files")}</TooltipPopup>
    </Tooltip>
  );
}

function CollapseDirectoriesButton(props: { onCollapse: () => void }) {
  const gt = useGT();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={gt("Collapse all directories except the open file")}
            onClick={props.onCollapse}
          />
        }
      >
        <ChevronsDownUpIcon />
      </TooltipTrigger>
      <TooltipPopup>
        <T>Collapse all, keeping the open file</T>
      </TooltipPopup>
    </Tooltip>
  );
}

function FileSearchField({
  ref,
  ...props
}: {
  ariaLabel: string;
  name: string;
  onValueChange: (value: string) => void;
  ref: Ref<HTMLInputElement>;
  value: string;
}) {
  const gt = useGT();
  return (
    <InputGroup variant="ghost" className="h-7 min-w-0 flex-1">
      <InputGroupInput
        ref={ref}
        type="search"
        name={props.name}
        size="sm"
        value={props.value}
        aria-label={props.ariaLabel}
        placeholder={gt("Search files")}
        data-workspace-focus-default
        spellCheck={false}
        onChange={(event) => props.onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          props.onValueChange("");
          event.currentTarget.blur();
        }}
      />
    </InputGroup>
  );
}

/**
 * Ceiling on what one delete keeps in memory to be undoable. Past it the delete still happens; it
 * just stops promising it can be taken back.
 */
const UNDO_SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024;

const UNDO_SHORTCUT_LABEL = isMacPlatform(navigator.platform) ? "\u2318Z" : "Ctrl+Z";

function uniqueProjectEntries(entries: ReadonlyArray<ProjectEntry>): ProjectEntry[] {
  return Array.from(
    new Map(
      entries.map((entry) => [`${entry.kind}:${entry.path.replace(/\/+$/, "")}`, entry]),
    ).values(),
  );
}

export default function FileBrowserPanel({
  active = true,
  environmentId,
  cwd,
  projectName,
  selectedPath,
  selectedPathRevealId,
  onOpenFile,
  onRefreshSelectedFile,
  workspaceMutationId = null,
  hostFolder = false,
  answersPanelFind = false,
}: FileBrowserPanelProps) {
  const panelPath = (relativePath: string) =>
    hostFolder ? joinHostPath(cwd, relativePath) : relativePath;
  const gt = useGT();
  const messages = useMessages();
  const { resolvedTheme } = useTheme();
  const composerRef = useComposerHandleContext();
  const fileContextMenu = useFileContextMenu(environmentId);
  const entriesQuery = useProjectEntriesQuery(environmentId, cwd, "", active);
  const [expandedDirectories, setExpandedDirectories] = useState<readonly string[]>([]);
  const directoryListings = useProjectDirectoryListings(environmentId, cwd, expandedDirectories);
  const [refreshId, setRefreshId] = useState(0);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const focusSearch = useCallback(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);
  const onPanelAction = useEffectEvent((action: PreviewAction) => {
    // Hidden panel tabs stay mounted; only the visible Files tab answers.
    if (action === "find" && searchInputRef.current?.getClientRects().length) focusSearch();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the panel find command, which fires while focus is anywhere in the right panel
  useEffect(() => {
    if (!answersPanelFind) return;
    return subscribePreviewAction(onPanelAction);
  }, [answersPanelFind]);
  const search = useProjectPathSearch(
    { environmentId, cwd: hostFolder ? null : cwd, query: deferredQuery, kind: "file" },
    200,
    undefined,
    messages,
  );
  const onExpandedDirectoriesChange = useCallback((paths: readonly string[]) => {
    setExpandedDirectories((current) =>
      current.length === paths.length && current.every((path, i) => path === paths[i])
        ? current
        : paths,
    );
  }, []);
  const deleteEntry = useAtomCommand(projectEnvironment.deleteEntry, { reportFailure: false });
  const readFileOnce = useAtomCommand(projectEnvironment.readFileOnce, { reportFailure: false });
  const writeFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });
  const entries = useMemo(
    () =>
      uniqueProjectEntries(
        deferredQuery.trim() && !hostFolder
          ? search.entries
          : mergeDirectoryListings(
              entriesQuery.data?.entries ?? [],
              directoryListings,
              expandedDirectories,
            ),
      ),
    [
      hostFolder,
      deferredQuery,
      search.entries,
      entriesQuery.data?.entries,
      directoryListings,
      expandedDirectories,
    ],
  );
  const loadingDirectories = useMemo(
    () => new Set(expandedDirectories.filter((path) => !directoryListings.has(path))),
    [expandedDirectories, directoryListings],
  );
  const treeRevision = useMemo(
    () => ({ root: entriesQuery.data, directories: directoryListings }),
    [entriesQuery.data, directoryListings],
  );
  const filePaths = useMemo(
    () => new Set(entries.filter((entry) => entry.kind === "file").map((entry) => entry.path)),
    [entries],
  );
  const [selectedPaths, setSelectedPaths] = useState<ReadonlyArray<string>>([]);
  const [collapseRequestId, setCollapseRequestId] = useState(0);
  const [expandAllRequestId, setExpandAllRequestId] = useState(0);
  const status = useGitDetailedStatus(environmentId, cwd, active);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Refresh the disk-backed Git query when filesystem listings change.
  useEffect(() => {
    if (active) status.refresh();
  }, [active, treeRevision, status.refresh]);
  useWorkspaceMutationRefresh({
    enabled: active,
    mutationId: `${refreshId}:${workspaceMutationId ?? ""}`,
    resourceKey: `tree-status:${environmentId}:${cwd}`,
    refresh: status.refresh,
  });
  const fileChanges = status.data?.files ?? [];

  const fileColors = useMemo(
    () =>
      new Map(
        fileChanges.map((file) => [
          file.path,
          file.untracked || file.unstaged
            ? "var(--diff-deletion-foreground)"
            : file.indexStatus === "added" || file.indexStatus === "copied"
              ? "var(--diff-addition-foreground)"
              : file.indexStatus === "deleted"
                ? "var(--error-foreground)"
                : file.indexStatus === "renamed"
                  ? "var(--warning-foreground)"
                  : "var(--info-foreground)",
        ]),
      ),
    [fileChanges],
  );
  const pendingDirectories = expandedDirectories.filter((path) => !directoryListings.has(path));
  const [isDeleting, setIsDeleting] = useState(false);
  /**
   * Contents of the last delete, so it can be put back. Only whole text files are held: a folder
   * and a file too large to have been read in one piece cannot be reconstructed from this, and the
   * confirmation says so rather than promising an undo that would restore part of the work.
   */
  const [undoableDelete, setUndoableDelete] = useState<ReadonlyArray<{
    readonly relativePath: string;
    readonly contents: string;
  }> | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const selectedFiles = useMemo(
    () => selectedPaths.filter((path) => filePaths.has(path)),
    [filePaths, selectedPaths],
  );

  const clearSelection = useCallback(() => setSelectedPaths([]), []);
  // An undo entry belongs to the directory it was taken from; carrying it across would write those
  // files into a different workspace root.
  const undoRoot = `${environmentId}:${cwd}`;
  const [undoRootIdentity, setUndoRootIdentity] = useState(undoRoot);
  if (undoRootIdentity !== undoRoot) {
    setUndoRootIdentity(undoRoot);
    setUndoableDelete(null);
  }

  /**
   * Reads every path back so a delete can be undone, or gives up on the whole set. Partial recovery
   * is worse than none: it looks like the undo worked while quietly leaving files behind.
   */
  const snapshotPaths = useCallback(
    async (paths: readonly string[]) => {
      if (paths.some((path) => !filePaths.has(path))) return null;
      let bytes = 0;
      const snapshot: { relativePath: string; contents: string }[] = [];
      for (const relativePath of paths) {
        const result = await readFileOnce({ environmentId, input: { cwd, relativePath } });
        // A binary or over-long file comes back truncated or not at all; either way what we hold is
        // not the file, so there is nothing honest to put back.
        if (result._tag === "Failure" || result.value.truncated) return null;
        bytes += result.value.byteLength;
        if (bytes > UNDO_SNAPSHOT_MAX_BYTES) return null;
        snapshot.push({ relativePath, contents: result.value.contents });
      }
      return snapshot;
    },
    [cwd, environmentId, filePaths, readFileOnce],
  );

  const restoreSnapshot = useCallback(
    async (snapshot: ReadonlyArray<{ relativePath: string; contents: string }>) => {
      setIsRestoring(true);
      const results = await Promise.all(
        snapshot.map((file) =>
          writeFile({
            environmentId,
            input: { cwd, relativePath: file.relativePath, contents: file.contents },
          }),
        ),
      );
      setIsRestoring(false);
      setUndoableDelete(null);
      entriesQuery.refresh();
      const failed = results.filter((result) => result._tag === "Failure");
      toastManager.add(
        failed.length > 0
          ? {
              type: "error",
              title: gt("Could not restore {failed} of {total}", {
                failed: failed.length,
                total: snapshot.length,
              }),
              description: gt("The rest were written back."),
            }
          : {
              type: "success",
              title:
                snapshot.length === 1
                  ? gt("Restored {path}", { path: snapshot[0]?.relativePath ?? "" })
                  : gt("Restored {count} files", { count: snapshot.length }),
            },
      );
    },
    [cwd, entriesQuery, environmentId, gt, writeFile],
  );

  /**
   * Confirms and removes entries from disk. A directory goes with its contents, which is what the
   * server's remove already does, so the confirmation has to say so.
   */
  const deletePaths = useCallback(
    async (paths: readonly string[]) => {
      if (isDeleting || paths.length === 0) return;
      const api = readLocalApi();
      if (!api) return;
      const directories = paths.filter((path) => !filePaths.has(path));
      const listedPaths = paths.slice(0, 6).map((path) => `• ${path}`);
      const remainingCount = paths.length - listedPaths.length;
      const snapshot = await snapshotPaths(paths);
      const confirmed = await api.dialogs.confirm(
        [
          paths.length === 1 ? `Delete ${paths[0]}?` : `Delete ${paths.length} selected entries?`,
          ...(paths.length === 1 ? [] : listedPaths),
          ...(remainingCount > 0 ? [`• and ${remainingCount} more`] : []),
          directories.length > 0
            ? "This removes them from disk, folders with everything inside them."
            : "This removes them from disk.",
          snapshot === null
            ? "This cannot be undone."
            : `Undo with ${UNDO_SHORTCUT_LABEL} while the file list has focus.`,
        ].join("\n"),
        { variant: "destructive" },
      );
      if (!confirmed) return;
      setIsDeleting(true);
      const results = await Promise.all(
        paths.map((relativePath) => deleteEntry({ environmentId, input: { cwd, relativePath } })),
      );
      const failed = results.filter((result) => result._tag === "Failure");
      setIsDeleting(false);
      setSelectedPaths([]);
      setUndoableDelete(snapshot);
      entriesQuery.refresh();
      // Focus survives the rows unmounting, so the undo shortcut still has somewhere to land.
      panelRef.current?.focus({ preventScroll: true });
      if (failed.length > 0) {
        toastManager.add({
          type: "error",
          title: gt("Could not delete {failed} of {total}", {
            failed: failed.length,
            total: paths.length,
          }),
          description: gt("Refresh the file list and try again."),
        });
        return;
      }
      toastManager.add({
        type: "success",
        title:
          paths.length === 1
            ? gt("Deleted {path}", { path: paths[0] ?? "" })
            : gt("Deleted {count} entries", { count: paths.length }),
        ...(snapshot === null
          ? {}
          : {
              actionProps: {
                children: gt("Undo"),
                onClick: () => void restoreSnapshot(snapshot),
              },
            }),
      });
    },
    [
      cwd,
      deleteEntry,
      entriesQuery,
      environmentId,
      filePaths,
      gt,
      isDeleting,
      restoreSnapshot,
      snapshotPaths,
    ],
  );

  const showEntryContextMenu = useCallback(
    async (relativePath: string, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const mention = serializeComposerFileLink(
        hostFolder ? joinHostPath(cwd, relativePath) : relativePath,
      );
      const absolutePath = resolvePathLinkTarget(relativePath, cwd);
      // Folders share the environment open/reveal actions, but cannot become composer mentions.
      const isFile = filePaths.has(relativePath);
      const fileTarget = { environmentId, filePath: relativePath, workspaceRoot: cwd };
      const fileMenuItems = fileContextMenu.buildItems(fileTarget);
      const clicked = await api.contextMenu.show(
        [
          ...fileMenuItems,
          ...(isFile ? [{ id: "copy-mention", label: gt("Copy mention") }] : []),
          { id: "copy-absolute-path", label: gt("Copy absolute path") },
          ...(isFile ? [{ id: "add-to-chat", label: gt("Add to chat") }] : []),
          {
            id: "delete",
            label: isFile ? gt("Delete file") : gt("Delete folder"),
            destructive: true,
            icon: "trash",
          },
        ],
        position,
      );
      if (clicked === null) return;
      if (clicked === "open" || clicked === "reveal-in-folder" || clicked?.startsWith("editor:")) {
        await fileContextMenu.activate(
          clicked as Parameters<typeof fileContextMenu.activate>[0],
          fileTarget,
        );
        return;
      }
      if (clicked === "copy-mention") {
        try {
          await writeTextToClipboard(mention);
        } catch (error) {
          toastManager.add({
            type: "error",
            title: gt("Failed to copy mention"),
            description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
          });
        }
        return;
      }
      if (clicked === "copy-absolute-path") {
        try {
          await writeTextToClipboard(absolutePath);
        } catch (error) {
          toastManager.add({
            type: "error",
            title: gt("Failed to copy absolute path"),
            description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
          });
        }
        return;
      }
      if (clicked === "delete") {
        await deletePaths([relativePath]);
        return;
      }
      if (clicked !== "add-to-chat") return;
      const inserted = composerRef?.current?.insertTextAtEnd(`${mention} `, {
        ensureLeadingBoundary: true,
      });
      if (!inserted) {
        toastManager.add({
          type: "error",
          title: gt("Unable to add to chat"),
          description: gt("The chat isn't ready to accept input right now."),
        });
      }
    },
    [composerRef, cwd, deletePaths, environmentId, fileContextMenu, filePaths, gt, hostFolder],
  );
  const handleRefresh = useCallback(() => {
    setRefreshId((value) => value + 1);
    entriesQuery.refresh();
    onRefreshSelectedFile?.();
  }, [entriesQuery, onRefreshSelectedFile]);
  useWorkspaceMutationRefresh({
    enabled: active,
    mutationId: workspaceMutationId,
    refresh: entriesQuery.refresh,
    resourceKey: `files:${environmentId}:${cwd}`,
  });

  const deleteSelectedFiles = useCallback(
    () => deletePaths(selectedFiles),
    [deletePaths, selectedFiles],
  );

  // Scoped to this panel rather than the window: Backspace is a text key everywhere else, and the
  // editor owns undo while it has focus.
  const onPanelKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;
      const isModPressed = isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey;
      if (isModPressed && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        focusSearch();
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, [contenteditable]")) {
        return;
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        selectedFiles.length > 0
      ) {
        event.preventDefault();
        event.stopPropagation();
        void deleteSelectedFiles();
        return;
      }
      if (
        event.key.toLowerCase() === "z" &&
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        undoableDelete !== null &&
        !isRestoring
      ) {
        event.preventDefault();
        event.stopPropagation();
        void restoreSnapshot(undoableDelete);
      }
    },
    [
      deleteSelectedFiles,
      focusSearch,
      isRestoring,
      restoreSnapshot,
      selectedFiles.length,
      undoableDelete,
    ],
  );

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      onKeyDown={onPanelKeyDown}
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background outline-none"
      data-file-browser-panel={`${environmentId}:${cwd}`}
    >
      {!deferredQuery.trim() &&
        expandedDirectories
          .filter((path) => directoryListings.has(path) || pendingDirectories.indexOf(path) < 4)
          .map((path) => (
            <ExpandedDirectory
              key={`${environmentId}:${cwd}:${path}`}
              environmentId={environmentId}
              active={active}
              cwd={cwd}
              path={path}
              refreshId={refreshId}
              workspaceMutationId={workspaceMutationId}
            />
          ))}
      <div className="surface-subheader shrink-0 gap-1 px-2" data-surface-subheader>
        <RefreshFilesButton isPending={entriesQuery.isPending} onRefresh={handleRefresh} />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={gt("Expand all folders")}
                disabled={hostFolder}
                onClick={() => setExpandAllRequestId((id) => id + 1)}
              />
            }
          >
            <ChevronsUpDownIcon />
          </TooltipTrigger>
          <TooltipPopup>{gt("Expand all folders")}</TooltipPopup>
        </Tooltip>
        <CollapseDirectoriesButton onCollapse={() => setCollapseRequestId((value) => value + 1)} />
        <FileSearchField
          ref={searchInputRef}
          name="project-files-search"
          ariaLabel={gt("Search {projectName} files", { projectName })}
          value={query}
          onValueChange={setQuery}
        />
        {selectedFiles.length > 0 ? (
          <>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {gt("{count} selected", { count: selectedFiles.length })}
            </span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={gt("Clear file selection")}
                    onClick={clearSelection}
                  />
                }
              >
                <XIcon />
              </TooltipTrigger>
              <TooltipPopup>{gt("Clear selection")}</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-destructive hover:text-destructive"
                    aria-label={gt("Delete {count} selected files", {
                      count: selectedFiles.length,
                    })}
                    disabled={isDeleting}
                    onClick={() => void deleteSelectedFiles()}
                  />
                }
              >
                <Trash2Icon className={cn(isDeleting && "animate-pulse")} />
              </TooltipTrigger>
              <TooltipPopup>
                {selectedFiles.length === 1
                  ? gt("Delete 1 selected file")
                  : gt("Delete {count} selected files", { count: selectedFiles.length })}
              </TooltipPopup>
            </Tooltip>
          </>
        ) : null}
      </div>
      {entriesQuery.error && entriesQuery.data === null ? (
        <div className="p-4 text-xs leading-relaxed text-destructive">{entriesQuery.error}</div>
      ) : entriesQuery.data === null ? (
        <div className="p-4 text-xs text-muted-foreground">
          <T>Loading files…</T>
        </div>
      ) : deferredQuery.trim() && !hostFolder && search.isPending ? (
        <div className="p-4 text-xs text-muted-foreground">
          <T>Searching files…</T>
        </div>
      ) : deferredQuery.trim() && !hostFolder && search.error ? (
        <div className="p-4 text-xs text-destructive">{search.error}</div>
      ) : entries.length === 0 ? (
        <div className="p-4 text-xs text-muted-foreground">
          <T>No files found in this directory.</T>
        </div>
      ) : (
        <NativeProjectFileTree
          active={active}
          workspaceKey={`${encodeURIComponent(environmentId)}|${encodeURIComponent(cwd)}`}
          entries={entries}
          loadingDirectories={loadingDirectories}
          fileColors={fileColors}
          expandAllRequestId={hostFolder ? 0 : expandAllRequestId}
          query={deferredQuery}
          selectedPath={selectedPath}
          selectedPathRevealId={selectedPathRevealId}
          selectedPaths={selectedPaths}
          resolvedTheme={resolvedTheme}
          onOpenFile={(path) => onOpenFile(panelPath(path))}
          mentionPath={panelPath}
          onSelectionChange={setSelectedPaths}
          onDeleteSelected={deleteSelectedFiles}
          onDeleteEntry={(path) => deletePaths([path])}
          onContextMenu={(path, position) => void showEntryContextMenu(path, position)}
          collapseRequestId={collapseRequestId}
          onExpandedDirectoriesChange={onExpandedDirectoriesChange}
        />
      )}
    </div>
  );
}
