import type { EnvironmentId, ProjectEntry } from "@t3tools/contracts";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { LocateFixed, Maximize2, Minimize2, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useTheme } from "~/hooks/useTheme";
import { useVcsStatus } from "~/lib/vcsStatusState";
import { cn } from "~/lib/utils";
import { T3_PIERRE_ICONS } from "~/pierre-icons";

import { useProjectEntriesQuery } from "./projectFilesQueryState";

interface FileBrowserPanelProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectName: string;
  revealRequest?: { readonly id: number; readonly path: string } | null;
  activeRelativePath?: string | null;
  onOpenFile: (relativePath: string) => void;
}

const AUTO_REVEAL_STORAGE_KEY = "t3code.fileTreeAutoReveal";

function initialAutoReveal(): boolean {
  try {
    return window.localStorage.getItem(AUTO_REVEAL_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

type TreeModel = ReturnType<typeof useFileTree>["model"];

/** Expand every ancestor directory of `path`, then scroll the entry into view. */
function revealPathInTree(model: TreeModel, path: string): void {
  if (!path) return;
  const segments = path.split("/").filter(Boolean);
  let accumulated = "";
  for (let index = 0; index < segments.length - 1; index += 1) {
    accumulated = accumulated ? `${accumulated}/${segments[index]}` : segments[index]!;
    const directory = model.getItem(`${accumulated}/`) ?? model.getItem(accumulated);
    if (directory?.isDirectory() && "expand" in directory) {
      directory.expand();
    }
  }
  const target = model.getItem(path) ?? model.getItem(`${path}/`);
  if (!target) return;
  if (target.isDirectory() && "expand" in target) {
    target.expand();
  }
  // Focus the row so it gets `data-item-focused` (styled below), not just scrolled into view —
  // mirrors JetBrains highlighting the open file in the tree.
  model.focusPath(target.getPath());
  model.scrollToPath(target.getPath(), { focus: true, offset: "center" });
}

const TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-selected-bg-override: color-mix(in srgb, currentColor 12%, transparent);
    --trees-hover-bg-override: color-mix(in srgb, currentColor 7%, transparent);
    --trees-border-color-override: color-mix(in srgb, currentColor 14%, transparent);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 12px;
  }
  button[data-type='item'] { border-radius: 5px; }
  button[data-item-focused='true'],
  button[data-item-selected='true'] {
    background-color: var(--trees-selected-bg-override);
  }
  button[data-item-git-status='modified'] { color: #4c9ffe !important; }
  button[data-item-git-status='added'],
  button[data-item-git-status='untracked'] { color: #3fb950 !important; }
  button[data-item-git-status='deleted'] { color: #f85149 !important; }
  button[data-item-git-status='renamed'] { color: #d29922 !important; }
`;

function treePath(entry: ProjectEntry): string {
  return entry.kind === "directory" ? `${entry.path}/` : entry.path;
}

export default function FileBrowserPanel({
  environmentId,
  cwd,
  projectName,
  revealRequest,
  activeRelativePath,
  onOpenFile,
}: FileBrowserPanelProps) {
  const { resolvedTheme } = useTheme();
  const [autoReveal, setAutoReveal] = useState(initialAutoReveal);
  const vcsStatus = useVcsStatus({ environmentId, cwd });
  const gitStatusEntries = useMemo(
    () =>
      (vcsStatus.data?.workingTree.files ?? []).map((file) => ({
        path: file.path,
        // The working-tree status reports changed files with line counts but not add/delete/rename;
        // mark them modified so the tree colors them (full per-change kinds come with staging).
        status: "modified" as const,
      })),
    [vcsStatus.data],
  );
  const entriesQuery = useProjectEntriesQuery(environmentId, cwd);
  const entries = entriesQuery.data?.entries ?? [];
  const entryKinds = useMemo(
    () => new Map(entries.map((entry) => [entry.path, entry.kind] as const)),
    [entries],
  );
  const entryKindsRef = useRef<ReadonlyMap<string, ProjectEntry["kind"]>>(entryKinds);
  const treePaths = useMemo(() => entries.map(treePath), [entries]);
  const directoryTreePaths = useMemo(
    () => entries.filter((entry) => entry.kind === "directory").map(treePath),
    [entries],
  );
  const previousTreePathsRef = useRef<readonly string[]>([]);

  const { model } = useFileTree({
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    initialExpansion: 1,
    icons: T3_PIERRE_ICONS,
    onSelectionChange: (selectedPaths) => {
      const selectedPath = selectedPaths.at(-1)?.replace(/\/$/, "");
      if (selectedPath && entryKindsRef.current.get(selectedPath) === "file") {
        onOpenFile(selectedPath);
      }
    },
    paths: [],
    search: true,
    unsafeCSS: TREE_UNSAFE_CSS,
  });

  useEffect(() => {
    if (previousTreePathsRef.current === treePaths) return;
    entryKindsRef.current = entryKinds;
    previousTreePathsRef.current = treePaths;
    model.resetPaths(treePaths);
  }, [entryKinds, model, treePaths]);

  useEffect(() => {
    model.setGitStatus(gitStatusEntries);
  }, [gitStatusEntries, model]);

  useEffect(() => {
    if (!revealRequest) return;
    if (revealRequest.path.length === 0) {
      const firstPath = treePaths[0];
      if (firstPath) {
        model.scrollToPath(firstPath, { focus: true, offset: "center" });
      }
      return;
    }
    revealPathInTree(model, revealRequest.path);
  }, [model, revealRequest, treePaths]);

  // Auto-scroll the tree to the file shown in the editor (expanding parents), like JetBrains'
  // "Always Select Opened File". Depends on treePaths so it also fires once the tree finishes loading.
  useEffect(() => {
    if (!autoReveal || !activeRelativePath) return;
    revealPathInTree(model, activeRelativePath);
  }, [activeRelativePath, autoReveal, model, treePaths]);

  const toggleAutoReveal = () => {
    setAutoReveal((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(AUTO_REVEAL_STORAGE_KEY, String(next));
      } catch {}
      if (next && activeRelativePath) revealPathInTree(model, activeRelativePath);
      return next;
    });
  };

  const expandAllDirectories = () => {
    for (const path of directoryTreePaths) {
      const item = model.getItem(path);
      if (item?.isDirectory() && "expand" in item) {
        item.expand();
      }
    }
  };

  const collapseAllDirectories = () => {
    for (const path of directoryTreePaths.toReversed()) {
      const item = model.getItem(path);
      if (item?.isDirectory() && "collapse" in item) {
        item.collapse();
      }
    }
  };

  const fileCount = useMemo(
    () => entries.reduce((count, entry) => count + (entry.kind === "file" ? 1 : 0), 0),
    [entries],
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-background"
      data-file-browser-panel={`${environmentId}:${cwd}`}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">{projectName}</div>
          <div className="truncate text-[10px] leading-none text-muted-foreground">
            {entriesQuery.isPending && entriesQuery.data === null
              ? "Indexing…"
              : `${fileCount.toLocaleString()} files`}
            {entriesQuery.data?.truncated ? " · partial" : ""}
          </div>
        </div>
        <button
          type="button"
          aria-pressed={autoReveal}
          className={cn(
            "rounded-md p-1.5 hover:bg-accent hover:text-foreground",
            autoReveal ? "bg-accent text-foreground" : "text-muted-foreground",
          )}
          aria-label={
            autoReveal
              ? "Stop auto-revealing the open file"
              : "Auto-reveal the open file in the tree"
          }
          title={autoReveal ? "Auto-reveal: on" : "Auto-reveal: off"}
          onClick={toggleAutoReveal}
        >
          <LocateFixed className="size-3.5" />
        </button>
        <button
          type="button"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Expand all directories"
          onClick={expandAllDirectories}
        >
          <Maximize2 className="size-3.5" />
        </button>
        <button
          type="button"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Collapse all directories"
          onClick={collapseAllDirectories}
        >
          <Minimize2 className="size-3.5" />
        </button>
        <button
          type="button"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Search workspace files"
          onClick={() => model.openSearch()}
        >
          <Search className="size-3.5" />
        </button>
        <button
          type="button"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Refresh workspace files"
          onClick={entriesQuery.refresh}
        >
          <RefreshCw className={cn("size-3.5", entriesQuery.isPending && "animate-spin")} />
        </button>
      </div>
      {entriesQuery.error && entriesQuery.data === null ? (
        <div className="p-4 text-xs leading-relaxed text-destructive">{entriesQuery.error}</div>
      ) : (
        <FileTree
          model={model}
          aria-label={`${projectName} files`}
          className="min-h-0 flex-1 overflow-hidden"
          style={{
            colorScheme: resolvedTheme,
            ["--trees-fg-override" as string]: "var(--foreground)",
          }}
        />
      )}
    </div>
  );
}
