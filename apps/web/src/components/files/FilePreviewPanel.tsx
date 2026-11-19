import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { useWorkspaceMutationRefresh } from "~/hooks/useWorkspaceMutationRefresh";
import { breadcrumbPathOf, retainedBreadcrumbTrail, trailChildOf } from "./filePath";
import type { ThreadWorkspaceSelection } from "@t3tools/contracts";
import {
  resolveThreadWorkspaces,
  type SelectedProjectWorkspace,
} from "@t3tools/shared/threadWorkspaces";
import { FileWorktreeToolbar } from "./FileWorktreeToolbar";
import { Button } from "~/components/ui/button";
import { DownloadIcon, CopyIcon, CheckIcon, Code2Icon, EyeIcon, Table2Icon } from "lucide-react";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { m, type MessageResolver } from "~/i18n/messages";
import { namedClipboardTarget, useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { Spinner } from "~/components/ui/spinner";
import { DIFF_SURFACE_THEME_UNSAFE_CSS } from "~/lib/diffRendering";
import {
  type AssetResource,
  AuthPreviewOperateScope,
  type EditorId,
  type EnvironmentId,
  type ProjectCodeSearchMatch,
  type ProjectWorkspace,
  type ProjectId,
  type ResolvedKeybindingsConfig,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { filePreviewDelimiter } from "@t3tools/shared/delimitedPreview";
import { AuthFilesystemWriteScope } from "@t3tools/contracts";
import {
  isWorkspaceAudioPreviewPath,
  isWorkspaceImagePreviewPath,
  isWorkspaceFontPreviewPath,
  isWorkspaceVideoPreviewPath,
  officePreviewKind,
  binaryPreviewKind,
} from "@t3tools/shared/filePreview";
import { useAtomMount, useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import {
  DEFAULT_TOKENIZE_MAX_LENGTH,
  VirtualizedFile,
  getFiletypeFromFileName,
  type File as FileInstance,
  type FileContents,
  type PostRenderPhase,
  type SelectedLineRange,
  type TokenEventBase,
} from "@pierre/diffs";
import {
  Editor,
  type EditorChangeEvent,
  type EditorFactory,
  type EditorOptions,
} from "@pierre/diffs/edit";
import type { WorkerPoolManager } from "@pierre/diffs/worker";
import { EditProvider, File, Virtualizer, useWorkerPool } from "@pierre/diffs/react";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import { useFilesystemReadAccess } from "~/state/filesystem";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { mediaFileReference } from "@t3tools/client-runtime/media-reference";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  WrapTextIcon,
  FolderTree,
  Globe2,
  GripHorizontal,
  LoaderCircle,
  X,
} from "lucide-react";
import * as Schema from "effect/Schema";
import {
  lazy,
  Suspense,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { isBrowserPreviewFile, openFileInPreview } from "~/browser/openFileInPreview";
import { useAssetUrlRefresh, useAssetUrlState } from "~/assets/assetUrls";
import ChatMarkdown from "~/components/ChatMarkdown";
import { maskMarkdownFrontmatter } from "@t3tools/shared/markdownFrontmatter";
import { OpenInPicker } from "~/components/chat/OpenInPicker";
import { MediaVideoPlayer } from "~/components/media/MediaVideoPlayer";
import { MediaActions, type MediaActionSource } from "~/components/media/MediaActions";
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
import { useStableCallback } from "~/hooks/useStableCallback";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { cn, isMacPlatform } from "~/lib/utils";
import { requestWorkspaceFocus } from "~/lib/workspaceFocus";
import {
  resolveWorkspaceColor,
  workspaceColorOption,
  workspaceDirectoryName,
} from "~/lib/projectWorkspacePresentation";
import type { ChatFileAttachment } from "~/types";
import { isHostPath } from "@t3tools/shared/path";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { ResizableColumns } from "~/components/ui/resizable-columns";
import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { buildFileReviewComment, type ReviewCommentContext } from "~/reviewCommentContext";
import { assetEnvironment } from "~/state/assets";
import { usePreviewAvailable } from "~/browser/previewRuntime";
import { useEnvironmentHttpBaseUrl, usePrimaryEnvironmentId } from "~/state/environments";
import { hostEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { previewEnvironment } from "~/state/preview";
import { projectEnvironment } from "~/state/projects";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";

import { AttachmentFilePreview } from "./AttachmentFilePreview";
import { AudioPreview } from "./AudioPreview";
import { BrowserDocumentFrame, isPdfPreviewFile } from "./BrowserDocumentFrame";
import { DelimitedTablePreview } from "./DelimitedTablePreview";
import { PreviewImage } from "./PreviewImage";
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
  promptFileCommentEntries,
} from "./fileCommentAnnotations";
import { installFileEditorDismissal } from "./fileEditorDismissal";
import { resolveFileEditorHistoryAction } from "./fileEditorUndo";
import { FileSurfaceAction, FileSurfaceFailure, FileSurfaceLoading } from "./fileSurfaceChrome";
import SourceFilePreview from "./ReadOnlySourcePreview";
import { resolveCenteredFileLineScrollTop } from "./fileLineReveal";
import { DiffCommentAnnotation } from "../diffs/DiffCommentAnnotation";
import { projectFileCacheKey } from "./fileContentRevision";
import { workspaceDocumentDirectory } from "./filePath";
import { FileBreadcrumbs } from "./FileBreadcrumbs";
import {
  filePreviewReadErrorMessage,
  isMarkdownPreviewFile,
  resolveFilePreviewPath,
  shouldShowFileExplorer,
  siblingWorktreeLabel,
  workspaceAssetResource,
} from "./filePreviewMode";
import { setMarkdownTaskChecked } from "@t3tools/shared/markdownTaskList";
import { changeFileSaveSession, useFileSaveSession } from "./fileSaveSessions";
import { revisionedQuery } from "~/state/revisionedQuery";
import {
  getOptimisticProjectFileQueryData,
  getProjectFileContents,
  getProjectFileQueryAtom,
  setProjectFileQueryData,
  useProjectEntriesQuery,
  useProjectFileLocations,
  useProjectFileQuery,
} from "./projectFilesQueryState";
import { SymbolNavigationDialog } from "./SymbolNavigationDialog";

const NO_FILE_REVISION_ATOM = Atom.make(null);

interface FilePreviewPanelProps {
  active?: boolean;
  environmentId: EnvironmentId;
  primaryCwd: string;
  projectRoot: string;
  cwd: string;
  projectName: string;
  projectId?: ProjectId | undefined;
  relativePath: string | null;
  attachment?: ChatFileAttachment;
  threadRef: ScopedThreadRef;
  composerDraftTarget: ScopedThreadRef | DraftId;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInShortcutEnabled: boolean;
  revealLine: number | null;
  revealRequestId: number;
  onOpenFile: (relativePath: string, workspaceRoot?: string) => void;
  onPendingChange: (relativePath: string, pending: boolean, workspaceRoot?: string) => void;
  onNavigateFolder?: (
    relativePath: string,
    folderTrail: string,
    keepSource: boolean,
    workspaceRoot: string,
  ) => void;
  folderTrail?: string | undefined;
  selectedFilePending: boolean;
  workspaceMutationId: string | null;
  workspaceRoots?: ReadonlyArray<ProjectWorkspace> | undefined;
  workspaceSelections?: ReadonlyArray<ThreadWorkspaceSelection> | undefined;
}

const MermaidFilePreview = lazy(() =>
  import("./MermaidFilePreview").then((module) => ({ default: module.MermaidFilePreview })),
);

const RENDER_MARKDOWN_STORAGE_KEY = "t3code.renderMarkdown";
const RENDER_BROWSER_FILE_STORAGE_KEY = "t3code.renderBrowserFile";
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
const RENDER_TABLE_STORAGE_KEY = "t3code.renderTable";
type FilePostRender = <LAnnotation>(
  fileContainer: HTMLElement,
  instance: FileInstance<LAnnotation, undefined>,
  phase: PostRenderPhase,
) => void;

function useRevisionAssetUrl(
  environmentId: EnvironmentId,
  resource: AssetResource,
  revision: string | null,
) {
  return useAssetUrlState(environmentId, resource, revision ?? undefined);
}

function WorkspaceImagePreview(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly draft: boolean;
  readonly absolutePath: string;
  readonly workspaceRoot: string;
  readonly alt: string;
  readonly workspaceMutationId: string | null;
}) {
  const insideWorkspace =
    mediaFileReference(props.absolutePath, props.workspaceRoot).relativePath !== undefined;
  const resource = useMemo(
    () =>
      workspaceAssetResource({
        kind: insideWorkspace ? "workspace-file" : "media-file",
        threadRef: props.threadRef,
        draft: props.draft,
        workspaceRoot: props.workspaceRoot,
        absolutePath: props.absolutePath,
      }),
    [insideWorkspace, props.threadRef, props.draft, props.workspaceRoot, props.absolutePath],
  );
  const assetUrl = useRevisionAssetUrl(props.environmentId, resource, props.workspaceMutationId);
  const revisionSuffix =
    props.workspaceMutationId === null
      ? ""
      : `${assetUrl._tag === "Success" && assetUrl.url.includes("?") ? "&" : "?"}workspace-revision=${encodeURIComponent(props.workspaceMutationId)}`;
  const imageUrl = assetUrl._tag === "Success" ? `${assetUrl.url}${revisionSuffix}` : null;
  const actionsSource: MediaActionSource = {
    kind: "image",
    name: props.alt,
    src: imageUrl,
    reference: mediaFileReference(props.absolutePath, props.workspaceRoot),
    asset: { environmentId: props.environmentId, resource },
  };

  if (assetUrl._tag === "Failure") {
    return (
      <MediaActions source={actionsSource}>
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs leading-relaxed text-destructive">
          <T>Unable to load workspace image.</T>
        </div>
      </MediaActions>
    );
  }

  return assetUrl._tag === "Success" && imageUrl !== null ? (
    <MediaActions source={actionsSource}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PreviewImage key={imageUrl} src={imageUrl} name={props.alt} />
      </div>
    </MediaActions>
  ) : (
    <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
      <Spinner size="lg" />
    </div>
  );
}

export function WorkspaceBrowserPreview(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly draft: boolean;
  readonly absolutePath: string;
  readonly workspaceRoot: string;
  readonly title: string;
  readonly workspaceMutationId: string | null;
}) {
  const pdf = isPdfPreviewFile(props.absolutePath);
  const resource = workspaceAssetResource({
    kind:
      pdf || mediaFileReference(props.absolutePath, props.workspaceRoot).relativePath === undefined
        ? "media-file"
        : "workspace-file",
    threadRef: props.threadRef,
    draft: props.draft,
    workspaceRoot: props.workspaceRoot,
    absolutePath: props.absolutePath,
  });
  // Each workspace mutation re-mints the URL: a file outside the workspace is signed by its
  // inode, which an atomic replace changes.
  const assetUrl = useAssetUrlState(props.environmentId, resource, props.workspaceMutationId);
  // The HTML frame keeps its first URL per key, so the key moves only once the re-minted URL arrives.
  const [settledMutationId, setSettledMutationId] = useState(props.workspaceMutationId);
  if (
    assetUrl._tag === "Success" &&
    !assetUrl.waiting &&
    settledMutationId !== props.workspaceMutationId
  ) {
    setSettledMutationId(props.workspaceMutationId);
  }
  const fileRevision = pdf && assetUrl._tag === "Success" ? assetUrl.fileRevision : undefined;
  const revision = fileRevision ?? (pdf ? props.workspaceMutationId : settledMutationId);
  const revisionSuffix =
    revision === null
      ? ""
      : `${assetUrl._tag === "Success" && assetUrl.url.includes("?") ? "&" : "?"}${fileRevision !== undefined ? "file" : "workspace"}-revision=${encodeURIComponent(revision)}`;

  if (assetUrl._tag === "Failure") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs leading-relaxed text-destructive">
        <T>Unable to load file preview.</T>
      </div>
    );
  }
  if (
    assetUrl._tag !== "Success" ||
    (pdf && assetUrl.fileRevision === undefined && assetUrl.waiting)
  ) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
        <Spinner size="lg" />
      </div>
    );
  }
  return (
    <BrowserDocumentFrame
      src={`${assetUrl.url}${revisionSuffix}`}
      documentKey={`${props.environmentId}:${resource._tag}:${props.threadRef.threadId}:${props.absolutePath}:${revision}`}
      documentId={`${props.environmentId}:${resource._tag}:${props.threadRef.threadId}:${props.absolutePath}`}
      title={props.title}
      pdf={pdf}
      pdfActions={
        <WorkspacePdfSaveAction
          environmentId={props.environmentId}
          resource={resource}
          name={props.title}
        />
      }
    />
  );
}

