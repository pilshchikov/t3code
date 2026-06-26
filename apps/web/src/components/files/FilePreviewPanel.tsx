import type {
  EditorId,
  EnvironmentId,
  ProjectCodeSearchMatch,
  ProjectEntry,
  ResolvedKeybindingsConfig,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { VirtualizedFile, type SelectedLineRange, type TokenEventBase } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/editor";
import { EditorProvider, File, type FileOptions, Virtualizer } from "@pierre/diffs/react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
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
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isBrowserPreviewFile, openFileInPreview } from "~/browser/openFileInPreview";
import ChatMarkdown from "~/components/ChatMarkdown";
import { OpenInPicker } from "~/components/chat/OpenInPicker";
import {
  canGoBack as historyCanGoBack,
  canGoForward as historyCanGoForward,
  editorWorkspaceKey,
  useEditorNavigationStore,
  type EditorLocation,
} from "~/editorNavigationStore";
import { useExplorerViewStore } from "~/explorerViewStore";
import { useClientSettings } from "~/hooks/useSettings";
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
import { assetEnvironment } from "~/state/assets";
import { useEnvironmentHttpBaseUrl, usePrimaryEnvironmentId } from "~/state/environments";
import { previewEnvironment } from "~/state/preview";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";

import FileBrowserPanel from "./FileBrowserPanel";
import FileStructurePanel from "./FileStructurePanel";
import GitChangesPanel from "./GitChangesPanel";
import { CommitFileDiffView } from "./CommitFileDiffView";
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
  revealLine: number | null;
  revealRequestId: number;
  onOpenFile: (relativePath: string) => void;
  onPendingChange: (relativePath: string, pending: boolean) => void;
}

const FILE_SAVE_DEBOUNCE_MS = 500;
const MAX_BREADCRUMB_CHILDREN = 80;
const FILE_LINK_REVEAL_ATTRIBUTE = "data-file-link-reveal";
const FILE_LINK_REVEAL_UNSAFE_CSS = `
  [${FILE_LINK_REVEAL_ATTRIBUTE}][data-line] {
    background-color: light-dark(
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 82%,
        var(--diffs-bg-selection-override, var(--diffs-selection-base))
      ),
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 75%,
        var(--diffs-bg-selection-override, var(--diffs-selection-base))
      )
    ) !important;
  }

  [${FILE_LINK_REVEAL_ATTRIBUTE}][data-column-number] {
    background-color: light-dark(
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 75%,
        var(--diffs-bg-selection-number-override, var(--diffs-selection-base))
      ),
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 60%,
        var(--diffs-bg-selection-number-override, var(--diffs-selection-base))
      )
    ) !important;
    color: var(--diffs-selection-number-fg) !important;
  }
`;
type FilePostRender = NonNullable<FileOptions<unknown>["onPostRender"]>;

function clampFileLine(contents: string, requestedLine: number): number {
  let lineCount = 1;
  for (let index = 0; index < contents.length; index += 1) {
    const character = contents.charCodeAt(index);
    if (character === 10) {
      lineCount += 1;
    } else if (character === 13) {
      lineCount += 1;
      if (contents.charCodeAt(index + 1) === 10) index += 1;
    }
  }
  return Math.min(Math.max(1, requestedLine), lineCount);
}

function updateFileLinkReveal(fileContainer: HTMLElement, line: number | null): void {
  const root = fileContainer.shadowRoot ?? fileContainer;
  for (const element of root.querySelectorAll<HTMLElement>(`[${FILE_LINK_REVEAL_ATTRIBUTE}]`)) {
    element.removeAttribute(FILE_LINK_REVEAL_ATTRIBUTE);
  }
  if (line === null) return;

  root
    .querySelector<HTMLElement>(`[data-line="${line}"]`)
    ?.setAttribute(FILE_LINK_REVEAL_ATTRIBUTE, "");
  root
    .querySelector<HTMLElement>(`[data-column-number="${line}"]`)
    ?.setAttribute(FILE_LINK_REVEAL_ATTRIBUTE, "");
}

