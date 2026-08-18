import type { EnvironmentId, ProjectEntry } from "@t3tools/contracts";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import { ChevronsDownUpIcon, RotateCw, Trash2Icon, XIcon } from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
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
import { cn, isMacPlatform } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";
import { resolvePathLinkTarget } from "~/terminal-links";

import { NativeProjectFileTree } from "./NativeProjectFileTree";
import { useProjectEntriesQuery } from "./projectFilesQueryState";

interface FileBrowserPanelProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectName: string;
  selectedPath: string | null;
  selectedPathRevealId: number;
  onOpenFile: (relativePath: string) => void;
}

function RefreshFilesButton(props: { isPending: boolean; onRefresh: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Refresh workspace files"
            onClick={props.onRefresh}
          />
        }
      >
        <RotateCw className={cn(props.isPending && "animate-spin")} />
      </TooltipTrigger>
      <TooltipPopup>{props.isPending ? "Refreshing…" : "Refresh files"}</TooltipPopup>
    </Tooltip>
  );
}

function CollapseDirectoriesButton(props: { onCollapse: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Collapse all directories except the open file"
            onClick={props.onCollapse}
          />
        }
      >
        <ChevronsDownUpIcon />
      </TooltipTrigger>
      <TooltipPopup>Collapse all, keeping the open file</TooltipPopup>
    </Tooltip>
  );
}