function WorkspacePdfSaveAction(props: {
  readonly environmentId: EnvironmentId;
  readonly resource: AssetResource;
  readonly name: string;
}) {
  const gt = useGT();
  const [saving, setSaving] = useState(false);
  const refreshAssetUrl = useAssetUrlRefresh(props.environmentId, props.resource);
  return (
    <FileSurfaceAction
      label={saving ? gt("Preparing file…") : gt("Save file")}
      disabled={saving}
      onPress={() => {
        setSaving(true);
        void (async () => {
          const url = await refreshAssetUrl();
          if (!url) throw new Error(gt("Reconnect to the environment and try again."));
          const response = await fetch(url);
          if (!response.ok) throw new Error(gt("The file could not be loaded. Try again."));
          // Blob downloads keep desktop's custom app scheme from navigating to an external browser.
          const downloadUrl = URL.createObjectURL(await response.blob());
          setTimeout(() => URL.revokeObjectURL(downloadUrl), 30_000);
          const anchor = document.createElement("a");
          anchor.href = downloadUrl;
          anchor.download = props.name.split(/[\\/]/).at(-1) || props.name;
          anchor.click();
        })()
          .catch((cause: unknown) =>
            toastManager.add({
              type: "error",
              title: gt("Could not save file"),
              description: thrownErrorMessage(cause, m) ?? gt("Please try again."),
            }),
          )
          .finally(() => setSaving(false));
      }}
    >
      <DownloadIcon className="size-3.5" />
    </FileSurfaceAction>
  );
}

function WorkspaceVideoPreview(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly draft: boolean;
  readonly absolutePath: string;
  readonly workspaceRoot: string;
  readonly name: string;
  readonly workspaceMutationId: string | null;
}) {
  const resource = useMemo(
    () =>
      workspaceAssetResource({
        kind: "media-file",
        threadRef: props.threadRef,
        draft: props.draft,
        workspaceRoot: props.workspaceRoot,
        absolutePath: props.absolutePath,
      }),
    [props.threadRef, props.draft, props.workspaceRoot, props.absolutePath],
  );
  const assetUrl = useRevisionAssetUrl(props.environmentId, resource, props.workspaceMutationId);
  const refreshAssetUrl = useAssetUrlRefresh(props.environmentId, resource);
  // Servers that report the file's revision let an unchanged file stay loaded; older ones
  // only offer the workspace mutation, which changes after every command. The revision also
  // goes in the URL, since two mints in the same millisecond sign identical URLs.
  const fileRevision = assetUrl._tag === "Success" ? assetUrl.fileRevision : undefined;
  const revision = fileRevision ?? props.workspaceMutationId;
  const revisionSuffix =
    revision === null
      ? ""
      : `${assetUrl._tag === "Success" && assetUrl.url.includes("?") ? "&" : "?"}${fileRevision !== undefined ? "file" : "workspace"}-revision=${encodeURIComponent(revision)}`;
  const latestUrl = assetUrl._tag === "Success" ? `${assetUrl.url}${revisionSuffix}` : null;

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
      <MediaVideoPlayer
        src={latestUrl}
        sourceFailed={assetUrl._tag === "Failure"}
        label={props.name}
        revision={revision}
        preload="metadata"
        className="flex h-full min-h-0 w-full max-w-5xl items-center justify-center"
        videoClassName="aspect-auto max-h-full w-auto max-w-full"
        onRetry={refreshAssetUrl}
        actionsSource={{
          kind: "video",
          name: props.name,
          src: latestUrl,
          reference: mediaFileReference(props.absolutePath, props.workspaceRoot),
          asset: { environmentId: props.environmentId, resource },
        }}
      />
    </div>
  );
}

function WorkspaceAudioPreview(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly draft: boolean;
  readonly absolutePath: string;
  readonly workspaceRoot: string;
  readonly name: string;
  readonly workspaceMutationId: string | null;
}) {
  const gt = useGT();
  const resource = useMemo(
    () =>
      workspaceAssetResource({
        kind: "media-file",
        threadRef: props.threadRef,
        draft: props.draft,
        workspaceRoot: props.workspaceRoot,
        absolutePath: props.absolutePath,
      }),
    [props.threadRef, props.draft, props.workspaceRoot, props.absolutePath],
  );
  const assetUrl = useRevisionAssetUrl(props.environmentId, resource, props.workspaceMutationId);
  const refreshAssetUrl = useAssetUrlRefresh(props.environmentId, resource);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const fileRevision = assetUrl._tag === "Success" ? assetUrl.fileRevision : undefined;
  const revision = fileRevision ?? props.workspaceMutationId;
  const revisionSuffix =
    revision === null
      ? ""
      : `${assetUrl._tag === "Success" && assetUrl.url.includes("?") ? "&" : "?"}${fileRevision !== undefined ? "file" : "workspace"}-revision=${encodeURIComponent(revision)}`;
  const url = assetUrl._tag === "Success" ? `${assetUrl.url}${revisionSuffix}` : null;
  if (assetUrl._tag === "Failure" || (url !== null && failedUrl === url)) {
    return (
      <FileSurfaceFailure
        message={gt("Unable to load audio.")}
        onRetry={() => {
          setFailedUrl(null);
          void refreshAssetUrl().catch(() => undefined);
        }}
      />
    );
  }
  if (url === null) return <FileSurfaceLoading />;
  return (
    <AudioPreview
      src={url}
      name={props.name}
      revision={revision}
      onError={() => setFailedUrl(url)}
    />
  );
}

