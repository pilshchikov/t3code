import type {
  EditorId,
  EnvironmentId,
  ProjectCodeSearchMatch,
  ProjectEntry,
  ProjectWorkspace,
  ResolvedKeybindingsConfig,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";
import { VirtualizedFile, type SelectedLineRange, type TokenEventBase } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/editor";
import { EditProvider, File, type FileOptions, Virtualizer } from "@pierre/diffs/react";
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
  GripHorizontal,
  LoaderCircle,
  X,
} from "lucide-react";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isBrowserPreviewFile, openFileInPreview } from "~/browser/openFileInPreview";
import { useAssetUrlState } from "~/assets/assetUrls";
import ChatMarkdown from "~/components/ChatMarkdown";
import { OpenInPicker } from "~/components/chat/OpenInPicker";
import {
  canGoBack as historyCanGoBack,
  canGoForward as historyCanGoForward,
  editorWorkspaceKey,
  type EditorLocation,
  useEditorNavigationStore,
} from "~/editorNavigationStore";
import { useExplorerViewStore } from "~/explorerViewStore";
import { useRemoteOpenState } from "~/remoteOpen";
import { useClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useWorkspaceMutationRefresh } from "~/hooks/useWorkspaceMutationRefresh";
import { DIFF_SURFACE_THEME_UNSAFE_CSS, resolveDiffThemeName } from "~/lib/diffRendering";
import { cn } from "~/lib/utils";
import {
  resolveWorkspaceColor,
  workspaceColorOption,
  workspaceDirectoryName,
} from "~/lib/projectWorkspacePresentation";
import { isPreviewSupportedInRuntime } from "~/previewStateStore";
import { resolvePathLinkTarget } from "~/terminal-links";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Toggle } from "~/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { ResizableColumns } from "~/components/ui/resizable-columns";
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
import { resolveFileEditorHistoryAction } from "./fileEditorUndo";
import { resolveCenteredFileLineScrollTop } from "./fileLineReveal";
import { resolveFilePreviewRoots } from "./filePreviewRoots";
import { DiffCommentAnnotation } from "../diffs/DiffCommentAnnotation";
import { projectFileCacheKey, projectFileEditorCacheKey } from "./fileContentRevision";
import {
  directChildProjectEntries,
  fileBreadcrumbs,
  firstFileInDirectory,
  workspaceDocumentDirectory,
} from "./filePath";
import { isMarkdownPreviewFile, setMarkdownTaskChecked } from "./filePreviewMode";
import { FileSaveCoordinator } from "./fileSaveCoordinator";
import {
  confirmProjectFileQueryData,
  getOptimisticProjectFileQueryData,
  setProjectFileQueryData,
  useProjectEntriesQuery,
  useProjectFileQuery,
} from "./projectFilesQueryState";
import { SymbolNavigationDialog } from "./SymbolNavigationDialog";

interface FilePreviewPanelProps {
  environmentId: EnvironmentId;
  primaryCwd: string;
  cwd: string;
  projectName: string;
  relativePath: string | null;
  threadRef: ScopedThreadRef;
  composerDraftTarget: ScopedThreadRef | DraftId;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  revealLine: number | null;
  revealRequestId: number;
  onOpenFile: (relativePath: string, workspaceRoot?: string) => void;
  onPendingChange: (relativePath: string, pending: boolean) => void;
  selectedFilePending: boolean;
  workspaceMutationId: string | null;
  workspaceRoots?: ReadonlyArray<ProjectWorkspace> | undefined;
}