function FileSearchField(props: {
  ariaLabel: string;
  name: string;
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <InputGroup variant="ghost" className="h-7 min-w-0 flex-1">
      <InputGroupInput
        type="search"
        name={props.name}
        size="sm"
        value={props.value}
        aria-label={props.ariaLabel}
        placeholder="Search files"
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
  environmentId,
  cwd,
  projectName,
  selectedPath,
  selectedPathRevealId,
  onOpenFile,
}: FileBrowserPanelProps) {
  const { resolvedTheme } = useTheme();
  const composerRef = useComposerHandleContext();
  const entriesQuery = useProjectEntriesQuery(environmentId, cwd);
  const deleteEntry = useAtomCommand(projectEnvironment.deleteEntry, { reportFailure: false });
  const readFileOnce = useAtomCommand(projectEnvironment.readFileOnce, { reportFailure: false });
  const writeFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });
  const entries = useMemo(
    () => uniqueProjectEntries(entriesQuery.data?.entries ?? []),
    [entriesQuery.data?.entries],
  );
  const filePaths = useMemo(
    () => new Set(entries.filter((entry) => entry.kind === "file").map((entry) => entry.path)),
    [entries],
  );
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [selectedPaths, setSelectedPaths] = useState<ReadonlyArray<string>>([]);
  const [collapseRequestId, setCollapseRequestId] = useState(0);
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
  useEffect(() => {
    setUndoableDelete(null);
  }, [cwd, environmentId]);

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
              title: `Could not restore ${failed.length} of ${snapshot.length}`,
              description: "The rest were written back.",
            }
          : {
              type: "success",
              title:
                snapshot.length === 1
                  ? `Restored ${snapshot[0]?.relativePath}`
                  : `Restored ${snapshot.length} files`,
            },
      );
    },
    [cwd, entriesQuery, environmentId, writeFile],
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
          title: `Could not delete ${failed.length} of ${paths.length}`,
          description: "Refresh the file list and try again.",
        });
        return;
      }
      toastManager.add({
        type: "success",
        title: paths.length === 1 ? `Deleted ${paths[0]}` : `Deleted ${paths.length} entries`,
        ...(snapshot === null
          ? {}
          : {
              actionProps: {
                children: "Undo",
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
      isDeleting,
      restoreSnapshot,
      snapshotPaths,
    ],
  );

  const showEntryContextMenu = useCallback(
    async (relativePath: string, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const mention = serializeComposerFileLink(relativePath);
      const absolutePath = resolvePathLinkTarget(relativePath, cwd);
      // A folder has no mention to copy and nothing to hand the composer, so it gets the two
      // items that do mean something for it.
      const isFile = filePaths.has(relativePath);
      const clicked = await api.contextMenu.show(
        [
          ...(isFile ? [{ id: "copy-mention", label: "Copy mention" }] : []),
          { id: "copy-absolute-path", label: "Copy absolute path" },
          ...(isFile ? [{ id: "add-to-chat", label: "Add to chat" }] : []),
          {
            id: "delete",
            label: isFile ? "Delete file" : "Delete folder",
            destructive: true,
            icon: "trash",
          },
        ],
        position,
      );
      if (clicked === "copy-mention") {
        try {
          await writeTextToClipboard(mention);
          toastManager.add({ type: "success", title: "Mention copied", description: relativePath });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to copy mention",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
        return;
      }
      if (clicked === "copy-absolute-path") {
        try {
          await writeTextToClipboard(absolutePath);
          toastManager.add({
            type: "success",
            title: "Absolute path copied",
            description: absolutePath,
          });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to copy absolute path",
            description: error instanceof Error ? error.message : "An error occurred.",
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
          title: "Unable to add to chat",
          description: "The chat isn't ready to accept input right now.",
        });
      }
    },
    [composerRef, cwd, deletePaths, filePaths],
  );

  const deleteSelectedFiles = useCallback(
    () => deletePaths(selectedFiles),
    [deletePaths, selectedFiles],
  );

  // Scoped to this panel rather than the window: Backspace is a text key everywhere else, and the
  // editor owns undo while it has focus.
  const onPanelKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;
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
    [deleteSelectedFiles, isRestoring, restoreSnapshot, selectedFiles.length, undoableDelete],
  );

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      onKeyDown={onPanelKeyDown}
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background outline-none"
      data-file-browser-panel={`${environmentId}:${cwd}`}
    >
      <div className="surface-subheader shrink-0 gap-1 px-2" data-surface-subheader>
        <RefreshFilesButton isPending={entriesQuery.isPending} onRefresh={entriesQuery.refresh} />
        <CollapseDirectoriesButton onCollapse={() => setCollapseRequestId((value) => value + 1)} />
        <FileSearchField
          name="project-files-search"
          ariaLabel={`Search ${projectName} files`}
          value={query}
          onValueChange={setQuery}
        />
        {selectedFiles.length > 0 ? (
          <>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {selectedFiles.length} selected
            </span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Clear file selection"
                    onClick={clearSelection}
                  />
                }
              >
                <XIcon />
              </TooltipTrigger>
              <TooltipPopup>Clear selection</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-destructive hover:text-destructive"
                    aria-label={`Delete ${selectedFiles.length} selected files`}
                    disabled={isDeleting}
                    onClick={() => void deleteSelectedFiles()}
                  />
                }
              >
                <Trash2Icon className={cn(isDeleting && "animate-pulse")} />
              </TooltipTrigger>
              <TooltipPopup>
                Delete {selectedFiles.length} selected file{selectedFiles.length === 1 ? "" : "s"}
              </TooltipPopup>
            </Tooltip>
          </>
        ) : null}
      </div>
      {entriesQuery.error && entriesQuery.data === null ? (
        <div className="p-4 text-xs leading-relaxed text-destructive">{entriesQuery.error}</div>
      ) : entriesQuery.data === null ? (
        <div className="p-4 text-xs text-muted-foreground">Loading files…</div>
      ) : entries.length === 0 ? (
        <div className="p-4 text-xs text-muted-foreground">No files found in this directory.</div>
      ) : (
        <NativeProjectFileTree
          entries={entries}
          query={deferredQuery}
          selectedPath={selectedPath}
          selectedPathRevealId={selectedPathRevealId}
          selectedPaths={selectedPaths}
          resolvedTheme={resolvedTheme}
          onOpenFile={onOpenFile}
          onSelectionChange={setSelectedPaths}
          onDeleteSelected={deleteSelectedFiles}
          onContextMenu={(path, position) => void showEntryContextMenu(path, position)}
          collapseRequestId={collapseRequestId}
        />
      )}
    </div>
  );
}
