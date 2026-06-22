import type {
  EditorId,
  EnvironmentId,
  ProjectCodeSearchMatch,
  ProjectEntry,
  ResolvedKeybindingsConfig,
  ScopedThreadRef,
} from "@t3tools/contracts";
import type { SelectedLineRange, TokenEventBase } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/editor";
import { EditorProvider, File, Virtualizer } from "@pierre/diffs/react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Code2,
  Eye,
  FileText,
  Folder,
  FolderTree,
  Globe2,
  LoaderCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isBrowserPreviewFile, openFileInPreview } from "~/browser/openFileInPreview";
import ChatMarkdown from "~/components/ChatMarkdown";
import { OpenInPicker } from "~/components/chat/OpenInPicker";
import { ensureEnvironmentApi } from "~/environmentApi";
import {
  canGoBack as historyCanGoBack,
  canGoForward as historyCanGoForward,
  editorWorkspaceKey,
  useEditorNavigationStore,
  type EditorLocation,
} from "~/editorNavigationStore";
import { usePrimaryEnvironmentId } from "~/environments/primary/context";
import { useSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { resolveEditorDiffTheme, type ResolvedEditorDiffTheme } from "~/lib/diffRendering";
import { cn } from "~/lib/utils";
import { isPreviewSupportedInRuntime } from "~/previewStateStore";
import { resolvePathLinkTarget } from "~/terminal-links";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Toggle } from "~/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { buildFileReviewComment } from "~/reviewCommentContext";

import FileBrowserPanel from "./FileBrowserPanel";
import FileStructurePanel from "./FileStructurePanel";
import { EditorNavigationDialog } from "./EditorNavigationDialog";
import {
  type FileCommentAnnotationEntry,
  type FileCommentAnnotationGroup,
  type FileCommentLineAnnotation,
  formatFileCommentRange,
  nextFileCommentId,
  normalizeFileCommentRange,
  remapFileCommentAnnotations,
} from "./fileCommentAnnotations";
import { installFileEditorDismissal } from "./fileEditorDismissal";
import { LocalCommentAnnotation } from "./LocalCommentAnnotation";
import { SymbolNavigationDialog } from "./SymbolNavigationDialog";
import { projectFileCacheKey } from "./fileContentRevision";
import {
  directChildProjectEntries,
  fileBreadcrumbs,
  firstFileInDirectory,
  parentDirectoryPath,
} from "./filePath";
import {
  readMarkdownPreviewMode,
  isMarkdownPreviewFile,
  setMarkdownTaskChecked,
  shouldRenderMarkdownPreview,
  writeMarkdownPreviewMode,
} from "./filePreviewMode";
import { FileSaveCoordinator } from "./fileSaveCoordinator";
import {
  confirmProjectFileQueryData,
  getOptimisticProjectFileQueryData,
  setProjectFileQueryData,
  useProjectEntriesQuery,
  useProjectFileQuery,
} from "./projectFilesQueryState";

interface FilePreviewPanelProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectName: string;
  relativePath: string | null;
  threadRef: ScopedThreadRef;
  composerDraftTarget: ScopedThreadRef | DraftId;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  onOpenFile: (relativePath: string) => void;
  onPendingChange: (relativePath: string, pending: boolean) => void;
}

const FILE_EXPLORER_STORAGE_KEY = "t3code.fileExplorerOpen";
const EXPLORER_VIEW_STORAGE_KEY = "t3code.explorerView";
const FILE_SAVE_DEBOUNCE_MS = 500;
const MAX_BREADCRUMB_CHILDREN = 80;

type ExplorerView = "files" | "structure";

function initialExplorerView(): ExplorerView {
  try {
    return window.localStorage.getItem(EXPLORER_VIEW_STORAGE_KEY) === "structure"
      ? "structure"
      : "files";
  } catch {
    return "files";
  }
}

interface EditableFileSurfaceProps {
  environmentId: EnvironmentId;
  cwd: string;
  relativePath: string;
  composerDraftTarget: ScopedThreadRef | DraftId;
  contents: string;
  editorDiffTheme: ResolvedEditorDiffTheme;
  navigationLine: number | null;
  onTokenNavigation: (token: TokenEventBase, event: MouseEvent) => void;
  onPendingChange: (relativePath: string, pending: boolean) => void;
}