function useFileLineReveal(
  relativePath: string | null,
  revealLine: number | null,
  revealRequestId: number,
): FilePostRender {
  const [handledRequestIdsByPath] = useState(() => new Map<string, number>());
  const [latestRequestIdsByPath] = useState(() => new Map<string, number>());
  const [pendingFramesByPath] = useState(() => new Map<string, number>());

  return useCallback<FilePostRender>(
    (fileContainer, instance, phase) => {
      if (relativePath === null) return;

      const cancelPendingReveal = () => {
        const frameId = pendingFramesByPath.get(relativePath);
        if (frameId !== undefined) {
          cancelAnimationFrame(frameId);
          pendingFramesByPath.delete(relativePath);
        }
      };

      if (phase === "unmount") {
        cancelPendingReveal();
        return;
      }

      const targetLine =
        revealLine === null ? null : clampFileLine(instance.file?.contents ?? "", revealLine);
      updateFileLinkReveal(fileContainer, targetLine);

      if (!(instance instanceof VirtualizedFile)) return;

      if (latestRequestIdsByPath.get(relativePath) !== revealRequestId) {
        cancelPendingReveal();
        latestRequestIdsByPath.set(relativePath, revealRequestId);
      }

      if (targetLine === null) {
        fileContainer.style.minHeight = "";
        return;
      }

      const scrollContainer = fileContainer.closest<HTMLElement>(".file-preview-virtualizer");
      if (!scrollContainer) return;
      fileContainer.style.minHeight = `${Math.ceil(
        Math.max(instance.height, scrollContainer.clientHeight),
      )}px`;

      if (
        handledRequestIdsByPath.get(relativePath) === revealRequestId ||
        pendingFramesByPath.has(relativePath)
      ) {
        return;
      }

      const reveal = () => {
        pendingFramesByPath.delete(relativePath);
        if (
          latestRequestIdsByPath.get(relativePath) !== revealRequestId ||
          !fileContainer.isConnected
        ) {
          return;
        }

        const linePosition = instance.getLinePosition(targetLine);
        if (!linePosition) return;

        const fileTop =
          scrollContainer.scrollTop +
          fileContainer.getBoundingClientRect().top -
          scrollContainer.getBoundingClientRect().top;
        const centeredTop = Math.max(
          0,
          fileTop +
            linePosition.top -
            Math.max(0, (scrollContainer.clientHeight - linePosition.height) / 2),
        );
        const maxScrollTop = Math.max(
          0,
          scrollContainer.scrollHeight - scrollContainer.clientHeight,
        );

        scrollContainer.scrollTop = Math.min(centeredTop, maxScrollTop);
        handledRequestIdsByPath.set(relativePath, revealRequestId);
      };

      pendingFramesByPath.set(relativePath, requestAnimationFrame(reveal));
    },
    [
      handledRequestIdsByPath,
      latestRequestIdsByPath,
      pendingFramesByPath,
      relativePath,
      revealLine,
      revealRequestId,
    ],
  );
}

interface EditableFileSurfaceProps {
  environmentId: EnvironmentId;
  cwd: string;
  relativePath: string;
  composerDraftTarget: ScopedThreadRef | DraftId;
  contents: string;
  editorDiffTheme: ResolvedEditorDiffTheme;
  revealRequestId: number;
  wordWrap: boolean;
  onPostRender: FilePostRender;
  onTokenNavigation: (token: TokenEventBase, event: MouseEvent) => void;
  onPendingChange: (relativePath: string, pending: boolean) => void;
}