function WorkspaceDocumentPreview(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly draft: boolean;
  readonly document: boolean;
  readonly absolutePath: string;
  readonly workspaceRoot: string;
  readonly name: string;
  readonly workspaceMutationId: string | null;
  readonly refreshRevision: number;
}) {
  const resource =
    props.draft && props.document
      ? {
          _tag: "draft-workspace-file" as const,
          cwd: props.workspaceRoot,
          path: props.absolutePath,
        }
      : {
          _tag: "media-file" as const,
          threadId: props.threadRef.threadId,
          path: props.absolutePath,
          ...(props.document ? {} : { disposition: "attachment" as const }),
        };
  const gt = useGT();
  // Drafts keep reloading on every workspace mutation, as before.
  const revisioned = resource._tag === "media-file";
  const assetUrl = useAssetUrlState(
    props.environmentId,
    revisioned ? resource : null,
    props.workspaceMutationId ?? undefined,
  );
  const resolved =
    assetUrl._tag === "Success" ? (assetUrl.fileRevision ?? props.workspaceMutationId) : undefined;
  // A reconnect reports Loading and keeps the last revision, so the open file stays loaded;
  // a failure (say the file was deleted) remounts so the preview shows its error.
  const [shown, setShown] = useState(resolved);
  if (resolved !== undefined && resolved !== shown) setShown(resolved);
  const revision = !revisioned
    ? props.workspaceMutationId
    : assetUrl._tag === "Failure"
      ? `failure:${props.workspaceMutationId}`
      : (resolved ?? shown);
  // Waiting on the first revision keeps the preview from mounting twice when it opens.
  if (revisioned && revision === undefined && assetUrl._tag === "Loading") {
    return <FileSurfaceLoading />;
  }
  return (
    <AttachmentFilePreview
      key={`${revision}:${props.refreshRevision}`}
      name={props.name}
      mimeType="application/octet-stream"
      sizeBytes={0}
      asset={{ environmentId: props.environmentId, resource }}
      origin={gt("File", { $context: "label for a file opened from the workspace" })}
    />
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

const REVEAL_MAX_ATTEMPTS = 30;
/** Hold the reveal target against late focus/restoration scroll resets. */
const REVEAL_GUARD_FRAMES = 20;
const REVEAL_GUARD_TOLERANCE_PX = 2;

interface FileRevealState {
  frameId: number | null;
  cancelGuard: (() => void) | null;
  handledRequestId: number | null;
  latestRequestId: number | null;
  /** The path's code view offset when it last unmounted, restored when it is shown again. */
  scrollTop: number;
  scrollContainer: HTMLElement | null;
  restoreFrameId: number | null;
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
        scrollTop: 0,
        scrollContainer: null,
        restoreFrameId: null,
      };
      if (!existingState) revealStatesByPath.set(relativePath, state);

      const cancelPendingReveal = () => {
        if (state.frameId !== null) {
          cancelAnimationFrame(state.frameId);
          state.frameId = null;
        }
        state.cancelGuard?.();
        if (state.restoreFrameId !== null) {
          cancelAnimationFrame(state.restoreFrameId);
          state.restoreFrameId = null;
        }
      };

      const scrollContainer = fileContainer.closest<HTMLElement>(".file-preview-virtualizer");

      if (phase === "unmount") {
        // A view torn down before its restore ran never showed the saved offset, so keep it.
        const restorePending = state.restoreFrameId !== null;
        cancelPendingReveal();
        if (scrollContainer && !restorePending) state.scrollTop = scrollContainer.scrollTop;
        state.scrollContainer = null;
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

      if (scrollContainer && state.scrollContainer !== scrollContainer) {
        state.scrollContainer = scrollContainer;
        const savedScrollTop = state.scrollTop;
        // A pending line reveal owns the scroll position.
        if (
          savedScrollTop > 0 &&
          (revealLine === null || state.handledRequestId === revealRequestId)
        ) {
          const restoreScroll = (attempt: number) => {
            state.restoreFrameId = requestAnimationFrame(() => {
              state.restoreFrameId = null;
              if (!scrollContainer.isConnected || scrollContainer.scrollTop !== 0) return;
              // Wait for the virtualizer to size the file so the offset is not clamped.
              const fits =
                scrollContainer.scrollHeight - scrollContainer.clientHeight >= savedScrollTop;
              if (fits || attempt >= REVEAL_MAX_ATTEMPTS) {
                scrollContainer.scrollTop = savedScrollTop;
                return;
              }
              restoreScroll(attempt + 1);
            });
          };
          restoreScroll(0);
        }
      }

      if (revealLine === null) {
        fileContainer.style.minHeight = "";
        return;
      }

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
        // Capture gutter pointer events before Pierre stops propagation so comments can cancel the reveal
        // guard.
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

          // Wait for contents and metrics; missing data would clamp fresh-mount reveals to line 1 and mark them
          // handled.
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

const EMPTY_REVIEW_COMMENTS: ReadonlyArray<ReviewCommentContext> = [];

const createFileEditor: EditorFactory<FileCommentAnnotationGroup, undefined> = (
  editorType,
  options,
  editStateKey,
) => new Editor(editorType, options, editStateKey);
type FileEditor = Editor<"file", FileCommentAnnotationGroup, undefined>;

function editableFileContents(
  environmentId: EnvironmentId,
  cwd: string,
  relativePath: string,
  contents: string,
): FileContents {
  return {
    name: relativePath,
    contents,
    cacheKey: `editor:${environmentId}:${projectFileCacheKey(cwd, relativePath, contents)}`,
  };
}

function needsWorkerHighlight(workerPool: WorkerPoolManager | undefined, file: FileContents) {
  if (workerPool?.isWorkingPool() !== true) return false;
  if ((file.lang ?? getFiletypeFromFileName(file.name)) === "text") return false;
  let lines = 1;
  for (
    let index = file.contents.indexOf("\n");
    index !== -1;
    index = file.contents.indexOf("\n", index + 1)
  ) {
    lines += 1;
  }
  return lines <= DEFAULT_TOKENIZE_MAX_LENGTH;
}

/** Enable editing only after worker highlighting renders; active edit sessions highlight on the main
 * thread. */
function useEditableAfterHighlight(file: FileContents) {
  const workerPool = useWorkerPool();
  const [highlightedFile, setHighlightedFile] = useState<FileContents | null>(null);
  const needsHighlight = useMemo(() => needsWorkerHighlight(workerPool, file), [file, workerPool]);
  const ready = !needsHighlight || highlightedFile === file;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Prime the external syntax worker before showing the editor.
  useEffect(() => {
    if (ready || workerPool === undefined) return;
    workerPool.primeFileHighlightCache(file).catch(() => setHighlightedFile(file));
  }, [file, ready, workerPool]);

  const onPostRender = useCallback(
    (renderedFile: FileContents | undefined, phase: PostRenderPhase) => {
      if (ready || phase === "unmount" || renderedFile?.cacheKey !== file.cacheKey) return;
      // Cache results arrive just before instance rendering; seeing the cache during render means rows are
      // highlighted.
      if (workerPool?.getFileResultCache(file) !== undefined) setHighlightedFile(file);
    },
    [file, ready, workerPool],
  );
  return { ready, onPostRender };
}

interface EditableFileSurfaceProps {
  environmentId: EnvironmentId;
  projectId?: ProjectId | undefined;
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
  onEditorChange: (editor: FileEditor | null) => void;
}

interface FileSelectionOverride {
  revealRequestId: number;
  range: SelectedLineRange | null;
}

const EditableFileSurface = memo(function EditableFileSurface({
  environmentId,
  projectId,
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
  onEditorChange,
}: EditableFileSurfaceProps) {
  const messages = useMessages();
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const removeReviewComment = useComposerDraftStore((store) => store.removeReviewComment);
  const promptReviewComments = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.reviewComments ?? EMPTY_REVIEW_COMMENTS,
  );
  const promptCommentIds = useMemo(
    () => new Set(promptReviewComments.map((comment) => comment.id)),
    [promptReviewComments],
  );
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
  const saveTarget = useMemo(
    () => ({ environmentId, cwd, relativePath }),
    [environmentId, cwd, relativePath],
  );
  useFileSaveSession(saveTarget, onPendingChange);
  // Retain file identity for echoed editor changes; only external changes replace the editor's draft.
  const [externalFile, setExternalFile] = useState(() =>
    editableFileContents(environmentId, cwd, relativePath, contents),
  );
  const [editedContents, setEditedContents] = useState<string | null>(null);
  if (contents !== (editedContents ?? externalFile.contents)) {
    setExternalFile(editableFileContents(environmentId, cwd, relativePath, contents));
    setEditedContents(null);
  }
  const { ready: editable, onPostRender: onEditablePostRender } =
    useEditableAfterHighlight(externalFile);
  const editorRef = useRef<FileEditor | null>(null);
  const editorOptions = useMemo<EditorOptions<"file", FileCommentAnnotationGroup, undefined>>(
    () => ({
      onFocus: () => {
        editorFocusedRef.current = true;
      },
      onBlur: () => {
        editorFocusedRef.current = false;
      },
      onAttach: (editor) => {
        editorRef.current = editor;
        onEditorChange(editor);
      },
      onComplete: () => {
        editorRef.current = null;
        onEditorChange(null);
      },
    }),
    [onEditorChange],
  );

  const handleEditChange = useCallback(
    ({
      file,
      lineAnnotations: nextLineAnnotations,
    }: EditorChangeEvent<"file", FileCommentAnnotationGroup, undefined>) => {
      if (file.contents === getProjectFileContents(environmentId, cwd, relativePath)) return;
      setEditedContents(file.contents);
      setProjectFileQueryData(environmentId, cwd, relativePath, file.contents);
      changeFileSaveSession(saveTarget, file.contents);
      if (!nextLineAnnotations) return;
      const remapped = remapFileCommentAnnotations(nextLineAnnotations);
      // The editor hands back the array it was given until an edit moves an annotation.
      setLineAnnotations((current) => (current === nextLineAnnotations ? current : remapped));
      for (const annotation of remapped) {
        for (const entry of annotation.metadata.entries) {
          if (entry.kind !== "comment" || !promptCommentIds.has(entry.id)) continue;
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
    },
    [
      addReviewComment,
      composerDraftTarget,
      cwd,
      environmentId,
      promptCommentIds,
      relativePath,
      saveTarget,
    ],
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Install focused editor undo shortcuts for the mounted editor lifetime.
  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      const editor = editorRef.current;
      if (!editor || !editorFocusedRef.current || !surfaceRef.current?.getClientRects().length)
        return;
      const action = resolveFileEditorHistoryAction(event);
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (action === "redo") editor.redo();
      else editor.undo();
    };
    window.addEventListener("keydown", handleHistoryShortcut, true);
    return () => window.removeEventListener("keydown", handleHistoryShortcut, true);
  }, []);

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
    editorRef.current?.setSelections([]);
    editorRef.current?.blur();
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Install the editor dismissal bridge after its DOM surface exists.
  useEffect(() => {
    const root = surfaceRef.current;
    if (!root) return;
    return installFileEditorDismissal({
      root,
      editor: { setSelections: (selections) => editorRef.current?.setSelections(selections) },
      isBlocked: () => hasOpenCommentForm,
      onDismiss: () => setSelectedRange(null),
    });
  }, [hasOpenCommentForm, setSelectedRange]);
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
      onEditablePostRender(instance.file, phase);

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
    [onEditablePostRender, onPostRender, selectedRange],
  );

  return (
    <EditProvider createEditor={createFileEditor}>
      <div ref={surfaceRef} className="flex h-full min-h-0 flex-1 overflow-hidden">
        <Virtualizer
          className="file-preview-virtualizer h-full min-h-0 flex-1 overflow-auto overscroll-contain"
          config={{
            overscrollSize: 600,
            intersectionObserverMargin: 1200,
          }}
        >
          <File<FileCommentAnnotationGroup>
            file={externalFile}
            edit={editable}
            editStateKey={`editor:${environmentId}:${cwd}:${relativePath}`}
            editorOptions={editorOptions}
            onEditChange={handleEditChange}
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
              preferredHighlighter: PREFERRED_HIGHLIGHTER,
              themeType: resolvedTheme,
              unsafeCSS: FILE_LINK_REVEAL_UNSAFE_CSS,
              onPostRender: handlePostRender,
            }}
            selectedLines={selectedRange}
            lineAnnotations={lineAnnotations}
            renderAnnotation={(annotation) => {
              // Sent comments stay annotated so a failed send can restore them at remapped lines.
              const entries = promptFileCommentEntries(
                annotation.metadata.entries,
                promptCommentIds,
              );
              if (entries.length === 0) return null;
              return (
                <div className="py-1">
                  {entries.map((entry) => (
                    <DiffCommentAnnotation
                      key={entry.id}
                      environmentId={environmentId}
                      projectId={projectId}
                      ownerKey={JSON.stringify([
                        environmentId,
                        composerDraftTarget,
                        relativePath,
                        entry.id,
                      ])}
                      kind={entry.kind}
                      rangeLabel={formatFileCommentRange(entry.startLine, entry.endLine, messages)}
                      text={entry.text}
                      onCancel={() => removeAnnotationEntry(entry.id)}
                      onComment={(text) => submitAnnotationEntry(entry.id, text)}
                      onDelete={() => removeAnnotationEntry(entry.id)}
                    />
                  ))}
                </div>
              );
            }}
            className="min-h-full"
          />
        </Virtualizer>
      </div>
    </EditProvider>
  );
});