function useFileSaveCoordinator({
  environmentId,
  cwd,
  relativePath,
  onPendingChange,
}: Pick<
  EditableFileSurfaceProps,
  "environmentId" | "cwd" | "relativePath" | "onPendingChange"
>): FileSaveCoordinator {
  const coordinator = useMemo(
    () =>
      new FileSaveCoordinator({
        debounceMs: FILE_SAVE_DEBOUNCE_MS,
        onPendingChange: (pending) => onPendingChange(relativePath, pending),
        persist: async (nextContents) => {
          await ensureEnvironmentApi(environmentId).projects.writeFile({
            cwd,
            relativePath,
            contents: nextContents,
          });
        },
        onConfirmed: (confirmedContents) => {
          confirmProjectFileQueryData(environmentId, cwd, relativePath, confirmedContents);
        },
      }),
    [cwd, environmentId, onPendingChange, relativePath],
  );

  useEffect(() => () => coordinator.dispose(), [coordinator]);
  return coordinator;
}

function EditableFileSurface({
  environmentId,
  cwd,
  relativePath,
  composerDraftTarget,
  contents,
  editorDiffTheme,
  navigationLine,
  onTokenNavigation,
  onPendingChange,
}: EditableFileSurfaceProps) {
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const removeReviewComment = useComposerDraftStore((store) => store.removeReviewComment);
  const [lineAnnotations, setLineAnnotations] = useState<FileCommentLineAnnotation[]>([]);
  const [selectedRange, setSelectedRange] = useState<SelectedLineRange | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const saveCoordinator = useFileSaveCoordinator({
    environmentId,
    cwd,
    relativePath,
    onPendingChange,
  });
  const editor = useMemo(
    () =>
      new Editor<FileCommentAnnotationGroup>({
        onChange: (file, nextLineAnnotations) => {
          setProjectFileQueryData(environmentId, cwd, relativePath, file.contents);
          saveCoordinator.change(file.contents);
          if (nextLineAnnotations) {
            const remapped = remapFileCommentAnnotations(
              nextLineAnnotations as FileCommentLineAnnotation[],
            );
            setLineAnnotations(remapped);
            for (const annotation of remapped) {
              for (const entry of annotation.metadata.entries) {
                if (entry.kind !== "comment") continue;
                addReviewComment(
                  composerDraftTarget,
                  buildFileReviewComment({
                    id: entry.id,
                    filePath: relativePath,
                    startLine: entry.startLine,
                    endLine: entry.endLine,
                    text: entry.text,
                    contents: file.contents,
                  }),
                );
              }
            }
          }
        },
      }),
    [addReviewComment, composerDraftTarget, cwd, environmentId, relativePath, saveCoordinator],
  );

  useEffect(
    () => () => {
      editor.cleanUp();
    },
    [editor],
  );

  const removeAnnotationEntry = useCallback(
    (entryId: string) => {
      setSelectedRange(null);
      removeReviewComment(composerDraftTarget, entryId);
      setLineAnnotations((current) => {
        return current.flatMap((annotation) => {
          const entries = annotation.metadata.entries.filter((entry) => entry.id !== entryId);
          return entries.length > 0 ? [{ ...annotation, metadata: { entries } }] : [];
        });
      });
    },
    [composerDraftTarget, removeReviewComment],
  );

  const submitAnnotationEntry = useCallback(
    (entryId: string, text: string) => {
      setSelectedRange(null);
      const entry = lineAnnotations
        .flatMap((annotation) => annotation.metadata.entries)
        .find((candidate) => candidate.id === entryId);
      if (entry) {
        addReviewComment(
          composerDraftTarget,
          buildFileReviewComment({
            id: entry.id,
            filePath: relativePath,
            startLine: entry.startLine,
            endLine: entry.endLine,
            text,
            contents,
          }),
        );
      }
      setLineAnnotations((current) =>
        current.map((annotation) => ({
          ...annotation,
          metadata: {
            entries: annotation.metadata.entries.map((annotationEntry) =>
              annotationEntry.id === entryId
                ? { ...annotationEntry, kind: "comment", text }
                : annotationEntry,
            ),
          },
        })),
      );
    },
    [addReviewComment, composerDraftTarget, contents, lineAnnotations, relativePath],
  );

  const beginComment = useCallback((range: SelectedLineRange) => {
    const { startLine, endLine } = normalizeFileCommentRange(range);
    const draftEntry: FileCommentAnnotationEntry = {
      id: nextFileCommentId(),
      kind: "draft",
      startLine,
      endLine,
      text: "",
    };
    setLineAnnotations((current) => {
      const withoutDraft = current.flatMap((annotation) => {
        const entries = annotation.metadata.entries.filter((entry) => entry.kind !== "draft");
        return entries.length > 0 ? [{ ...annotation, metadata: { entries } }] : [];
      });
      const existingIndex = withoutDraft.findIndex(
        (annotation) => annotation.lineNumber === endLine,
      );
      if (existingIndex < 0) {
        return [
          ...withoutDraft,
          {
            lineNumber: endLine,
            metadata: { entries: [draftEntry] },
          },
        ];
      }
      return withoutDraft.map((annotation, index) =>
        index === existingIndex
          ? {
              ...annotation,
              metadata: { entries: [...annotation.metadata.entries, draftEntry] },
            }
          : annotation,
      );
    });
  }, []);
  const hasOpenCommentForm = lineAnnotations.some((annotation) =>
    annotation.metadata.entries.some((entry) => entry.kind === "draft"),
  );
  useEffect(() => {
    const root = surfaceRef.current;
    if (!root) return;
    return installFileEditorDismissal({
      root,
      editor,
      isBlocked: () => hasOpenCommentForm,
      onDismiss: () => setSelectedRange(null),
    });
  }, [editor, hasOpenCommentForm]);
  const handleLineSelectionEnd = useCallback(
    (range: SelectedLineRange | null) => {
      setSelectedRange(range);
      if (range) {
        beginComment(range);
      }
    },
    [beginComment],
  );
  const navigationRange = navigationLine
    ? ({ start: navigationLine, end: navigationLine } satisfies SelectedLineRange)
    : null;

  return (
    <EditorProvider editor={editor}>
      <div ref={surfaceRef} className="flex min-h-0 flex-1">
        <Virtualizer
          className="file-preview-virtualizer min-h-0 flex-1 overflow-auto"
          config={{
            overscrollSize: 600,
            intersectionObserverMargin: 1200,
          }}
        >
          <File<FileCommentAnnotationGroup>
            file={{
              name: relativePath,
              contents,
              cacheKey: projectFileCacheKey(cwd, relativePath, contents),
            }}
            options={{
              disableFileHeader: true,
              enableGutterUtility: !hasOpenCommentForm,
              enableLineSelection: !hasOpenCommentForm,
              onGutterUtilityClick: setSelectedRange,
              onLineSelectionChange: setSelectedRange,
              onLineSelectionEnd: handleLineSelectionEnd,
              onTokenClick: onTokenNavigation,
              overflow: "scroll",
              theme: editorDiffTheme.themeName,
              themeType: editorDiffTheme.themeType,
            }}
            selectedLines={selectedRange ?? navigationRange}
            lineAnnotations={lineAnnotations}
            renderAnnotation={(annotation) => (
              <div className="py-1">
                {annotation.metadata.entries.map((entry) => (
                  <LocalCommentAnnotation
                    key={entry.id}
                    kind={entry.kind}
                    rangeLabel={formatFileCommentRange(entry.startLine, entry.endLine)}
                    text={entry.text}
                    onCancel={() => removeAnnotationEntry(entry.id)}
                    onComment={(text) => submitAnnotationEntry(entry.id, text)}
                    onDelete={() => removeAnnotationEntry(entry.id)}
                  />
                ))}
              </div>
            )}
            className="min-h-full"
            contentEditable
          />
        </Virtualizer>
      </div>
    </EditorProvider>
  );
}