interface FileSelectionOverride {
  revealRequestId: number;
  range: SelectedLineRange | null;
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
  const writeFile = useAtomCommand(projectEnvironment.writeFile);
  const coordinator = useMemo(
    () =>
      new FileSaveCoordinator({
        debounceMs: FILE_SAVE_DEBOUNCE_MS,
        onPendingChange: (pending) => onPendingChange(relativePath, pending),
        persist: (nextContents) =>
          writeFile({
            environmentId,
            input: { cwd, relativePath, contents: nextContents },
          }),
        onConfirmed: (confirmedContents) => {
          confirmProjectFileQueryData(environmentId, cwd, relativePath, confirmedContents);
        },
      }),
    [cwd, environmentId, onPendingChange, relativePath, writeFile],
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
  revealRequestId,
  wordWrap,
  onPostRender,
  onTokenNavigation,
  onPendingChange,
}: EditableFileSurfaceProps) {
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const removeReviewComment = useComposerDraftStore((store) => store.removeReviewComment);
  const [lineAnnotations, setLineAnnotations] = useState<FileCommentLineAnnotation[]>([]);
  const [selectionOverride, setSelectionOverride] = useState<FileSelectionOverride | null>(null);
  const selectedRange =
    selectionOverride?.revealRequestId === revealRequestId ? selectionOverride.range : null;
  const setSelectedRange = useCallback(
    (range: SelectedLineRange | null) => {
      setSelectionOverride({ revealRequestId, range });
    },
    [revealRequestId],
  );
  const surfaceRef = useRef<HTMLDivElement>(null);
  const selectionFrameRef = useRef<number | null>(null);
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
    [composerDraftTarget, removeReviewComment, setSelectedRange],
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
    [
      addReviewComment,
      composerDraftTarget,
      contents,
      lineAnnotations,
      relativePath,
      setSelectedRange,
    ],
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
  }, [editor, hasOpenCommentForm, setSelectedRange]);
  const handleLineSelectionEnd = useCallback(
    (range: SelectedLineRange | null) => {
      setSelectedRange(range);
      if (range) {
        beginComment(range);
      }
    },
    [beginComment, setSelectedRange],
  );

  const handlePostRender = useCallback<FilePostRender>(
    (fileContainer, instance, phase) => {
      onPostRender(fileContainer, instance, phase);

      if (selectionFrameRef.current !== null) {
        cancelAnimationFrame(selectionFrameRef.current);
        selectionFrameRef.current = null;
      }
      if (phase === "unmount") return;

      selectionFrameRef.current = requestAnimationFrame(() => {
        selectionFrameRef.current = null;
        if (!fileContainer.isConnected) return;
        instance.setSelectedLines(selectedRange, { notify: false });
      });
    },
    [onPostRender, selectedRange],
  );

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
              theme: editorDiffTheme.themeName,
              themeType: editorDiffTheme.themeType,
              overflow: wordWrap ? "wrap" : "scroll",
              unsafeCSS: FILE_LINK_REVEAL_UNSAFE_CSS,
              onPostRender: handlePostRender,
            }}
            selectedLines={selectedRange}
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
  | "editorDiffTheme"
  | "composerDraftTarget"
  | "revealRequestId"
  | "wordWrap"
  | "onPostRender"
  | "onTokenNavigation"
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