function selectRenderedContentOnSelectAll(event: ReactKeyboardEvent<HTMLElement>) {
  const mac = isMacPlatform(navigator.platform);
  const selectAll =
    event.key.toLowerCase() === "a" &&
    (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) &&
    !event.shiftKey &&
    !event.altKey;
  // React bubbles keys from portaled children (the image dialog) through this surface.
  if (
    !selectAll ||
    !(event.target instanceof Node) ||
    !event.currentTarget.contains(event.target)
  ) {
    return;
  }
  event.preventDefault();
  window.getSelection()?.selectAllChildren(event.currentTarget);
}

const RenderedMarkdownSurface = memo(function RenderedMarkdownSurface({
  environmentId,
  cwd,
  relativePath,
  contents,
  threadRef,
  workspaceMutationId,
  readOnly,
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
  | "onEditorChange"
> & {
  threadRef: ScopedThreadRef;
  readOnly: boolean;
  workspaceMutationId: string | null;
}) {
  const saveTarget = useMemo(
    () => ({ environmentId, cwd, relativePath }),
    [environmentId, cwd, relativePath],
  );
  useFileSaveSession(saveTarget, onPendingChange);

  return (
    <ScrollArea className="min-h-0 flex-1" onKeyDown={selectRenderedContentOnSelectAll}>
      <ChatMarkdown
        text={maskMarkdownFrontmatter(contents)}
        cwd={workspaceDocumentDirectory(cwd, relativePath)}
        workspaceRoot={cwd}
        threadRef={threadRef}
        className="file-markdown-preview w-full px-6 py-5"
        workspaceMutationId={workspaceMutationId}
        onTaskListChange={
          readOnly
            ? undefined
            : ({ markerOffset, checked }) => {
                const currentContents =
                  getOptimisticProjectFileQueryData(environmentId, cwd, relativePath)?.contents ??
                  contents;
                const nextContents = setMarkdownTaskChecked(currentContents, markerOffset, checked);
                if (nextContents === currentContents) return;
                setProjectFileQueryData(environmentId, cwd, relativePath, nextContents);
                changeFileSaveSession(saveTarget, nextContents);
              }
        }
      />
    </ScrollArea>
  );
});

function extractNavigationSymbol(tokenText: string): string | null {
  const trimmed = tokenText.trim();
  const exact = trimmed.match(/^[\p{L}_$][\p{L}\p{N}_$]*$/u);
  if (exact) return exact[0];
  const identifiers = trimmed.match(/[\p{L}_$][\p{L}\p{N}_$]*/gu);
  return identifiers?.length === 1 ? identifiers[0]! : null;
}

function renderedToggleLabel(
  mode: "markdown" | "mermaid" | "html" | "table",
  rendered: boolean,
  resolve: MessageResolver,
): string {
  if (mode === "mermaid")
    return rendered ? resolve(msg("Show Mermaid source")) : resolve(msg("Show rendered diagram"));
  if (mode === "markdown")
    return rendered ? resolve(msg("Show markdown source")) : resolve(msg("Show rendered markdown"));
  if (mode === "table") return rendered ? resolve(msg("Show source")) : resolve(msg("Show table"));
  return rendered ? resolve(msg("Show HTML source")) : resolve(msg("Show rendered page"));
}

const MIN_WORKSPACE_TREE_HEIGHT_PX = 160;
const FileBrowserLayout = Schema.Struct({
  collapsedRoots: Schema.Array(Schema.String),
  rootWeights: Schema.Record(Schema.String, Schema.Number.check(Schema.isGreaterThan(0))),
});
const DEFAULT_FILE_BROWSER_LAYOUT: typeof FileBrowserLayout.Type = {
  collapsedRoots: [],
  rootWeights: {},
};

function MultiRootFileBrowser(props: {
  active: boolean;
  environmentId: EnvironmentId;
  roots: ReadonlyArray<SelectedProjectWorkspace>;
  threadRef: ScopedThreadRef;
  selectedCwd?: string | undefined;
  selectedPath?: string | null | undefined;
  projectName: string;
  revealRequestId: number;
  workspaceMutationId: string | null;
  answersPanelFind?: boolean;
  onOpenFile: (path: string, workspaceRoot: string) => void;
}) {
  const gt = useGT();
  const rootDisplayName = (root: ProjectWorkspace, index: number) =>
    index === 0 ? props.projectName : root.label?.trim() || workspaceDirectoryName(root.path);
  const projectRoot = props.roots[0]?.workspaceRoot ?? "";
  const [layout, setLayout] = useLocalStorage(
    `t3code.files.layout.v1:${editorWorkspaceKey(props.environmentId, projectRoot)}`,
    DEFAULT_FILE_BROWSER_LAYOUT,
    FileBrowserLayout,
  );
  const collapsedRoots = useMemo(() => new Set(layout.collapsedRoots), [layout.collapsedRoots]);
  const [dragWeights, setDragWeights] = useState<Record<string, number> | null>(null);
  const rootWeights = dragWeights ?? layout.rootWeights;
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

  const toggleRoot = useCallback(
    (workspaceRoot: string) => {
      setLayout((current) => ({
        ...current,
        collapsedRoots: current.collapsedRoots.includes(workspaceRoot)
          ? current.collapsedRoots.filter((path) => path !== workspaceRoot)
          : [...current.collapsedRoots, workspaceRoot],
      }));
    },
    [setLayout],
  );

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, upperPath: string, lowerPath: string) => {
      if (event.button !== 0) return;
      const upper = sectionElements.current.get(upperPath);
      const lower = sectionElements.current.get(lowerPath);
      if (!upper || !lower) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      const weights = Object.fromEntries(
        props.roots
          .filter((root) => !collapsedRoots.has(root.workspaceRoot))
          .map((root) => [
            root.workspaceRoot,
            sectionElements.current.get(root.workspaceRoot)?.offsetHeight ?? 1,
          ]),
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
      setDragWeights(weights);
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
    state.weights = {
      ...state.weights,
      [state.upperPath]: upperHeight,
      [state.lowerPath]: pairHeight - upperHeight,
    };
    setDragWeights(state.weights);
  }, []);

  const stopResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const state = resizeState.current;
      if (!state || state.pointerId !== event.pointerId) return;
      resizeState.current = null;
      // Save once on release, rather than writing storage on every pointer move.
      setLayout((current) => ({
        ...current,
        rootWeights: { ...current.rootWeights, ...state.weights },
      }));
      setDragWeights(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [setLayout],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-hidden p-2">
      {props.roots.map((root, index) => {
        const collapsed = collapsedRoots.has(root.workspaceRoot);
        const nextRoot = props.roots
          .slice(index + 1)
          .find((candidate) => !collapsedRoots.has(candidate.workspaceRoot));
        const color = resolveWorkspaceColor(root, index);
        const colorOption = workspaceColorOption(color);
        return (
          <div key={root.workspaceRoot} className="contents">
            <section
              ref={(element) => {
                if (element) sectionElements.current.set(root.workspaceRoot, element);
                else sectionElements.current.delete(root.workspaceRoot);
              }}
              className={cn(
                "flex min-h-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-background",
                collapsed ? "shrink-0" : "basis-0",
              )}
              style={collapsed ? undefined : { flexGrow: rootWeights[root.workspaceRoot] ?? 1 }}
            >
              <button
                type="button"
                className="flex shrink-0 items-center gap-2 bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                aria-expanded={!collapsed}
                onClick={() => toggleRoot(root.workspaceRoot)}
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform",
                    !collapsed && "rotate-90",
                  )}
                />
                <span className={cn("size-2 shrink-0 rounded-full", colorOption.dotClassName)} />
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">{rootDisplayName(root, index)}</div>
                  <code className="block truncate text-[10px] text-muted-foreground">
                    {root.path}
                  </code>
                </div>
              </button>
              <FileWorktreeToolbar
                environmentId={props.environmentId}
                threadRef={props.threadRef}
                root={root}
              />
              {!collapsed ? (
                <div className="min-h-0 flex-1 border-t border-border/60">
                  <FileBrowserPanel
                    key={`${props.environmentId}:${root.path}`}
                    active={props.active}
                    environmentId={props.environmentId}
                    cwd={root.path}
                    projectName={rootDisplayName(root, index)}
                    selectedPath={
                      props.selectedCwd === root.path ? (props.selectedPath ?? null) : null
                    }
                    selectedPathRevealId={props.revealRequestId}
                    onOpenFile={(path) => props.onOpenFile(path, root.path)}
                    answersPanelFind={
                      props.answersPanelFind === true &&
                      (props.selectedCwd ?? props.roots[0]?.path) === root.path
                    }
                    workspaceMutationId={props.workspaceMutationId}
                  />
                </div>
              ) : null}
            </section>
            {!collapsed && nextRoot ? (
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label={gt("Resize {first} and {second}", {
                  first: rootDisplayName(root, index),
                  second: rootDisplayName(nextRoot, props.roots.indexOf(nextRoot)),
                })}
                className="group relative z-10 flex h-3 shrink-0 touch-none cursor-row-resize select-none items-center justify-center"
                onPointerDown={(event) =>
                  startResize(event, root.workspaceRoot, nextRoot.workspaceRoot)
                }
                onPointerMove={resize}
                onPointerUp={stopResize}
                onPointerCancel={stopResize}
                onLostPointerCapture={stopResize}
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
  active = true,
  environmentId,
  primaryCwd,
  projectRoot,
  cwd,
  projectName,
  projectId,
  relativePath: requestedPath,
  attachment,
  threadRef,
  composerDraftTarget,
  keybindings,
  availableEditors,
  openInShortcutEnabled,
  revealLine,
  revealRequestId,
  onOpenFile,
  onNavigateFolder,
  folderTrail,
  onPendingChange: onWorkspacePendingChange,
  selectedFilePending,
  workspaceMutationId,
  workspaceRoots,
  workspaceSelections,
}: FilePreviewPanelProps) {
  const resolvedPath =
    attachment === undefined ? resolveFilePreviewPath(requestedPath, cwd) : requestedPath;
  const draft = typeof composerDraftTarget === "string";
  const gt = useGT();
  const m = useMessages();
  const { resolvedTheme } = useTheme();
  const defaultWordWrap = useClientSettings((settings) => settings.wordWrap);
  const [wordWrapOverride, setWordWrapOverride] = useState<boolean | null>(null);
  const wordWrap = wordWrapOverride ?? defaultWordWrap;
  const canOperatePreview = useEnvironmentScope(environmentId, AuthPreviewOperateScope);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const hostEnvironmentId = useAtomValue(hostEnvironmentIdAtom);
  const remoteOpenState = useRemoteOpenState(environmentId);
  const [selectedRootCwd, setSelectedRootCwd] = useState(cwd);
  const [rootIdentity, setRootIdentity] = useState(cwd);
  if (rootIdentity !== cwd) {
    setRootIdentity(cwd);
    setSelectedRootCwd(cwd);
  }
  const activeCwd = selectedRootCwd;
  const missingKey = `${activeCwd}\u0000${resolvedPath ?? ""}`;
  const [missingFile, setMissingFile] = useState<string | null>(null);
  const [chosenSibling, setChosenSibling] = useState<{ key: string; path: string } | null>(null);
  const missing = attachment === undefined && resolvedPath !== null && missingFile === missingKey;
  const siblings = useProjectFileLocations(environmentId, activeCwd, resolvedPath, missing);
  const sibling = missing
    ? (siblings.locations.find(
        (location) =>
          chosenSibling?.key === missingKey && location.absolutePath === chosenSibling.path,
      ) ??
      siblings.locations[0] ??
      null)
    : null;
  const relativePath = sibling?.absolutePath ?? resolvedPath;
  const onPendingChange = useCallback(
    (path: string, pending: boolean) => onWorkspacePendingChange(path, pending, activeCwd),
    [onWorkspacePendingChange, activeCwd],
  );
  const roots = useMemo(
    () =>
      resolveThreadWorkspaces(
        { workspaceRoot: projectRoot, workspaceRoots },
        { worktreePath: primaryCwd, branch: null, workspaceSelections },
      ),
    [primaryCwd, projectRoot, workspaceRoots, workspaceSelections],
  );
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const environmentHttpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const previewAvailable = usePreviewAvailable(environmentId);
  const createAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  const openPreview = useAtomCommand(previewEnvironment.open, {
    reportFailure: false,
  });
  const searchCode = useAtomQueryRunner(projectEnvironment.searchCode, {
    reportFailure: false,
  });
  const isVideo = relativePath !== null && isWorkspaceVideoPreviewPath(relativePath);
  const isAudio = relativePath !== null && !isVideo && isWorkspaceAudioPreviewPath(relativePath);
  const isImage = relativePath !== null && !isVideo && isWorkspaceImagePreviewPath(relativePath);
  const isMedia = isImage || isVideo || isAudio;
  const isPdf = relativePath !== null && isPdfPreviewFile(relativePath);
  const isDocument =
    relativePath !== null &&
    (binaryPreviewKind({ name: relativePath }) !== null ||
      officePreviewKind({ name: relativePath }) !== null ||
      isWorkspaceFontPreviewPath(relativePath));
  const isHtml = relativePath !== null && !isPdf && isBrowserPreviewFile(relativePath);
  const isHostFile =
    attachment !== undefined || (relativePath !== null && isHostPath(relativePath));
  const fileAccess = useFilesystemReadAccess(environmentId, m);
  const { canReadFiles } = fileAccess;
  const canWriteFiles = useEnvironmentScope(environmentId, AuthFilesystemWriteScope);
  const file = useProjectFileQuery(
    environmentId,
    activeCwd,
    relativePath,
    attachment === undefined && relativePath !== null,
    true,
    selectedFilePending,
    active,
    m,
  );
  if (
    relativePath === resolvedPath &&
    file.readError?.failure === "path_not_found" &&
    missingFile !== missingKey
  ) {
    setMissingFile(missingKey);
  }
  const [fileRefreshRevision, setFileRefreshRevision] = useState(0);
  const attemptedPath = file.readError?.resolvedPath ?? file.readError?.operationPath;
  // Folder links fail file reads; retain mutation refresh to detect conversion to files. Host folders own
  // roots; folderTrail keeps descendants.
  const breadcrumbPath =
    attachment !== undefined ? null : (relativePath ?? (folderTrail === undefined ? null : ""));
  // Reset crumbs when a host trail reaches the workspace root and no longer passes through the current path.
  const breadcrumbTrail =
    breadcrumbPath === null ? null : retainedBreadcrumbTrail(folderTrail, breadcrumbPath);
  // A trail implies a folder before reads settle, preventing file-preview flashes while navigating up.
  const isFolder =
    attachment === undefined &&
    (file.isNotFile || (folderTrail !== undefined && file.data === null && file.error === null));
  const hostFolderPath = isFolder && isHostFile ? relativePath : null;
  // A chat-linked folder reads as a file until its read settles, and revealing a
  // folder selects it in its parent instead of opening it, so reveal waits.
  const revealsInFileManager =
    !isFolder &&
    (file.data !== null || file.error !== null) &&
    serverConfig?.shellRevealInFileManager === true;
  // Everything preview-related keys off previewPath; a folder has no preview.
  const previewPath = isFolder ? null : relativePath;

  const projectEntriesQuery = useProjectEntriesQuery(environmentId, activeCwd, "", active);
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
  const showExplorer = shouldShowFileExplorer({
    relativePath: previewPath,
    explorerOpen,
    attachmentOpen: attachment !== undefined,
  });
  const toggleExplorer = useExplorerViewStore((state) => state.toggleOpen);
  const [commitDiffPath, setCommitDiffPath] = useState<string | null>(null);
  if (explorerView !== "commit" && commitDiffPath !== null) setCommitDiffPath(null);
  // Reading markdown rendered is a preference, not a property of one file. Keeping
  // it on the panel meant a thread switch dropped it and forced source back.
  const [renderMarkdownPreferred, setRenderMarkdownPreferred] = useLocalStorage(
    RENDER_MARKDOWN_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const [renderBrowserFilePreferred, setRenderBrowserFilePreferred] = useLocalStorage(
    RENDER_BROWSER_FILE_STORAGE_KEY,
    true,
    Schema.Boolean,
  );
  const [renderTablePreferred, setRenderTablePreferred] = useLocalStorage(
    RENDER_TABLE_STORAGE_KEY,
    true,
    Schema.Boolean,
  );
  // Reveal ids restart at one per file; pair with the path so dismissal cannot swallow another file's reveal.
  const [handledReveal, setHandledReveal] = useState<{ path: string; requestId: number } | null>(
    null,
  );
  const previewRootRef = useRef<HTMLDivElement>(null);
  const symbolNavigationRequestRef = useRef(0);

  const isMarkdown = previewPath ? isMarkdownPreviewFile(previewPath) : false;
  const isMermaid = previewPath !== null && /\.(mmd|mermaid)$/i.test(previewPath);
  const [renderMermaidPreferred, setRenderMermaidPreferred] = useLocalStorage(
    "t3code.renderMermaid",
    true,
    Schema.Boolean,
  );
  const tableDelimiter =
    previewPath && attachment === undefined ? filePreviewDelimiter({ name: previewPath }) : null;
  // A reveal still wins over the preference: the line only exists in the source.
  const renderMarkdown =
    isMarkdown &&
    renderMarkdownPreferred &&
    (effectiveRevealLine === null ||
      (handledReveal?.path === relativePath &&
        handledReveal.requestId === effectiveRevealRequestId));
  const revealHandled =
    effectiveRevealLine === null ||
    (handledReveal?.path === relativePath && handledReveal.requestId === effectiveRevealRequestId);
  const renderMermaid = isMermaid && renderMermaidPreferred && revealHandled;
  const renderBrowserFile = isPdf || (isHtml && renderBrowserFilePreferred && revealHandled);
  const renderTable = tableDelimiter !== null && renderTablePreferred && revealHandled;
  const renderedMode = isMermaid
    ? ("mermaid" as const)
    : isMarkdown
      ? ("markdown" as const)
      : tableDelimiter
        ? ("table" as const)
        : isHtml
          ? ("html" as const)
          : null;
  const canToggleRendered =
    previewPath !== null && attachment === undefined && renderedMode !== null;
  const showsRawText =
    previewPath !== null &&
    file.data !== null &&
    !(isMarkdown && renderMarkdown) &&
    !renderMermaid &&
    !(tableDelimiter && renderTable) &&
    !renderBrowserFile &&
    !isDocument;
  const mayOpenEditor =
    previewPath !== null &&
    !isHostFile &&
    canWriteFiles &&
    file.error === null &&
    !file.data?.truncated &&
    !isMedia &&
    !isDocument &&
    !renderBrowserFile &&
    !renderMermaid &&
    !(isMarkdown && renderMarkdown) &&
    !(tableDelimiter && renderTable);
  const contentFocusRef = useRef<HTMLDivElement>(null);
  const fileEditorRef = useRef<FileEditor | null>(null);
  const focusEditorFromContent = () => {
    const editor = fileEditorRef.current;
    if (!editor || document.activeElement !== contentFocusRef.current) return;
    // Without a caret the editor focuses with no selection, so no caret shows and typing
    // lands on whatever the browser selection held.
    const hasCaret = Boolean(editor.getViewState().selections?.length);
    editor.focus(
      hasCaret
        ? { preventScroll: true }
        : { preventScroll: true, lineNumber: effectiveRevealLine ?? "first-visible" },
    );
  };
  const handleEditorChange = (editor: FileEditor | null) => {
    fileEditorRef.current = editor;
    focusEditorFromContent();
  };
  const handleEditorChangeStable = useStableCallback(handleEditorChange);
  const focusEditorOnTreeRowClickOrEnter = (event: {
    nativeEvent: Event;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  }) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const row = event.nativeEvent
      .composedPath()
      .find((node): node is Element => node instanceof Element && node.matches("[data-item-path]"));
    const path = row?.getAttribute("data-item-path");
    if (!path || path.endsWith("/")) return;
    requestWorkspaceFocus({ area: "panel", selector: "[data-file-content-focus]" });
  };
  const rendered = isMermaid
    ? renderMermaid
    : isMarkdown
      ? renderMarkdown
      : tableDelimiter
        ? renderTable
        : renderBrowserFile;
  const setRenderedPreferred = isMermaid
    ? setRenderMermaidPreferred
    : isMarkdown
      ? setRenderMarkdownPreferred
      : tableDelimiter
        ? setRenderTablePreferred
        : setRenderBrowserFilePreferred;
  const canOpenInBrowser =
    canOperatePreview &&
    previewPath !== null &&
    attachment === undefined &&
    !isVideo &&
    previewAvailable &&
    isBrowserPreviewFile(previewPath);
  // Navigating up preserves the file tab; retain the trail's path spelling to find its folder tab.
  const navigateToFolder = (crumbPath: string) => {
    const path =
      breadcrumbTrail !== null && breadcrumbPathOf(breadcrumbTrail) === crumbPath
        ? breadcrumbTrail
        : crumbPath;
    if (onNavigateFolder) {
      onNavigateFolder(
        path,
        retainedBreadcrumbTrail(breadcrumbTrail ?? undefined, path),
        !isFolder,
        activeCwd,
      );
    } else {
      onOpenFile(path || ".", activeCwd);
    }
  };
  const absolutePath =
    relativePath && attachment === undefined
      ? resolvePathLinkTarget(relativePath, activeCwd)
      : null;
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
  useAtomMount(
    active &&
      canReadFiles &&
      attachment === undefined &&
      relativePath !== null &&
      (isFolder || (!isMedia && !isPdf && !isDocument)) &&
      !selectedFilePending
      ? revisionedQuery(
          getProjectFileQueryAtom(environmentId, activeCwd, relativePath),
          workspaceMutationId,
        )
      : NO_FILE_REVISION_ATOM,
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Record the active editor location in the shared navigation store.
  useEffect(() => {
    if (!active || !relativePath) return;
    const store = useEditorNavigationStore.getState();
    store.recordRecentFile(environmentId, activeCwd, relativePath);
    store.recordActiveLocation(environmentId, activeCwd, { path: relativePath });
  }, [active, activeCwd, environmentId, relativePath]);

  const pendingNavigationPath =
    navigationRequest?.workspaceKey === workspaceKey ? navigationRequest.path : null;
  const pendingNavigationRequestId =
    navigationRequest?.workspaceKey === workspaceKey ? navigationRequest.requestId : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Consume external navigation requests after the owning file surface mounts.
  useEffect(() => {
    if (active && pendingNavigationPath && pendingNavigationPath !== relativePath) {
      onOpenFile(pendingNavigationPath, activeCwd);
    }
  }, [
    active,
    activeCwd,
    onOpenFile,
    pendingNavigationPath,
    pendingNavigationRequestId,
    relativePath,
  ]);

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
          else
            toastManager.add({
              type: "info",
              title: mode === "usages" ? gt("No usages found") : gt("No definitions found"),
              description: symbol,
            });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: gt("Code navigation failed"),
            description: thrownErrorMessage(error, m) ?? gt("Unable to search this symbol."),
          });
        });
    },
    [activeCwd, environmentId, gt, openNavigationTarget, relativePath, searchCode],
  );

  const handleOpenInBrowser = useCallback(() => {
    if (!canReadFiles || !canOperatePreview || !absolutePath || !environmentHttpBaseUrl) return;
    void (async () => {
      const result = await openFileInPreview({
        threadRef,
        filePath: absolutePath,
        workspaceRoot: cwd,
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
          title: gt("Unable to open file in browser"),
          description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
        }),
      );
    })();
  }, [
    absolutePath,
    canReadFiles,
    canOperatePreview,
    createAssetUrl,
    cwd,
    environmentHttpBaseUrl,
    openPreview,
    threadRef,
  ]);

  if (attachment === undefined && !canReadFiles) {
    if (fileAccess.isPending) {
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          <T>Checking file access...</T>
        </div>
      );
    }
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {fileAccess.error ?? gt("This connection cannot read host files.")}
      </div>
    );
  }

  const previewSurface = (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {mayOpenEditor ? (
        // Panel focus lands here and passes to the editor once it attaches. sr-only keeps the
        // 1px box workspace focus needs, and clips it so clicks in the file never reach it.
        // The hand-off waits a microtask: workspace focus checks that focus stayed here.
        <div
          ref={contentFocusRef}
          tabIndex={-1}
          data-workspace-focus-default
          data-file-content-focus
          aria-label={gt("File contents")}
          className="sr-only"
          onFocus={() => queueMicrotask(focusEditorFromContent)}
        />
      ) : null}
      {sibling && !commitDiffPath ? (
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 bg-info/8 px-3 py-1.5 text-xs text-foreground dark:bg-info/16">
          <span className="min-w-0">
            <T>
              Not in this checkout. Showing it from{" "}
              <span className="font-medium">
                <Var>{siblingWorktreeLabel(sibling)}</Var>
              </span>
              .
            </T>
          </span>
          {siblings.locations
            .filter((location) => location !== sibling)
            .map((location) => (
              <Button
                key={location.absolutePath}
                size="xs"
                variant="outline"
                onClick={() => setChosenSibling({ key: missingKey, path: location.absolutePath })}
              >
                {siblingWorktreeLabel(location)}
              </Button>
            ))}
        </div>
      ) : null}
      {commitDiffPath ? (
        <>
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-3">
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{commitDiffPath}</span>
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={gt("Close diff")}
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
      ) : relativePath && attachment ? (
        <AttachmentFilePreview
          key={`${environmentId}:${attachment.id}`}
          name={attachment.name}
          mimeType={attachment.mimeType}
          sizeBytes={attachment.sizeBytes}
          asset={{ environmentId, attachmentId: attachment.id }}
          htmlRender={attachment.htmlRender === true}
          threadRef={threadRef}
        />
      ) : relativePath && isAudio && absolutePath ? (
        <WorkspaceAudioPreview
          key={absolutePath}
          environmentId={environmentId}
          threadRef={threadRef}
          draft={draft}
          absolutePath={absolutePath}
          workspaceRoot={activeCwd}
          name={relativePath}
          workspaceMutationId={file.data?.revision ?? workspaceMutationId}
        />
      ) : relativePath && isVideo && absolutePath ? (
        <WorkspaceVideoPreview
          key={absolutePath}
          environmentId={environmentId}
          threadRef={threadRef}
          draft={draft}
          absolutePath={absolutePath}
          workspaceRoot={activeCwd}
          name={relativePath}
          workspaceMutationId={file.data?.revision ?? workspaceMutationId}
        />
      ) : relativePath && isImage && absolutePath ? (
        <WorkspaceImagePreview
          key={absolutePath}
          environmentId={environmentId}
          threadRef={threadRef}
          draft={draft}
          absolutePath={absolutePath}
          workspaceRoot={activeCwd}
          alt={relativePath}
          workspaceMutationId={file.data?.revision ?? workspaceMutationId}
        />
      ) : relativePath && !isMedia && renderBrowserFile && absolutePath ? (
        <WorkspaceBrowserPreview
          key={absolutePath}
          environmentId={environmentId}
          threadRef={threadRef}
          draft={draft}
          absolutePath={absolutePath}
          workspaceRoot={activeCwd}
          title={relativePath}
          workspaceMutationId={file.data?.revision ?? workspaceMutationId}
        />
      ) : relativePath && missing && siblings.isPending ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
          <LoaderCircle className="size-5 animate-spin" />
        </div>
      ) : relativePath &&
        absolutePath &&
        file.data?.truncated &&
        !isDocument &&
        !draft &&
        !isMarkdown &&
        !isMermaid &&
        !isHtml ? (
        <WorkspaceLargeTextPreview
          key={`${absolutePath}:${renderTable}:${file.data?.revision ?? workspaceMutationId}:${fileRefreshRevision}`}
          environmentId={environmentId}
          threadRef={threadRef}
          absolutePath={absolutePath}
          name={relativePath}
          delimiter={renderTable ? tableDelimiter : null}
          workspaceMutationId={workspaceMutationId}
          revealLine={revealLine}
          revealRequestId={revealRequestId}
          wordWrap={wordWrap}
        />
      ) : relativePath &&
        absolutePath &&
        (isDocument || file.readError?.failure === "binary_file") ? (
        <WorkspaceDocumentPreview
          key={`${environmentId}:${absolutePath}`}
          environmentId={environmentId}
          threadRef={threadRef}
          draft={draft}
          document={isDocument}
          absolutePath={absolutePath}
          workspaceRoot={activeCwd}
          name={relativePath.split(/[\\/]/).at(-1) || relativePath}
          workspaceMutationId={file.data?.revision ?? workspaceMutationId}
          refreshRevision={fileRefreshRevision}
        />
      ) : relativePath && file.error && file.data === null ? (
        <div role="alert" className="flex min-h-0 flex-1 flex-col overflow-auto">
          <div className="my-auto flex shrink-0 flex-col gap-3 px-6 py-6 text-center text-xs leading-relaxed">
            <p className="text-destructive">
              {file.readError ? filePreviewReadErrorMessage(file.readError, m) : file.error}
            </p>
            {missing && !siblings.isPending ? (
              <p className="text-muted-foreground">
                <T>No other worktree of this repository has it either.</T>
              </p>
            ) : null}
            {attemptedPath ? (
              <p className="text-muted-foreground">
                <T>
                  Attempted path
                  <code className="block break-all font-mono text-foreground select-all">
                    <Var>{attemptedPath}</Var>
                  </code>
                </T>
              </p>
            ) : null}
            {!isHostFile ? (
              <p className="text-muted-foreground">
                <T>
                  Workspace folder:{" "}
                  <code className="break-all font-mono select-all">
                    <Var>{file.readError?.cwd ?? activeCwd}</Var>
                  </code>
                  . Check the link's path or locate the file in Files.
                </T>
              </p>
            ) : null}
          </div>
        </div>
      ) : relativePath && file.data === null ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
          <LoaderCircle className="size-5 animate-spin" />
        </div>
      ) : relativePath && file.data ? (
        renderMermaid ? (
          <Suspense fallback={<FileSurfaceLoading />}>
            <MermaidFilePreview text={file.data.contents} />
          </Suspense>
        ) : isMarkdown && renderMarkdown ? (
          <RenderedMarkdownSurface
            environmentId={environmentId}
            cwd={activeCwd}
            relativePath={relativePath}
            threadRef={threadRef}
            contents={file.data.contents}
            workspaceMutationId={workspaceMutationId}
            key={`${activeCwd}:${relativePath}`}
            readOnly={file.data.truncated || isHostFile || !canWriteFiles}
            onPendingChange={onPendingChange}
          />
        ) : tableDelimiter && renderTable ? (
          <DelimitedTablePreview
            key={relativePath}
            name={relativePath}
            text={file.data.contents}
            delimiter={tableDelimiter}
          />
        ) : isHostFile || !canWriteFiles ? (
          <SourceFilePreview
            name={relativePath}
            text={file.data.contents}
            cacheKey={projectFileCacheKey(activeCwd, relativePath, file.data.contents)}
            onPostRender={onFilePostRender}
            wordWrap={wordWrap}
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
          <DiffWorkerPoolProvider>
            <EditableFileSurface
              key={`${environmentId}:${activeCwd}:${relativePath}:${resolvedTheme}`}
              environmentId={environmentId}
              projectId={projectId}
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
              onEditorChange={handleEditorChangeStable}
            />
          </DiffWorkerPoolProvider>
        )
      ) : null}
    </div>
  );

  return (
    <div
      ref={previewRootRef}
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
    >
      {active && (
        <EditorNavigationDialog
          environmentId={environmentId}
          cwd={activeCwd}
          projectName={projectName}
          entries={projectEntries}
          onOpenFile={(path) => onOpenFile(path, activeCwd)}
          onToggleExplorer={toggleExplorer}
          onRefreshFiles={projectEntriesQuery.refresh}
        />
      )}
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
      {breadcrumbPath !== null && breadcrumbTrail !== null ? (
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
                    aria-label={gt("Go back to previous location")}
                    disabled={!canGoBack}
                    onClick={goBack}
                  />
                }
              >
                <ArrowLeft className="size-4" />
              </TooltipTrigger>
              <TooltipPopup>
                <T>Back</T>
              </TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                    aria-label={gt("Go forward to next location")}
                    disabled={!canGoForward}
                    onClick={goForward}
                  />
                }
              >
                <ArrowRight className="size-4" />
              </TooltipTrigger>
              <TooltipPopup>
                <T>Forward</T>
              </TooltipPopup>
            </Tooltip>
          </div>
          <FileBreadcrumbs
            environmentId={environmentId}
            cwd={activeCwd}
            relativePath={breadcrumbPath}
            trail={breadcrumbTrail}
            onNavigateFolder={navigateToFolder}
            projectName={projectName}
            onOpenFile={(path) => onOpenFile(path, activeCwd)}
            workspaceMutationId={active ? workspaceMutationId : null}
          />
          {absolutePath &&
          (environmentId === primaryEnvironmentId ||
            environmentId === hostEnvironmentId ||
            remoteOpenState.mode !== "local-exec") ? (
            <OpenInPicker
              environmentId={environmentId}
              keybindings={keybindings}
              availableEditors={availableEditors}
              enableShortcut={openInShortcutEnabled}
              openInCwd={absolutePath}
              openInCwdIsFile={file.isFile}
              compact
              revealFileManager={revealsInFileManager}
            />
          ) : null}
          {canToggleRendered && renderedMode ? (
            <FileSurfaceAction
              label={renderedToggleLabel(renderedMode, rendered, m)}
              pressed={rendered}
              onPress={() => {
                const pressed = !rendered;
                setRenderedPreferred(pressed);
                setHandledReveal(
                  pressed && relativePath !== null
                    ? { path: relativePath, requestId: revealRequestId }
                    : null,
                );
              }}
            >
              {rendered ? (
                <Code2Icon className="size-3.5" />
              ) : renderedMode === "table" ? (
                <Table2Icon className="size-3.5" />
              ) : (
                <EyeIcon className="size-3.5" />
              )}
            </FileSurfaceAction>
          ) : null}
          {showsRawText ? (
            <FileSurfaceAction
              label={wordWrap ? gt("Disable word wrap") : gt("Enable word wrap")}
              pressed={wordWrap}
              onPress={() => setWordWrapOverride(!wordWrap)}
            >
              <WrapTextIcon className="size-3.5" />
            </FileSurfaceAction>
          ) : null}
          {canOpenInBrowser ? (
            <FileSurfaceAction
              label={gt("Open file in preview browser")}
              onPress={handleOpenInBrowser}
            >
              <Globe2 className="size-3.5" />
            </FileSurfaceAction>
          ) : null}
          {!isHostFile && previewPath !== null ? (
            <FileSurfaceAction
              label={explorerOpen ? gt("Hide file explorer") : gt("Show file explorer")}
              pressed={explorerOpen}
              onPress={toggleExplorer}
            >
              <FolderTree className="size-3.5" />
            </FileSurfaceAction>
          ) : null}
        </div>
      ) : null}
      {relativePath && !attachment && !isHostFile && !canWriteFiles && !fileAccess.isPending ? (
        <div className="shrink-0 border-b px-3 py-1.5 text-2xs text-muted-foreground">
          <T>Read-only connection. Unsaved edits are kept until write access returns.</T>
        </div>
      ) : null}
      {previewPath &&
      attachment === undefined &&
      !isMedia &&
      !renderBrowserFile &&
      file.data?.truncated ? (
        <div className="shrink-0 border-b border-warning/20 bg-warning-surface px-3 py-1.5 text-2xs text-warning-foreground">
          {gt(
            "{count, plural, one {Preview limited to the first 1 MB of a {formatted} byte file.} other {Preview limited to the first 1 MB of a {formatted} byte file.}}",
            { count: file.data.byteLength, formatted: file.data.byteLength.toLocaleString() },
          )}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {previewPath && showExplorer ? (
          <ResizableColumns
            className="h-full flex-1"
            storageKey="t3code.fileExplorerTreeRatio"
            defaultRatio={0.72}
            firstMinPx={280}
            secondMinPx={192}
            separatorLabel={gt("Resize files tree")}
            first={previewSurface}
            second={
              <aside
                className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background"
                onClick={focusEditorOnTreeRowClickOrEnter}
                onKeyDown={(event) => {
                  if (event.key === "Enter") focusEditorOnTreeRowClickOrEnter(event);
                }}
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
                  <MultiRootFileBrowser
                    active={active}
                    environmentId={environmentId}
                    roots={roots}
                    threadRef={threadRef}
                    projectName={projectName}
                    revealRequestId={effectiveRevealRequestId}
                    selectedCwd={activeCwd}
                    selectedPath={relativePath}
                    onOpenFile={onOpenFile}
                    answersPanelFind={!previewPath}
                    workspaceMutationId={workspaceMutationId}
                  />
                )}
              </aside>
            }
          />
        ) : previewPath || !showExplorer ? (
          previewSurface
        ) : (
          <aside className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
            {hostFolderPath !== null ? (
              <FileBrowserPanel
                key={`${environmentId}:${hostFolderPath}`}
                active={active}
                environmentId={environmentId}
                cwd={hostFolderPath}
                projectName={hostFolderPath}
                hostFolder
                selectedPath={trailChildOf(hostFolderPath, breadcrumbTrail ?? hostFolderPath)}
                selectedPathRevealId={revealRequestId}
                onOpenFile={(path) => onOpenFile(path, activeCwd)}
                answersPanelFind
                workspaceMutationId={workspaceMutationId}
              />
            ) : (
              <MultiRootFileBrowser
                active={active}
                environmentId={environmentId}
                roots={roots}
                threadRef={threadRef}
                projectName={projectName}
                revealRequestId={revealRequestId}
                selectedCwd={activeCwd}
                selectedPath={relativePath}
                answersPanelFind
                workspaceMutationId={workspaceMutationId}
                onOpenFile={(path, rootPath) => {
                  setSelectedRootCwd(rootPath);
                  onOpenFile(path, rootPath);
                }}
                {...(previewPath && !isMedia && !isPdf
                  ? {
                      onRefreshSelectedFile: () => {
                        if (!isDocument) file.refresh();
                        setFileRefreshRevision((value) => value + 1);
                      },
                    }
                  : {})}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

const LargeTextViewer = lazy(() => import("./LargeTextViewer"));
export function WorkspaceLargeTextPreview(props: {
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef;
  absolutePath: string;
  name: string;
  delimiter: "," | "\t" | null;
  workspaceMutationId: string | null;
  revealLine: number | null;
  revealRequestId: number;
  wordWrap?: boolean;
}) {
  const resource = {
    _tag: "media-file",
    threadId: props.threadRef.threadId,
    path: props.absolutePath,
    disposition: "attachment",
  } as const;
  const gt = useGT();
  const copyContents = useRef<(() => Promise<string>) | null>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: namedClipboardTarget(props.name),
  });
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const showError = (cause: unknown) => {
    toastManager.add({
      type: "error",
      title: gt("Could not read file"),
      description: thrownErrorMessage(cause, m) ?? gt("Try again."),
    });
  };
  // Each workspace mutation re-mints the URL, so an edited file loads its new bytes.
  const assetUrl = useAssetUrlState(
    props.environmentId,
    resource,
    props.workspaceMutationId ?? undefined,
  );
  const refreshAssetUrl = useAssetUrlRefresh(props.environmentId, resource);
  const contentRevision = JSON.stringify([
    props.environmentId,
    resource,
    assetUrl._tag === "Success" ? (assetUrl.fileRevision ?? props.workspaceMutationId) : null,
    revision,
  ]);
  const [loaded, setLoaded] = useState<{ revision: string; url: string } | null>(null);
  if (assetUrl._tag === "Success" && loaded?.revision !== contentRevision) {
    setLoaded({ revision: contentRevision, url: assetUrl.url });
  }
  if (assetUrl._tag === "Failure")
    return (
      <FileSurfaceFailure
        message={gt("Unable to load file preview.")}
        onRetry={() => {
          setRevision((value) => value + 1);
          void refreshAssetUrl().catch(showError);
        }}
      />
    );
  if (assetUrl._tag !== "Success" || loaded === null)
    return (
      <div className="p-6 text-xs text-muted-foreground">
        <T>Loading…</T>
      </div>
    );
  const src = `${loaded.url}${loaded.url.includes("?") ? "&" : "?"}revision=${encodeURIComponent(loaded.revision)}`;
  return (
    <>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3">
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">
          <T>Full file</T>
        </span>
        <FileSurfaceAction
          label={isCopied ? gt("Copied") : gt("Copy contents")}
          onPress={() => {
            const copy = copyContents.current;
            if (!copy) return;
            void copy()
              .then((text) => copyToClipboard(text, undefined))
              .catch(showError);
          }}
        >
          {isCopied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </FileSurfaceAction>
        <FileSurfaceAction
          label={saving ? gt("Preparing file…") : gt("Save file")}
          disabled={saving}
          onPress={() => {
            setSaving(true);
            void (async () => {
              const url = await refreshAssetUrl();
              if (!url) throw new Error(gt("Reconnect to the environment and try again."));
              const response = await fetch(url);
              if (!response.ok) throw new Error(gt("The file could not be loaded. Try again."));
              const downloadUrl = URL.createObjectURL(await response.blob());
              setTimeout(() => URL.revokeObjectURL(downloadUrl), 30_000);
              const anchor = document.createElement("a");
              anchor.href = downloadUrl;
              anchor.download = props.name.split(/[\\/]/).at(-1) || props.name;
              anchor.click();
            })()
              .catch(showError)
              .finally(() => setSaving(false));
          }}
        >
          <DownloadIcon className="size-3.5" />
        </FileSurfaceAction>
      </div>
      <Suspense
        fallback={
          <div className="p-6 text-xs text-muted-foreground">
            <T>Loading…</T>
          </div>
        }
      >
        <LargeTextViewer
          key={`${src}:${revision}`}
          name={props.name}
          copyContents={copyContents}
          onRetry={() => {
            void refreshAssetUrl()
              .then(() => setRevision((value) => value + 1))
              .catch(showError);
          }}
          src={src}
          delimiter={props.delimiter}
          {...(props.wordWrap === undefined ? {} : { wordWrap: props.wordWrap })}
          revealLine={props.revealLine}
          revealRequestId={props.revealRequestId}
        />
      </Suspense>
    </>
  );
}