function RenderedMarkdownSurface({
  environmentId,
  cwd,
  relativePath,
  contents,
  threadRef,
  onPendingChange,
}: Omit<
  EditableFileSurfaceProps,
  "editorDiffTheme" | "composerDraftTarget" | "navigationLine" | "onTokenNavigation"
> & {
  threadRef: ScopedThreadRef;
}) {
  const saveCoordinator = useFileSaveCoordinator({
    environmentId,
    cwd,
    relativePath,
    onPendingChange,
  });

  return (
    <ScrollArea className="min-h-0 flex-1">
      <ChatMarkdown
        text={contents}
        cwd={cwd}
        threadRef={threadRef}
        className="mx-auto max-w-4xl px-6 py-5"
        onTaskListChange={({ markerOffset, checked }) => {
          const currentContents =
            getOptimisticProjectFileQueryData(environmentId, cwd, relativePath)?.contents ??
            contents;
          const nextContents = setMarkdownTaskChecked(currentContents, markerOffset, checked);
          if (nextContents === currentContents) return;
          setProjectFileQueryData(environmentId, cwd, relativePath, nextContents);
          saveCoordinator.change(nextContents);
        }}
      />
    </ScrollArea>
  );
}

function initialExplorerOpen(): boolean {
  try {
    return window.localStorage.getItem(FILE_EXPLORER_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

/**
 * Pull a single identifier out of a clicked syntax token. The token text usually is the bare
 * identifier, but some grammars include adjacent punctuation (`.foo`, `foo(`, `foo,`). Accept those
 * by extracting the lone identifier; bail on genuinely ambiguous multi-identifier tokens so we never
 * navigate to the wrong symbol.
 */
function extractNavigationSymbol(tokenText: string): string | null {
  const trimmed = tokenText.trim();
  const exact = trimmed.match(/^[\p{L}_$][\p{L}\p{N}_$]*$/u);
  if (exact) return exact[0];
  const identifiers = trimmed.match(/[\p{L}_$][\p{L}\p{N}_$]*/gu);
  if (identifiers && identifiers.length === 1) return identifiers[0]!;
  return null;
}

function projectEntryName(entry: ProjectEntry): string {
  const trimmedPath = entry.path.replace(/\/+$/, "");
  const lastSeparatorIndex = trimmedPath.lastIndexOf("/");
  return lastSeparatorIndex === -1 ? trimmedPath : trimmedPath.slice(lastSeparatorIndex + 1);
}

export default function FilePreviewPanel({
  environmentId,
  cwd,
  projectName,
  relativePath,
  threadRef,
  composerDraftTarget,
  keybindings,
  availableEditors,
  onOpenFile,
  onPendingChange,
}: FilePreviewPanelProps) {
  const { resolvedTheme } = useTheme();
  const editorSyntaxTheme = useSettings((settings) => settings.editorSyntaxTheme);
  const editorDiffTheme = useMemo(
    () => resolveEditorDiffTheme(editorSyntaxTheme, resolvedTheme),
    [editorSyntaxTheme, resolvedTheme],
  );
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const file = useProjectFileQuery(environmentId, cwd, relativePath);
  const projectEntriesQuery = useProjectEntriesQuery(environmentId, cwd);
  const projectEntries = projectEntriesQuery.data?.entries ?? [];
  const workspaceKey = editorWorkspaceKey(environmentId, cwd);
  const navigationRequest = useEditorNavigationStore((state) => state.navigationRequest);
  const navigationLine =
    navigationRequest?.workspaceKey === workspaceKey && navigationRequest.path === relativePath
      ? navigationRequest.lineNumber
      : null;
  const navigationRequestId = navigationLine ? navigationRequest?.requestId : null;
  const [explorerOpen, setExplorerOpen] = useState(initialExplorerOpen);
  const [explorerView, setExplorerView] = useState<ExplorerView>(initialExplorerView);
  const [markdownPreviewMode, setMarkdownPreviewMode] = useState(readMarkdownPreviewMode);
  const [treeRevealRequest, setTreeRevealRequest] = useState<{
    readonly id: number;
    readonly path: string;
  } | null>(null);
  const breadcrumbRef = useRef<HTMLDivElement>(null);
  const previewRootRef = useRef<HTMLDivElement>(null);
  const symbolNavigationRequestRef = useRef(0);
  const treeRevealRequestIdRef = useRef(0);
  const isMarkdown = relativePath ? isMarkdownPreviewFile(relativePath) : false;
  const renderMarkdown = shouldRenderMarkdownPreview(relativePath, markdownPreviewMode);
  const canOpenInBrowser =
    relativePath !== null && isPreviewSupportedInRuntime() && isBrowserPreviewFile(relativePath);
  const absolutePath = relativePath ? resolvePathLinkTarget(relativePath, cwd) : null;
  const breadcrumbs = useMemo(
    () => (relativePath ? fileBreadcrumbs(projectName, relativePath) : []),
    [projectName, relativePath],
  );
  const [symbolChoices, setSymbolChoices] = useState<{
    readonly symbol: string;
    readonly mode: "definitions" | "usages";
    readonly matches: ReadonlyArray<ProjectCodeSearchMatch>;
    readonly origin: EditorLocation | null;
  } | null>(null);
  const canGoBack = useEditorNavigationStore((state) =>
    historyCanGoBack(state, environmentId, cwd),
  );
  const canGoForward = useEditorNavigationStore((state) =>
    historyCanGoForward(state, environmentId, cwd),
  );

  useEffect(() => {
    if (!relativePath) return;
    const store = useEditorNavigationStore.getState();
    store.recordRecentFile(environmentId, cwd, relativePath);
    store.recordActiveLocation(environmentId, cwd, { path: relativePath });
  }, [cwd, environmentId, relativePath]);

  // Single owner for navigation-driven file switches: any back/forward jump or symbol jump that
  // targets a different file opens it here. Same-file jumps fall through to the scroll effect.
  const pendingNavigationPath =
    navigationRequest?.workspaceKey === workspaceKey ? navigationRequest.path : null;
  const pendingNavigationRequestId =
    navigationRequest?.workspaceKey === workspaceKey ? navigationRequest.requestId : null;
  useEffect(() => {
    if (pendingNavigationPath && pendingNavigationPath !== relativePath) {
      onOpenFile(pendingNavigationPath);
    }
  }, [onOpenFile, pendingNavigationPath, pendingNavigationRequestId, relativePath]);

  const goBack = useCallback(() => {
    useEditorNavigationStore.getState().goBack(environmentId, cwd);
  }, [cwd, environmentId]);
  const goForward = useCallback(() => {
    useEditorNavigationStore.getState().goForward(environmentId, cwd);
  }, [cwd, environmentId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey) return;
      const root = previewRootRef.current;
      if (!root) return;
      // Only act while the editor area owns focus, so chat/composer inputs keep word navigation.
      const active = document.activeElement;
      if (active && active !== document.body && !root.contains(active)) return;
      const back =
        (event.ctrlKey && !event.metaKey && event.key === "ArrowLeft") ||
        (event.metaKey && !event.ctrlKey && event.key === "[");
      const forward =
        (event.ctrlKey && !event.metaKey && event.key === "ArrowRight") ||
        (event.metaKey && !event.ctrlKey && event.key === "]");
      if (!back && !forward) return;
      event.preventDefault();
      event.stopPropagation();
      if (back) goBack();
      else goForward();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [goBack, goForward]);

  useEffect(() => {
    if (!navigationLine || !previewRootRef.current) return;
    if (isMarkdown && renderMarkdown) {
      setMarkdownPreviewMode("source");
      return;
    }
    const root = previewRootRef.current;
    const scroller = root.querySelector<HTMLElement>(".file-preview-virtualizer");
    if (!scroller) return;
    scroller.scrollTop = Math.max(0, (navigationLine - 1) * 20 - scroller.clientHeight / 3);
    let attempts = 0;
    let frame = 0;
    const reveal = () => {
      const line = root.querySelector<HTMLElement>(`[data-line="${navigationLine}"]`);
      if (line) {
        line.scrollIntoView({ block: "center" });
        return;
      }
      attempts += 1;
      if (attempts < 6) frame = window.requestAnimationFrame(reveal);
    };
    frame = window.requestAnimationFrame(reveal);
    return () => window.cancelAnimationFrame(frame);
  }, [file.data, isMarkdown, navigationLine, navigationRequestId, renderMarkdown]);

  useEffect(() => {
    const currentCrumb = breadcrumbRef.current?.querySelector<HTMLElement>(
      "[data-current-file-crumb='true']",
    );
    currentCrumb?.scrollIntoView({ block: "nearest", inline: "end" });
  }, [relativePath]);

  const selectExplorerView = (view: ExplorerView) => {
    setExplorerView(view);
    try {
      window.localStorage.setItem(EXPLORER_VIEW_STORAGE_KEY, view);
    } catch {}
  };

  const navigateToLineInCurrentFile = useCallback(
    (lineNumber: number) => {
      if (!relativePath) return;
      useEditorNavigationStore
        .getState()
        .navigateTo(environmentId, cwd, { path: relativePath, lineNumber });
    },
    [cwd, environmentId, relativePath],
  );

  const toggleExplorer = () => {
    setExplorerOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(FILE_EXPLORER_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  };

  const openNavigationTarget = useCallback(
    (match: ProjectCodeSearchMatch, from?: EditorLocation | null) => {
      useEditorNavigationStore.getState().navigateTo(
        environmentId,
        cwd,
        {
          path: match.path,
          lineNumber: match.lineNumber,
          column: match.column,
        },
        from ?? undefined,
      );
    },
    [cwd, environmentId],
  );

  const handleTokenNavigation = useCallback(
    (token: TokenEventBase, event: MouseEvent) => {
      if (!event.metaKey || !relativePath) return;
      const symbol = extractNavigationSymbol(token.tokenText);
      if (!symbol) return;
      event.preventDefault();
      event.stopPropagation();
      const origin: EditorLocation = {
        path: relativePath,
        lineNumber: token.lineNumber,
        column: 0,
      };
      const requestId = ++symbolNavigationRequestRef.current;
      void ensureEnvironmentApi(environmentId)
        .projects.searchCode({ cwd, query: symbol, scope: "navigation", limit: 120 })
        .then((result) => {
          if (requestId !== symbolNavigationRequestRef.current) return;
          const sourceMatch = result.matches.find(
            (match) => match.path === relativePath && match.lineNumber === token.lineNumber,
          );
          const mode = sourceMatch?.isDefinition ? "usages" : "definitions";
          let matches = result.matches.filter((match) =>
            mode === "usages" ? !match.isDefinition : match.isDefinition,
          );
          matches = matches.filter(
            (match) => !(match.path === relativePath && match.lineNumber === token.lineNumber),
          );
          if (matches.length === 0 && mode === "definitions") {
            matches = result.matches.filter(
              (match) => !(match.path === relativePath && match.lineNumber === token.lineNumber),
            );
          }
          matches = matches.toSorted((left, right) => {
            const leftLocal = left.path === relativePath ? 0 : 1;
            const rightLocal = right.path === relativePath ? 0 : 1;
            if (leftLocal !== rightLocal) return leftLocal - rightLocal;
            return left.path.localeCompare(right.path) || left.lineNumber - right.lineNumber;
          });
          if (matches.length === 1) {
            openNavigationTarget(matches[0]!, origin);
            return;
          }
          if (matches.length > 1) {
            setSymbolChoices({ symbol, mode, matches, origin });
            return;
          }
          toastManager.add({
            type: "info",
            title: `No ${mode} found`,
            description: symbol,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Code navigation failed",
            description: error instanceof Error ? error.message : "Unable to search this symbol.",
          });
        });
    },
    [cwd, environmentId, openNavigationTarget, relativePath],
  );

  const setRenderMarkdown = (rendered: boolean) => {
    const nextMode = rendered ? "rendered" : "source";
    setMarkdownPreviewMode(nextMode);
    writeMarkdownPreviewMode(nextMode);
  };

  const revealDirectoryInTree = (path: string) => {
    setExplorerOpen(true);
    setTreeRevealRequest({
      id: ++treeRevealRequestIdRef.current,
      path,
    });
  };

  const openEntryFromBreadcrumb = (entry: ProjectEntry) => {
    if (entry.kind === "file") {
      onOpenFile(entry.path);
      return;
    }
    const firstFile = firstFileInDirectory(projectEntries, entry.path);
    if (firstFile) {
      onOpenFile(firstFile);
      return;
    }
    revealDirectoryInTree(entry.path);
  };

  const handleBreadcrumbModifiedNavigation = (
    event: Pick<MouseEvent, "metaKey" | "preventDefault" | "stopPropagation">,
    crumb: (typeof breadcrumbs)[number],
  ): boolean => {
    if (!event.metaKey) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    revealDirectoryInTree(crumb.kind === "file" ? parentDirectoryPath(crumb.path) : crumb.path);
    return true;
  };

  const handleOpenInBrowser = () => {
    if (!absolutePath) return;
    void openFileInPreview(threadRef, absolutePath).catch((error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to open file in browser",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    });
  };

  return (
    <div
      ref={previewRootRef}
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
    >
      <EditorNavigationDialog
        environmentId={environmentId}
        cwd={cwd}
        projectName={projectName}
        entries={projectEntries}
        onOpenFile={onOpenFile}
        onToggleExplorer={toggleExplorer}
        onRefreshFiles={projectEntriesQuery.refresh}
      />
      <SymbolNavigationDialog
        open={symbolChoices !== null}
        symbol={symbolChoices?.symbol ?? ""}
        mode={symbolChoices?.mode ?? "definitions"}
        matches={symbolChoices?.matches ?? []}
        onOpenChange={(open) => {
          if (!open) setSymbolChoices(null);
        }}
        onSelect={(match) => openNavigationTarget(match, symbolChoices?.origin)}
      />
      {relativePath ? (
        <div className="surface-subheader gap-2 px-3" data-surface-subheader>
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={goBack}
                    disabled={!canGoBack}
                    aria-label="Go back to previous location"
                    className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:text-muted-foreground/40"
                  >
                    <ArrowLeft className="size-4" />
                  </button>
                }
              />
              <TooltipPopup>Back (⌘[ / Ctrl+←)</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={goForward}
                    disabled={!canGoForward}
                    aria-label="Go forward to next location"
                    className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:text-muted-foreground/40"
                  >
                    <ArrowRight className="size-4" />
                  </button>
                }
              />
              <TooltipPopup>Forward (⌘] / Ctrl+→)</TooltipPopup>
            </Tooltip>
          </div>
          <ScrollArea
            ref={breadcrumbRef}
            hideScrollbars
            scrollFade
            className="min-w-0 flex-1 rounded-none"
            data-file-breadcrumbs
          >
            <div className="flex h-full w-max min-w-full items-center text-xs">
              {breadcrumbs.map((crumb, index) => (
                <div
                  key={crumb.path || "project"}
                  className="flex min-w-0 shrink-0 items-center"
                  data-current-file-crumb={crumb.kind === "file"}
                >
                  {index > 0 ? (
                    <ChevronRight className="mx-1 size-3.5 shrink-0 text-muted-foreground/60" />
                  ) : null}
                  {crumb.kind === "file" ? (
                    <button
                      type="button"
                      className="max-w-40 truncate rounded px-1 py-0.5 text-left font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={crumb.path || projectName}
                      onClick={(event) => {
                        handleBreadcrumbModifiedNavigation(event, crumb);
                      }}
                    >
                      {crumb.label}
                    </button>
                  ) : (
                    <Menu>
                      <MenuTrigger
                        render={
                          <button
                            type="button"
                            className="max-w-40 truncate rounded px-1 py-0.5 text-left text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            title={crumb.path || projectName}
                            onClick={(event) => {
                              handleBreadcrumbModifiedNavigation(event, crumb);
                            }}
                            onPointerDown={(event) => {
                              handleBreadcrumbModifiedNavigation(event, crumb);
                            }}
                          />
                        }
                      >
                        {crumb.label}
                      </MenuTrigger>
                      <MenuPopup align="start" className="w-72">
                        {directChildProjectEntries(projectEntries, crumb.path)
                          .slice(0, MAX_BREADCRUMB_CHILDREN)
                          .map((entry) => (
                            <MenuItem
                              key={entry.path}
                              className="min-w-0"
                              onClick={() => openEntryFromBreadcrumb(entry)}
                            >
                              {entry.kind === "directory" ? (
                                <Folder className="size-4" />
                              ) : (
                                <FileText className="size-4" />
                              )}
                              <span className="min-w-0 flex-1 truncate">
                                {projectEntryName(entry)}
                              </span>
                            </MenuItem>
                          ))}
                        {directChildProjectEntries(projectEntries, crumb.path).length === 0 ? (
                          <MenuItem disabled>No children</MenuItem>
                        ) : null}
                      </MenuPopup>
                    </Menu>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
          {absolutePath && environmentId === primaryEnvironmentId ? (
            <OpenInPicker
              keybindings={keybindings}
              availableEditors={availableEditors}
              openInCwd={absolutePath}
              compact
              enableShortcut={false}
            />
          ) : null}
          {isMarkdown ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Toggle
                    className="shrink-0"
                    pressed={renderMarkdown}
                    onPressedChange={setRenderMarkdown}
                    aria-label={renderMarkdown ? "Show markdown source" : "Show rendered markdown"}
                    variant="ghost"
                    size="sm"
                  >
                    {renderMarkdown ? <Code2 className="size-3.5" /> : <Eye className="size-3.5" />}
                  </Toggle>
                }
              />
              <TooltipPopup>
                {renderMarkdown ? "Show markdown source" : "Show rendered markdown"}
              </TooltipPopup>
            </Tooltip>
          ) : null}
          {canOpenInBrowser ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Toggle
                    className="shrink-0"
                    pressed={false}
                    onPressedChange={handleOpenInBrowser}
                    aria-label="Open file in preview browser"
                    variant="ghost"
                    size="sm"
                  >
                    <Globe2 className="size-3.5" />
                  </Toggle>
                }
              />
              <TooltipPopup>Open file in preview browser</TooltipPopup>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  className="shrink-0"
                  pressed={explorerOpen}
                  onPressedChange={toggleExplorer}
                  aria-label={explorerOpen ? "Hide file explorer" : "Show file explorer"}
                  variant="ghost"
                  size="sm"
                >
                  <FolderTree className="size-3.5" />
                </Toggle>
              }
            />
            <TooltipPopup>
              {explorerOpen ? "Hide file explorer" : "Show file explorer"}
            </TooltipPopup>
          </Tooltip>
        </div>
      ) : null}
      {relativePath && file.data?.truncated ? (
        <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/8 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          Preview limited to the first 1 MB of a {file.data.byteLength.toLocaleString()} byte file.
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={cn(
            "min-w-0 flex-1 flex-col overflow-hidden",
            relativePath ? "flex" : "hidden",
          )}
        >
          {relativePath && file.error && file.data === null ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs leading-relaxed text-destructive">
              {file.error}
            </div>
          ) : relativePath && file.data === null ? (
            <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
              <LoaderCircle className="size-5 animate-spin" />
            </div>
          ) : relativePath && file.data ? (
            isMarkdown && renderMarkdown ? (
              <RenderedMarkdownSurface
                environmentId={environmentId}
                cwd={cwd}
                relativePath={relativePath}
                threadRef={threadRef}
                contents={file.data.contents}
                onPendingChange={onPendingChange}
              />
            ) : file.data.truncated ? (
              <Virtualizer
                key={`${relativePath}:${editorDiffTheme.themeName}:${file.data.byteLength}`}
                className="file-preview-virtualizer min-h-0 flex-1 overflow-auto"
                config={{
                  overscrollSize: 600,
                  intersectionObserverMargin: 1200,
                }}
              >
                <File
                  file={{
                    name: relativePath,
                    contents: file.data.contents,
                    cacheKey: projectFileCacheKey(cwd, relativePath, file.data.contents),
                  }}
                  options={{
                    disableFileHeader: true,
                    overflow: "scroll",
                    theme: editorDiffTheme.themeName,
                    themeType: editorDiffTheme.themeType,
                    onTokenClick: handleTokenNavigation,
                  }}
                  selectedLines={
                    navigationLine ? { start: navigationLine, end: navigationLine } : null
                  }
                  className="min-h-full"
                />
              </Virtualizer>
            ) : (
              <EditableFileSurface
                key={`${relativePath}:${editorDiffTheme.themeName}`}
                environmentId={environmentId}
                cwd={cwd}
                relativePath={relativePath}
                composerDraftTarget={composerDraftTarget}
                contents={file.data.contents}
                editorDiffTheme={editorDiffTheme}
                navigationLine={navigationLine}
                onTokenNavigation={handleTokenNavigation}
                onPendingChange={onPendingChange}
              />
            )
          ) : null}
        </div>
        {explorerOpen || relativePath === null ? (
          <aside
            className={cn(
              "flex min-h-0 shrink-0 flex-col bg-background",
              relativePath
                ? "w-[min(22rem,46%)] min-w-64 border-l border-border/60"
                : "min-w-0 flex-1",
            )}
          >
            {relativePath ? (
              <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/60 px-1.5">
                {(["files", "structure"] as const).map((view) => (
                  <button
                    key={view}
                    type="button"
                    className={cn(
                      "h-6 flex-1 rounded text-xs font-medium capitalize",
                      explorerView === view
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                    onClick={() => selectExplorerView(view)}
                  >
                    {view}
                  </button>
                ))}
              </div>
            ) : null}
            {relativePath && explorerView === "structure" ? (
              <FileStructurePanel
                relativePath={relativePath}
                contents={file.data?.contents ?? null}
                loading={file.data === null}
                onNavigate={navigateToLineInCurrentFile}
              />
            ) : (
              <FileBrowserPanel
                key={`${environmentId}:${cwd}`}
                environmentId={environmentId}
                cwd={cwd}
                projectName={projectName}
                revealRequest={treeRevealRequest}
                activeRelativePath={relativePath}
                onOpenFile={onOpenFile}
              />
            )}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