function extractNavigationSymbol(tokenText: string): string | null {
  const trimmed = tokenText.trim();
  const exact = trimmed.match(/^[\p{L}_$][\p{L}\p{N}_$]*$/u);
  if (exact) return exact[0];
  const identifiers = trimmed.match(/[\p{L}_$][\p{L}\p{N}_$]*/gu);
  return identifiers?.length === 1 ? identifiers[0]! : null;
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
  revealLine,
  revealRequestId,
  onOpenFile,
  onPendingChange,
}: FilePreviewPanelProps) {
  const { resolvedTheme } = useTheme();
  const editorSyntaxTheme = useClientSettings((settings) => settings.editorSyntaxTheme);
  const editorDiffTheme = useMemo(
    () => resolveEditorDiffTheme(editorSyntaxTheme, resolvedTheme),
    [editorSyntaxTheme, resolvedTheme],
  );
  const wordWrap = useClientSettings((settings) => settings.wordWrap);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentHttpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const createAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
  });
  const openPreview = useAtomCommand(previewEnvironment.open, {
    reportFailure: false,
  });
  const searchCode = useAtomQueryRunner(projectEnvironment.searchCode, {
    reportFailure: false,
  });
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
  const effectiveRevealLine = navigationLine ?? revealLine;
  const effectiveRevealRequestId = navigationRequestId ?? revealRequestId;
  const explorerOpen = useExplorerViewStore((state) => state.open);
  const explorerView = useExplorerViewStore((state) => state.view);
  const selectExplorerView = useExplorerViewStore((state) => state.setView);
  const toggleExplorer = useExplorerViewStore((state) => state.toggleOpen);
  // Path whose diff is shown (over the editor) when a file is clicked in the Commit view.
  const [commitDiffPath, setCommitDiffPath] = useState<string | null>(null);
  useEffect(() => {
    if (explorerView !== "commit") setCommitDiffPath(null);
  }, [explorerView]);
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
  const renderMarkdown =
    effectiveRevealLine === null && shouldRenderMarkdownPreview(relativePath, markdownPreviewMode);
  const canOpenInBrowser =
    relativePath !== null && isPreviewSupportedInRuntime() && isBrowserPreviewFile(relativePath);
  const absolutePath = relativePath ? resolvePathLinkTarget(relativePath, cwd) : null;
  const breadcrumbs = useMemo(
    () => (relativePath ? fileBreadcrumbs(projectName, relativePath) : []),
    [projectName, relativePath],
  );
  const onFilePostRender = useFileLineReveal(
    relativePath,
    effectiveRevealLine,
    effectiveRevealRequestId,
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
    const currentCrumb = breadcrumbRef.current?.querySelector<HTMLElement>(
      "[data-current-file-crumb='true']",
    );
    currentCrumb?.scrollIntoView({ block: "nearest", inline: "end" });
  }, [relativePath]);

  const navigateToLineInCurrentFile = useCallback(
    (lineNumber: number) => {
      if (!relativePath) return;
      useEditorNavigationStore
        .getState()
        .navigateTo(environmentId, cwd, { path: relativePath, lineNumber });
    },
    [cwd, environmentId, relativePath],
  );

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
      void searchCode({
        environmentId,
        input: { cwd, query: symbol, scope: "navigation", limit: 120 },
      })
        .then((result) => {
          if (requestId !== symbolNavigationRequestRef.current) return;
          if (result._tag !== "Success") throw squashAtomCommandFailure(result);
          const sourceMatch = result.value.matches.find(
            (match) => match.path === relativePath && match.lineNumber === token.lineNumber,
          );
          const mode = sourceMatch?.isDefinition ? "usages" : "definitions";
          let matches = result.value.matches.filter((match) =>
            mode === "usages" ? !match.isDefinition : match.isDefinition,
          );
          matches = matches.filter(
            (match) => !(match.path === relativePath && match.lineNumber === token.lineNumber),
          );
          if (matches.length === 0 && mode === "definitions") {
            matches = result.value.matches.filter(
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
          } else if (matches.length > 1) {
            setSymbolChoices({ symbol, mode, matches, origin });
          } else {
            toastManager.add({ type: "info", title: `No ${mode} found`, description: symbol });
          }
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Code navigation failed",
            description: error instanceof Error ? error.message : "Unable to search this symbol.",
          });
        });
    },
    [cwd, environmentId, openNavigationTarget, relativePath, searchCode],
  );

  const setRenderMarkdown = (rendered: boolean) => {
    const nextMode = rendered ? "rendered" : "source";
    setMarkdownPreviewMode(nextMode);
    writeMarkdownPreviewMode(nextMode);
  };

  const revealDirectoryInTree = (path: string) => {
    useExplorerViewStore.getState().setOpen(true);
    setTreeRevealRequest({ id: ++treeRevealRequestIdRef.current, path });
  };

  const openEntryFromBreadcrumb = (entry: ProjectEntry) => {
    if (entry.kind === "file") {
      onOpenFile(entry.path);
      return;
    }
    const firstFile = firstFileInDirectory(projectEntries, entry.path);
    if (firstFile) onOpenFile(firstFile);
    else revealDirectoryInTree(entry.path);
  };

  const handleBreadcrumbModifiedNavigation = (
    event: Pick<MouseEvent, "metaKey" | "preventDefault" | "stopPropagation">,
    crumb: (typeof breadcrumbs)[number],
  ): boolean => {
    if (!event.metaKey) return false;
    event.preventDefault();
    event.stopPropagation();
    revealDirectoryInTree(crumb.kind === "file" ? parentDirectoryPath(crumb.path) : crumb.path);
    return true;
  };

  const handleOpenInBrowser = useCallback(() => {
    if (!absolutePath || !environmentHttpBaseUrl) return;
    void (async () => {
      const result = await openFileInPreview({
        threadRef,
        filePath: absolutePath,
        httpBaseUrl: environmentHttpBaseUrl,
        createAssetUrl,
        openPreview,
      });
      if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
        return;
      }
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to open file in browser",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    })();
  }, [absolutePath, createAssetUrl, environmentHttpBaseUrl, openPreview, threadRef]);

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
      {relativePath && !commitDiffPath ? (
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
                    className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  />
                }
              >
                <ArrowLeft className="size-4" />
              </TooltipTrigger>
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
                    className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  />
                }
              >
                <ArrowRight className="size-4" />
              </TooltipTrigger>
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
                      className="max-w-40 truncate rounded px-1 py-0.5 text-left font-medium text-foreground hover:bg-accent"
                      title={crumb.path || projectName}
                      onClick={(event) => handleBreadcrumbModifiedNavigation(event, crumb)}
                    >
                      {crumb.label}
                    </button>
                  ) : (
                    <Menu>
                      <MenuTrigger
                        render={
                          <button
                            type="button"
                            className="max-w-40 truncate rounded px-1 py-0.5 text-left text-muted-foreground hover:bg-accent hover:text-foreground"
                            title={crumb.path || projectName}
                            onClick={(event) => handleBreadcrumbModifiedNavigation(event, crumb)}
                            onPointerDown={(event) =>
                              handleBreadcrumbModifiedNavigation(event, crumb)
                            }
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
              environmentId={environmentId}
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
            "relative min-w-0 flex-1 flex-col overflow-hidden",
            relativePath || commitDiffPath ? "flex" : "hidden",
          )}
        >
          {commitDiffPath ? (
            <div className="absolute inset-0 z-10 flex min-h-0 flex-col bg-background">
              <div className="surface-subheader gap-2 px-3" data-surface-subheader>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                  {commitDiffPath}
                </span>
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Close diff"
                  title="Close diff"
                  onClick={() => setCommitDiffPath(null)}
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <CommitFileDiffView
                key={`${commitDiffPath}:${environmentId}:${cwd}`}
                environmentId={environmentId}
                cwd={cwd}
                path={commitDiffPath}
                composerDraftTarget={composerDraftTarget}
              />
            </div>
          ) : null}
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
                    theme: editorDiffTheme.themeName,
                    themeType: editorDiffTheme.themeType,
                    onTokenClick: handleTokenNavigation,
                    overflow: wordWrap ? "wrap" : "scroll",
                    unsafeCSS: FILE_LINK_REVEAL_UNSAFE_CSS,
                    onPostRender: onFilePostRender,
                  }}
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
                revealRequestId={effectiveRevealRequestId}
                wordWrap={wordWrap}
                onPostRender={onFilePostRender}
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
            <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/60 px-1.5">
              {(["files", "structure", "commit"] as const).map((view) => (
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
            {explorerView === "commit" ? (
              <GitChangesPanel
                key={`commit:${environmentId}:${cwd}`}
                environmentId={environmentId}
                cwd={cwd}
                threadRef={threadRef}
                selectedPath={commitDiffPath}
                onShowDiff={setCommitDiffPath}
              />
            ) : relativePath && explorerView === "structure" ? (
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