const RENDER_MARKDOWN_STORAGE_KEY = "t3code.renderMarkdown";
const MAX_BREADCRUMB_CHILDREN = 80;
const FILE_SAVE_DEBOUNCE_MS = 500;
const FILE_LINK_REVEAL_ATTRIBUTE = "data-file-link-reveal";
const FILE_LINK_REVEAL_UNSAFE_CSS = `
  ${DIFF_SURFACE_THEME_UNSAFE_CSS}

  diffs-container {
    --diffs-bg: var(--code-background, var(--background)) !important;
    --diffs-light-bg: var(--code-background, var(--background)) !important;
    --diffs-dark-bg: var(--code-background, var(--background)) !important;
    background-color: var(--code-background, var(--background)) !important;
    color: var(--code-foreground, var(--foreground)) !important;
  }

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

function WorkspaceImagePreview(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly absolutePath: string;
  readonly alt: string;
  readonly workspaceMutationId: string | null;
}) {
  const assetUrl = useAssetUrlState(props.environmentId, {
    _tag: "workspace-file",
    threadId: props.threadRef.threadId,
    path: props.absolutePath,
  });
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const revisionSuffix =
    props.workspaceMutationId === null
      ? ""
      : `${assetUrl._tag === "Success" && assetUrl.url.includes("?") ? "&" : "?"}workspace-revision=${encodeURIComponent(props.workspaceMutationId)}`;
  const imageUrl = assetUrl._tag === "Success" ? `${assetUrl.url}${revisionSuffix}` : null;

  if (assetUrl._tag === "Failure" || (imageUrl !== null && failedUrl === imageUrl)) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs leading-relaxed text-destructive">
        Unable to load workspace image.
      </div>
    );
  }

  return assetUrl._tag === "Success" && imageUrl !== null ? (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
      <img
        className="max-h-full max-w-full object-contain"
        src={imageUrl}
        alt={props.alt}
        onError={() => setFailedUrl(imageUrl)}
      />
    </div>
  ) : (
    <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
      <LoaderCircle className="size-5 animate-spin" />
    </div>
  );
}

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

/**
 * Frames to keep retrying while the file contents or line metrics are not
 * available yet (fresh mounts hydrate asynchronously).
 */
const REVEAL_MAX_ATTEMPTS = 30;
/**
 * After scrolling to the target, hold it for a short window so late
 * programmatic scroll resets (editable-editor focus and state restoration)
 * cannot silently snap the file back to the top. Real user input cancels the
 * guard immediately.
 */
const REVEAL_GUARD_FRAMES = 20;
const REVEAL_GUARD_TOLERANCE_PX = 2;

interface FileRevealState {
  frameId: number | null;
  cancelGuard: (() => void) | null;
  handledRequestId: number | null;
  latestRequestId: number | null;
}

function useFileLineReveal(
  relativePath: string | null,
  revealLine: number | null,
  revealRequestId: number,
): FilePostRender {
  const [revealStatesByPath] = useState(() => new Map<string, FileRevealState>());

  return useCallback<FilePostRender>(
    (fileContainer, instance, phase) => {
      if (relativePath === null) return;

      const existingState = revealStatesByPath.get(relativePath);
      const state: FileRevealState = existingState ?? {
        frameId: null,
        cancelGuard: null,
        handledRequestId: null,
        latestRequestId: null,
      };
      if (!existingState) revealStatesByPath.set(relativePath, state);

      const cancelPendingReveal = () => {
        if (state.frameId !== null) {
          cancelAnimationFrame(state.frameId);
          state.frameId = null;
        }
        state.cancelGuard?.();
      };

      if (phase === "unmount") {
        cancelPendingReveal();
        return;
      }

      const contents = instance.file?.contents;
      const targetLine =
        revealLine === null || contents === undefined ? null : clampFileLine(contents, revealLine);
      updateFileLinkReveal(fileContainer, targetLine);

      if (!(instance instanceof VirtualizedFile)) return;

      if (state.latestRequestId !== revealRequestId) {
        cancelPendingReveal();
        state.latestRequestId = revealRequestId;
        state.handledRequestId = null;
      }

      if (revealLine === null) {
        fileContainer.style.minHeight = "";
        return;
      }

      const scrollContainer = fileContainer.closest<HTMLElement>(".file-preview-virtualizer");
      if (!scrollContainer) return;
      fileContainer.style.minHeight = `${Math.ceil(
        Math.max(instance.height, scrollContainer.clientHeight),
      )}px`;

      if (state.handledRequestId === revealRequestId || state.frameId !== null) {
        return;
      }

      const resolveScrollTarget = (line: number): number | null => {
        const linePosition = instance.getLinePosition(line);
        if (!linePosition) return null;

        const scrollContainerRect = scrollContainer.getBoundingClientRect();
        const fileTop =
          scrollContainer.scrollTop +
          fileContainer.getBoundingClientRect().top -
          scrollContainerRect.top;
        const root = fileContainer.shadowRoot ?? fileContainer;
        const renderedLineElement = root.querySelector<HTMLElement>(`[data-line="${line}"]`);
        const renderedLineRect = renderedLineElement?.getBoundingClientRect();

        return resolveCenteredFileLineScrollTop({
          scrollTop: scrollContainer.scrollTop,
          scrollHeight: scrollContainer.scrollHeight,
          viewportTop: scrollContainerRect.top,
          viewportHeight: scrollContainer.clientHeight,
          fileTop,
          estimatedLine: linePosition,
          ...(renderedLineRect && renderedLineRect.height > 0
            ? {
                renderedLine: {
                  top: renderedLineRect.top,
                  height: renderedLineRect.height,
                },
              }
            : {}),
        });
      };

      const guardScrollTarget = (line: number) => {
        let framesLeft = REVEAL_GUARD_FRAMES;
        let guardFrameId: number | null = null;
        const cancelGuard = () => {
          if (guardFrameId !== null) {
            cancelAnimationFrame(guardFrameId);
            guardFrameId = null;
          }
          scrollContainer.removeEventListener("wheel", cancelGuard);
          scrollContainer.removeEventListener("touchstart", cancelGuard);
          scrollContainer.removeEventListener("pointerdown", cancelGuard, true);
          window.removeEventListener("keydown", cancelGuard, true);
          if (state.cancelGuard === cancelGuard) state.cancelGuard = null;
        };
        scrollContainer.addEventListener("wheel", cancelGuard, { passive: true });
        scrollContainer.addEventListener("touchstart", cancelGuard, { passive: true });
        // Pierre stops gutter pointer events from bubbling. Listen in capture
        // so starting a comment cancels the reveal guard before the row expands.
        scrollContainer.addEventListener("pointerdown", cancelGuard, {
          passive: true,
          capture: true,
        });
        window.addEventListener("keydown", cancelGuard, true);
        const holdTarget = () => {
          guardFrameId = null;
          framesLeft -= 1;
          if (framesLeft <= 0 || !scrollContainer.isConnected) {
            cancelGuard();
            return;
          }
          const targetTop = resolveScrollTarget(line);
          if (
            targetTop !== null &&
            Math.abs(scrollContainer.scrollTop - targetTop) > REVEAL_GUARD_TOLERANCE_PX
          ) {
            scrollContainer.scrollTop = targetTop;
          }
          guardFrameId = requestAnimationFrame(holdTarget);
        };
        guardFrameId = requestAnimationFrame(holdTarget);
        state.cancelGuard = cancelGuard;
      };

      const scheduleReveal = (attempt: number) => {
        state.frameId = requestAnimationFrame(() => {
          state.frameId = null;
          if (state.latestRequestId !== revealRequestId || !fileContainer.isConnected) {
            return;
          }

          // Contents and line metrics can lag the first post-render on fresh
          // mounts; clamping against missing contents would scroll to line 1
          // and wrongly mark the request handled.
          const currentContents = instance.file?.contents;
          const line =
            currentContents === undefined ? null : clampFileLine(currentContents, revealLine);
          const targetTop = line === null ? null : resolveScrollTarget(line);
          if (line === null || targetTop === null) {
            if (attempt < REVEAL_MAX_ATTEMPTS) scheduleReveal(attempt + 1);
            return;
          }
          updateFileLinkReveal(fileContainer, line);

          scrollContainer.scrollTop = targetTop;
          state.handledRequestId = revealRequestId;
          guardScrollTarget(line);
        });
      };

      scheduleReveal(0);
    },
    [revealStatesByPath, relativePath, revealLine, revealRequestId],
  );
}

interface EditableFileSurfaceProps {
  environmentId: EnvironmentId;
  cwd: string;
  relativePath: string;
  composerDraftTarget: ScopedThreadRef | DraftId;
  contents: string;
  resolvedTheme: "light" | "dark";
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
  resolvedTheme,
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
  const editorFocusedRef = useRef(false);
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
        persistState: true,
        persistStateStorage: "inMemory",
        onFocus: () => {
          editorFocusedRef.current = true;
        },
        onBlur: () => {
          editorFocusedRef.current = false;
        },
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

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (!editorFocusedRef.current) return;
      const action = resolveFileEditorHistoryAction(event);
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (action === "redo") editor.redo();
      else editor.undo();
    };
    window.addEventListener("keydown", handleHistoryShortcut, true);
    return () => window.removeEventListener("keydown", handleHistoryShortcut, true);
  }, [editor]);

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
    <EditProvider editor={editor}>
      <div ref={surfaceRef} className="flex h-full min-h-0 flex-1 overflow-hidden">
        <Virtualizer
          className="file-preview-virtualizer h-full min-h-0 flex-1 overflow-auto overscroll-contain"
          config={{
            overscrollSize: 600,
            intersectionObserverMargin: 1200,
          }}
        >
          <File<FileCommentAnnotationGroup>
            file={{
              name: relativePath,
              contents,
              cacheKey: projectFileEditorCacheKey(
                environmentId,
                cwd,
                relativePath,
                contents,
                editor.getFile(),
              ),
            }}
            options={{
              disableFileHeader: true,
              enableGutterUtility: !hasOpenCommentForm,
              enableLineSelection: !hasOpenCommentForm,
              onGutterUtilityClick: setSelectedRange,
              onLineSelectionChange: setSelectedRange,
              onLineSelectionEnd: handleLineSelectionEnd,
              overflow: wordWrap ? "wrap" : "scroll",
              onTokenClick: onTokenNavigation,
              theme: resolveDiffThemeName(resolvedTheme),
              themeType: resolvedTheme,
              unsafeCSS: FILE_LINK_REVEAL_UNSAFE_CSS,
              onPostRender: handlePostRender,
            }}
            selectedLines={selectedRange}
            lineAnnotations={lineAnnotations}
            renderAnnotation={(annotation) => (
              <div className="py-1">
                {annotation.metadata.entries.map((entry) => (
                  <DiffCommentAnnotation
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
    </EditProvider>
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
  | "resolvedTheme"
  | "composerDraftTarget"
  | "revealLine"
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
        cwd={workspaceDocumentDirectory(cwd, relativePath)}
        workspaceRoot={cwd}
        threadRef={threadRef}
        className="file-markdown-preview w-full px-6 py-5"
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

const MIN_WORKSPACE_TREE_HEIGHT_PX = 96;

function MultiRootFileBrowser(props: {
  environmentId: EnvironmentId;
  roots: ReadonlyArray<ProjectWorkspace>;
  projectName: string;
  revealRequestId: number;
  workspaceMutationId: string | null;
  onOpenFile: (path: string, workspaceRoot: string) => void;
}) {
  const [collapsedRoots, setCollapsedRoots] = useState<ReadonlySet<string>>(() => new Set());
  const [rootWeights, setRootWeights] = useState<Record<string, number>>({});
  const sectionElements = useRef(new Map<string, HTMLElement>());
  const resizeState = useRef<{
    pointerId: number;
    upperPath: string;
    lowerPath: string;
    upperHeight: number;
    lowerHeight: number;
    startY: number;
    weights: Record<string, number>;
  } | null>(null);

  const toggleRoot = useCallback((path: string) => {
    setCollapsedRoots((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, upperPath: string, lowerPath: string) => {
      const upper = sectionElements.current.get(upperPath);
      const lower = sectionElements.current.get(lowerPath);
      if (!upper || !lower) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const weights = Object.fromEntries(
        props.roots
          .filter((root) => !collapsedRoots.has(root.path))
          .map((root) => [root.path, sectionElements.current.get(root.path)?.offsetHeight ?? 1]),
      );
      resizeState.current = {
        pointerId: event.pointerId,
        upperPath,
        lowerPath,
        upperHeight: upper.offsetHeight,
        lowerHeight: lower.offsetHeight,
        startY: event.clientY,
        weights,
      };
    },
    [collapsedRoots, props.roots],
  );

  const resize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = resizeState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const pairHeight = state.upperHeight + state.lowerHeight;
    const minimumHeight = Math.min(MIN_WORKSPACE_TREE_HEIGHT_PX, pairHeight / 2);
    const upperHeight = Math.min(
      pairHeight - minimumHeight,
      Math.max(minimumHeight, state.upperHeight + event.clientY - state.startY),
    );
    setRootWeights({
      ...state.weights,
      [state.upperPath]: upperHeight,
      [state.lowerPath]: pairHeight - upperHeight,
    });
  }, []);

  const stopResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (resizeState.current?.pointerId !== event.pointerId) return;
    resizeState.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-hidden p-2">
      {props.roots.map((root, index) => {
        const collapsed = collapsedRoots.has(root.path);
        const nextRoot = props.roots[index + 1];
        const color = resolveWorkspaceColor(root, index);
        const colorOption = workspaceColorOption(color);
        return (
          <div key={root.path} className="contents">
            <section
              ref={(element) => {
                if (element) sectionElements.current.set(root.path, element);
                else sectionElements.current.delete(root.path);
              }}
              className={cn(
                "flex min-h-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-background",
                collapsed ? "shrink-0" : "basis-0",
              )}
              style={collapsed ? undefined : { flexGrow: rootWeights[root.path] ?? 1 }}
            >
              <button
                type="button"
                className="flex shrink-0 items-center gap-2 bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                aria-expanded={!collapsed}
                onClick={() => toggleRoot(root.path)}
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform",
                    !collapsed && "rotate-90",
                  )}
                />
                <span className={cn("size-2 shrink-0 rounded-full", colorOption.dotClassName)} />
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">
                    {workspaceDirectoryName(root.path)}
                  </div>
                  <code className="block truncate text-[10px] text-muted-foreground">
                    {root.path}
                  </code>
                </div>
              </button>
              {!collapsed ? (
                <div className="min-h-0 flex-1 border-t border-border/60">
                  <FileBrowserPanel
                    key={`${props.environmentId}:${root.path}`}
                    environmentId={props.environmentId}
                    cwd={root.path}
                    projectName={workspaceDirectoryName(root.path) || props.projectName}
                    selectedPath={null}
                    selectedPathRevealId={props.revealRequestId}
                    onOpenFile={(path) => props.onOpenFile(path, root.path)}
                    workspaceMutationId={props.workspaceMutationId}
                  />
                </div>
              ) : null}
            </section>
            {!collapsed && nextRoot && !collapsedRoots.has(nextRoot.path) ? (
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label={`Resize ${workspaceDirectoryName(root.path)} and ${workspaceDirectoryName(nextRoot.path)}`}
                className="group -my-1 flex h-3 shrink-0 touch-none cursor-row-resize items-center justify-center"
                onPointerDown={(event) => startResize(event, root.path, nextRoot.path)}
                onPointerMove={resize}
                onPointerUp={stopResize}
                onPointerCancel={stopResize}
              >
                <GripHorizontal className="size-3.5 text-muted-foreground/35 transition-colors group-hover:text-muted-foreground" />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function FilePreviewPanel({
  environmentId,
  primaryCwd,
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
  selectedFilePending,
  workspaceMutationId,
  workspaceRoots,
}: FilePreviewPanelProps) {
  const { resolvedTheme } = useTheme();
  const wordWrap = useClientSettings((settings) => settings.wordWrap);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const remoteOpenState = useRemoteOpenState(environmentId);
  const [selectedRootCwd, setSelectedRootCwd] = useState(cwd);
  useEffect(() => {
    setSelectedRootCwd(cwd);
  }, [cwd]);
  const activeCwd = selectedRootCwd;
  const roots = useMemo(
    () => resolveFilePreviewRoots(primaryCwd, workspaceRoots),
    [primaryCwd, workspaceRoots],
  );
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
  const isImage = relativePath !== null && isWorkspaceImagePreviewPath(relativePath);
  const file = useProjectFileQuery(
    environmentId,
    activeCwd,
    relativePath,
    !isImage,
    true,
    selectedFilePending,
  );
  const projectEntriesQuery = useProjectEntriesQuery(environmentId, activeCwd);
  const projectEntries = projectEntriesQuery.data?.entries ?? [];
  useWorkspaceMutationRefresh({
    mutationId: workspaceMutationId,
    refresh: projectEntriesQuery.refresh,
    resourceKey: `file-navigation:${environmentId}:${activeCwd}`,
  });
  const workspaceKey = editorWorkspaceKey(environmentId, activeCwd);
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
  const [commitDiffPath, setCommitDiffPath] = useState<string | null>(null);
  useEffect(() => {
    if (explorerView !== "commit") setCommitDiffPath(null);
  }, [explorerView]);
  // Reading markdown rendered is a preference, not a property of one file. Keeping
  // it on the panel meant a thread switch dropped it and forced source back.
  const [renderMarkdownPreferred, setRenderMarkdownPreferred] = useLocalStorage(
    RENDER_MARKDOWN_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  // Paired with the path on purpose: each file surface counts its reveals from
  // one, so a bare id would let a dismissed reveal on one file swallow the first
  // reveal on the next.
  const [handledReveal, setHandledReveal] = useState<{ path: string; requestId: number } | null>(
    null,
  );
  const breadcrumbRef = useRef<HTMLDivElement>(null);
  const previewRootRef = useRef<HTMLDivElement>(null);
  const symbolNavigationRequestRef = useRef(0);
  const isMarkdown = relativePath ? isMarkdownPreviewFile(relativePath) : false;
  // A reveal still wins over the preference: the line only exists in the source.
  const renderMarkdown =
    isMarkdown &&
    renderMarkdownPreferred &&
    (effectiveRevealLine === null ||
      (handledReveal?.path === relativePath &&
        handledReveal.requestId === effectiveRevealRequestId));
  const canOpenInBrowser =
    relativePath !== null && isPreviewSupportedInRuntime() && isBrowserPreviewFile(relativePath);
  const absolutePath = relativePath ? resolvePathLinkTarget(relativePath, activeCwd) : null;
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
    historyCanGoBack(state, environmentId, activeCwd),
  );
  const canGoForward = useEditorNavigationStore((state) =>
    historyCanGoForward(state, environmentId, activeCwd),
  );
  useWorkspaceMutationRefresh({
    enabled: relativePath !== null && !isImage && !selectedFilePending,
    mutationId: workspaceMutationId,
    refresh: file.refresh,
    resourceKey: `file:${environmentId}:${activeCwd}:${relativePath ?? ""}`,
  });

  useEffect(() => {
    if (!relativePath) return;
    const store = useEditorNavigationStore.getState();
    store.recordRecentFile(environmentId, activeCwd, relativePath);
    store.recordActiveLocation(environmentId, activeCwd, { path: relativePath });
  }, [activeCwd, environmentId, relativePath]);

  const pendingNavigationPath =
    navigationRequest?.workspaceKey === workspaceKey ? navigationRequest.path : null;
  const pendingNavigationRequestId =
    navigationRequest?.workspaceKey === workspaceKey ? navigationRequest.requestId : null;
  useEffect(() => {
    if (pendingNavigationPath && pendingNavigationPath !== relativePath) {
      onOpenFile(pendingNavigationPath, activeCwd);
    }
  }, [activeCwd, onOpenFile, pendingNavigationPath, pendingNavigationRequestId, relativePath]);

  const goBack = useCallback(() => {
    useEditorNavigationStore.getState().goBack(environmentId, activeCwd);
  }, [activeCwd, environmentId]);
  const goForward = useCallback(() => {
    useEditorNavigationStore.getState().goForward(environmentId, activeCwd);
  }, [activeCwd, environmentId]);

  const navigateToLineInCurrentFile = useCallback(
    (lineNumber: number) => {
      if (!relativePath) return;
      useEditorNavigationStore
        .getState()
        .navigateTo(environmentId, activeCwd, { path: relativePath, lineNumber });
    },
    [activeCwd, environmentId, relativePath],
  );

  const openNavigationTarget = useCallback(
    (match: ProjectCodeSearchMatch, from?: EditorLocation | null) => {
      useEditorNavigationStore
        .getState()
        .navigateTo(
          environmentId,
          activeCwd,
          { path: match.path, lineNumber: match.lineNumber, column: match.column },
          from ?? undefined,
        );
    },
    [activeCwd, environmentId],
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
        input: { cwd: activeCwd, query: symbol, scope: "navigation", limit: 120 },
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
          matches = matches.toSorted(
            (left, right) =>
              Number(left.path !== relativePath) - Number(right.path !== relativePath) ||
              left.path.localeCompare(right.path) ||
              left.lineNumber - right.lineNumber,
          );
          if (matches.length === 1) openNavigationTarget(matches[0]!, origin);
          else if (matches.length > 1) setSymbolChoices({ symbol, mode, matches, origin });
          else toastManager.add({ type: "info", title: `No ${mode} found`, description: symbol });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Code navigation failed",
            description: error instanceof Error ? error.message : "Unable to search this symbol.",
          });
        });
    },
    [activeCwd, environmentId, openNavigationTarget, relativePath, searchCode],
  );

  useEffect(() => {
    const currentCrumb = breadcrumbRef.current?.querySelector<HTMLElement>(
      "[data-current-file-crumb='true']",
    );
    currentCrumb?.scrollIntoView({ block: "nearest", inline: "end" });
  }, [relativePath]);

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

  const previewSurface = (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {commitDiffPath ? (
        <>
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-3">
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{commitDiffPath}</span>
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Close diff"
              onClick={() => setCommitDiffPath(null)}
            >
              <X className="size-3.5" />
            </button>
          </div>
          <CommitFileDiffView
            environmentId={environmentId}
            cwd={activeCwd}
            path={commitDiffPath}
            composerDraftTarget={composerDraftTarget}
            workspaceMutationId={workspaceMutationId}
          />
        </>
      ) : relativePath && isImage && absolutePath ? (
        <WorkspaceImagePreview
          key={absolutePath}
          environmentId={environmentId}
          threadRef={threadRef}
          absolutePath={absolutePath}
          alt={relativePath}
          workspaceMutationId={workspaceMutationId}
        />
      ) : relativePath && file.error && file.data === null ? (
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
            cwd={activeCwd}
            relativePath={relativePath}
            threadRef={threadRef}
            contents={file.data.contents}
            onPendingChange={onPendingChange}
          />
        ) : file.data.truncated ? (
          <Virtualizer
            key={`${relativePath}:${resolvedTheme}:${file.data.byteLength}`}
            className="file-preview-virtualizer h-full min-h-0 flex-1 overflow-auto overscroll-contain"
            config={{
              overscrollSize: 600,
              intersectionObserverMargin: 1200,
            }}
          >
            <File
              file={{
                name: relativePath,
                contents: file.data.contents,
                cacheKey: projectFileCacheKey(activeCwd, relativePath, file.data.contents),
              }}
              options={{
                disableFileHeader: true,
                overflow: wordWrap ? "wrap" : "scroll",
                onTokenClick: handleTokenNavigation,
                theme: resolveDiffThemeName(resolvedTheme),
                themeType: resolvedTheme,
                unsafeCSS: FILE_LINK_REVEAL_UNSAFE_CSS,
                onPostRender: onFilePostRender,
              }}
              className="min-h-full"
            />
          </Virtualizer>
        ) : (
          <EditableFileSurface
            key={`${relativePath}:${resolvedTheme}`}
            environmentId={environmentId}
            cwd={activeCwd}
            relativePath={relativePath}
            composerDraftTarget={composerDraftTarget}
            contents={file.data.contents}
            resolvedTheme={resolvedTheme}
            revealRequestId={effectiveRevealRequestId}
            wordWrap={wordWrap}
            onPostRender={onFilePostRender}
            onTokenNavigation={handleTokenNavigation}
            onPendingChange={onPendingChange}
          />
        )
      ) : null}
    </div>
  );

  return (
    <div
      ref={previewRootRef}
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
    >
      <EditorNavigationDialog
        environmentId={environmentId}
        cwd={activeCwd}
        projectName={projectName}
        entries={projectEntries}
        onOpenFile={(path) => onOpenFile(path, activeCwd)}
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
        <div
          className="flex h-10 min-h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-3 in-data-[preview-panel-mode=inline]:mb-3 in-data-[preview-panel-mode=inline]:h-7 in-data-[preview-panel-mode=inline]:min-h-7 in-data-[preview-panel-mode=inline]:border-b-transparent"
          data-surface-subheader
        >
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                    aria-label="Go back to previous location"
                    disabled={!canGoBack}
                    onClick={goBack}
                  />
                }
              >
                <ArrowLeft className="size-4" />
              </TooltipTrigger>
              <TooltipPopup>Back</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                    aria-label="Go forward to next location"
                    disabled={!canGoForward}
                    onClick={goForward}
                  />
                }
              >
                <ArrowRight className="size-4" />
              </TooltipTrigger>
              <TooltipPopup>Forward</TooltipPopup>
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
                      onClick={() => onOpenFile(crumb.path, activeCwd)}
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
                              onClick={() => {
                                const target =
                                  entry.kind === "file"
                                    ? entry.path
                                    : firstFileInDirectory(projectEntries, entry.path);
                                if (target) onOpenFile(target, activeCwd);
                              }}
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
          {absolutePath &&
          (environmentId === primaryEnvironmentId || remoteOpenState.mode !== "local-exec") ? (
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
                    onPressedChange={(pressed) => {
                      setRenderMarkdownPreferred(pressed);
                      setHandledReveal(
                        pressed && relativePath !== null
                          ? { path: relativePath, requestId: effectiveRevealRequestId }
                          : null,
                      );
                    }}
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
        <div className="shrink-0 border-b border-warning/20 bg-warning-surface px-3 py-1.5 text-[11px] text-warning-foreground">
          Preview limited to the first 1 MB of a {file.data.byteLength.toLocaleString()} byte file.
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {relativePath && explorerOpen ? (
          <ResizableColumns
            className="h-full flex-1"
            storageKey="t3code.fileExplorerTreeRatio"
            defaultRatio={0.72}
            firstMinPx={280}
            secondMinPx={192}
            separatorLabel="Resize files tree"
            first={previewSurface}
            second={
              <aside className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
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
                    environmentId={environmentId}
                    cwd={activeCwd}
                    threadRef={threadRef}
                    selectedPath={commitDiffPath}
                    onShowDiff={setCommitDiffPath}
                    workspaceMutationId={workspaceMutationId}
                  />
                ) : explorerView === "structure" ? (
                  <FileStructurePanel
                    relativePath={relativePath}
                    contents={file.data?.contents ?? null}
                    loading={file.data === null}
                    onNavigate={navigateToLineInCurrentFile}
                  />
                ) : (
                  <FileBrowserPanel
                    key={`${environmentId}:${activeCwd}`}
                    environmentId={environmentId}
                    cwd={activeCwd}
                    projectName={projectName}
                    selectedPath={relativePath}
                    selectedPathRevealId={effectiveRevealRequestId}
                    onOpenFile={(path) => onOpenFile(path, activeCwd)}
                    onRefreshSelectedFile={file.refresh}
                    workspaceMutationId={workspaceMutationId}
                  />
                )}
              </aside>
            }
          />
        ) : relativePath ? (
          previewSurface
        ) : (
          <aside className="flex min-h-0 min-w-0 flex-1 bg-background">
            <MultiRootFileBrowser
              environmentId={environmentId}
              roots={roots}
              projectName={projectName}
              revealRequestId={revealRequestId}
              workspaceMutationId={workspaceMutationId}
              onOpenFile={(path, rootPath) => {
                setSelectedRootCwd(rootPath);
                onOpenFile(path, rootPath);
              }}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
