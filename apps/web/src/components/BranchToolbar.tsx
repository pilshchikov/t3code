import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ProjectWorkspace,
  ProjectWorkspaceColor,
  ThreadId,
} from "@t3tools/contracts";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloudIcon,
  FolderGit2Icon,
  FolderGitIcon,
  FolderIcon,
  HistoryIcon,
  NotebookPenIcon,
  MonitorIcon,
  PlusIcon,
  ScaleIcon,
} from "lucide-react";
import {
  type Ref,
  memo,
  useImperativeHandle,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { useOpenDirectoryCommandPalette } from "../commandPaletteContext";
import { useProject, useThreadShell, useThreadShellsForProjectRefs } from "../state/entities";
import { useIsMobile } from "../hooks/useMediaQuery";
import { projectEnvironment } from "../state/projects";
import { useAtomCommand } from "../state/use-atom-command";
import { useEnvironmentQuery } from "../state/query";
import { multiworkEnvironment } from "../state/multiwork";
import {
  PROJECT_WORKSPACE_COLORS,
  resolveWorkspaceColor,
  workspaceBadgeClassName,
  workspaceDisplayName,
} from "../lib/projectWorkspacePresentation";
import {
  type EnvMode,
  type EnvironmentOption,
  isExplicitWorkspaceModeSelectionReason,
  resolveContextStripLabelsCompact,
  resolveCurrentWorkspaceLabel,
  resolveEnvModeLabel,
  resolveEffectiveEnvMode,
  resolveLockedWorkspaceLabel,
  resolvePreviousWorktreeLabel,
  resolvePreviousWorktreeSeed,
  shouldShowEnvironmentIndicator,
} from "./BranchToolbar.logic";
import {
  BranchToolbarBranchSelector,
  type BranchToolbarBranchSelectorHandle,
} from "./BranchToolbarBranchSelector";
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";
import { BranchToolbarEnvironmentSelector } from "./BranchToolbarEnvironmentSelector";
import { BranchToolbarEnvModeSelector } from "./BranchToolbarEnvModeSelector";
import { Button } from "./ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "./ui/menu";
import { Separator } from "./ui/separator";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "./ui/popover";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Textarea } from "./ui/textarea";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { useComposerMenuProps } from "./chat/composerEventScope";

export interface BranchToolbarHandle {
  openBranchPicker: () => void;
  usePreviousWorktree: () => void;
}

interface BranchToolbarProps {
  ref?: Ref<BranchToolbarHandle>;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  showGitControls: boolean;
  draftId?: DraftId;
  onEnvModeChange: (mode: EnvMode) => void;
  effectiveEnvModeOverride?: EnvMode;
  activeThreadBranchOverride?: string | null;
  onActiveThreadBranchOverrideChange?: (branch: string | null) => void;
  startFromOrigin: boolean;
  onStartFromOriginChange: (startFromOrigin: boolean) => void;
  autoEnvironmentLabel?: string | undefined;
  onAutoEnvironment?: (() => void) | undefined;
  envLocked: boolean;
  /** Allow changing the workspace mode after a server thread has started. */
  allowWorkspaceModeChange?: boolean;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;
  availableEnvironments?: readonly EnvironmentOption[];
  onEnvironmentChange?: (environmentId: EnvironmentId) => void;
  contextStripCollapsed: boolean;
  onContextStripCollapsedChange: (collapsed: boolean) => void;
  /** Reserved host used by the upstream compact-composer layout. */
  composerControlsHostRef?: (element: HTMLDivElement | null) => void;
  contextStripVisible?: boolean;
}

function WorkspaceBadge(props: {
  workspace: ProjectWorkspace;
  index: number;
  compact?: boolean;
  onColorChange: (color: ProjectWorkspaceColor) => void;
}) {
  const color = resolveWorkspaceColor(props.workspace, props.index);
  return (
    <Menu>
      <MenuTrigger
        className={workspaceBadgeClassName(
          color,
          `truncate rounded px-1.5 py-0.5 text-[10px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${props.compact ? "max-w-20" : "max-w-32"}`,
        )}
        title={`${props.workspace.path} · Change directory color`}
      >
        {workspaceDisplayName(props.workspace, props.index)}
      </MenuTrigger>
      <MenuPopup align="start" side="top" className="w-36">
        <MenuGroup>
          <MenuGroupLabel>Directory color</MenuGroupLabel>
          {PROJECT_WORKSPACE_COLORS.map((option) => (
            <MenuItem key={option.color} onClick={() => props.onColorChange(option.color)}>
              <span className={`size-2.5 rounded-full ${option.dotClassName}`} />
              <span>{option.label}</span>
              {option.color === color ? <CheckIcon className="ms-auto size-3.5" /> : null}
            </MenuItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

function AgentGuidanceButton(props: { workspace: ProjectWorkspace; onClick: () => void }) {
  const hasGuidance = Boolean(props.workspace.agentGuidance?.trim());
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={hasGuidance ? "text-primary" : "text-muted-foreground"}
            aria-label={`Edit agent guidance for ${props.workspace.label ?? props.workspace.path}`}
            onClick={props.onClick}
          />
        }
      >
        <NotebookPenIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="top">
        {hasGuidance ? "Edit agent guidance" : "Add agent guidance"}
      </TooltipPopup>
    </Tooltip>
  );
}

interface MobileRunContextSelectorProps {
  multiworkTarget?: {
    environmentId: EnvironmentId;
    cwd: string;
    onSelect: (copy: import("@t3tools/contracts").MultiworkCopy) => void;
  };
  autoEnvironmentLabel?: string | undefined;
  onAutoEnvironment?: (() => void) | undefined;
  envLocked: boolean;
  envModeLocked: boolean;
  environmentId: EnvironmentId;
  availableEnvironments: readonly EnvironmentOption[] | undefined;
  showEnvironmentPicker: boolean;
  showEnvironmentIndicator: boolean;
  onEnvironmentChange: ((environmentId: EnvironmentId) => void) | undefined;
  effectiveEnvMode: EnvMode;
  activeWorktreePath: string | null;
  onEnvModeChange: (mode: EnvMode) => void;
  previousWorktreeLabel: string | null;
  onUsePreviousWorktree: () => void;
}

const MobileRunContextSelector = memo(function MobileRunContextSelector({
  multiworkTarget,
  autoEnvironmentLabel,
  onAutoEnvironment,
  envLocked,
  envModeLocked,
  environmentId,
  availableEnvironments,
  showEnvironmentPicker,
  showEnvironmentIndicator,
  onEnvironmentChange,
  effectiveEnvMode,
  activeWorktreePath,
  onEnvModeChange,
  previousWorktreeLabel,
  onUsePreviousWorktree,
}: MobileRunContextSelectorProps) {
  const copies = useEnvironmentQuery(
    multiworkTarget && !envModeLocked
      ? multiworkEnvironment.copies({ environmentId, input: { cwd: multiworkTarget.cwd } })
      : null,
  );
  const composerFloatingLayerProps = useComposerMenuProps();
  const activeEnvironment = useMemo(
    () => availableEnvironments?.find((env) => env.environmentId === environmentId) ?? null,
    [availableEnvironments, environmentId],
  );
  const WorkspaceIcon =
    effectiveEnvMode === "worktree"
      ? FolderGit2Icon
      : activeWorktreePath
        ? FolderGitIcon
        : FolderIcon;
  const workspaceLabel = envModeLocked
    ? resolveLockedWorkspaceLabel(activeWorktreePath)
    : effectiveEnvMode === "worktree"
      ? resolveEnvModeLabel("worktree")
      : resolveCurrentWorkspaceLabel(activeWorktreePath);
  const isLocked = envModeLocked;
  const icon = showEnvironmentIndicator ? (
    // Button's base styles apply `-mx-0.5` to descendant SVGs, which eats 4px
    // out of whatever gap we set. mx-0! cancels that so gap-0.5 reads as 2px.
    <span className="inline-flex shrink-0 items-center gap-0.5">
      {autoEnvironmentLabel ? (
        <ScaleIcon className="size-3 shrink-0 mx-0!" aria-hidden="true" />
      ) : (
        <EnvironmentMachineIcon
          kind={activeEnvironment?.machine ?? "server"}
          className="size-3 shrink-0 mx-0!"
        />
      )}
      <WorkspaceIcon className="size-3 shrink-0 mx-0!" />
    </span>
  ) : (
    <WorkspaceIcon className="size-3 shrink-0" />
  );
  const triggerContent = (
    <>
      {icon}
      <span
        data-composer-label
        className="min-w-0 max-w-[240px] group-data-[compact]/composer-context:max-w-0"
      >
        <span
          data-composer-label-motion
          className="block w-full min-w-0 max-w-[240px] truncate transition-opacity duration-180 ease-[cubic-bezier(0.32,0.72,0,1)] group-data-[compact]/composer-context:opacity-0 motion-reduce:transition-none"
        >
          {autoEnvironmentLabel ??
            (showEnvironmentIndicator ? (activeEnvironment?.label ?? "Run on") : workspaceLabel)}
        </span>
      </span>
    </>
  );

  if (isLocked) {
    return (
      <span
        className="inline-flex h-7 min-w-0 max-w-[48%] flex-initial items-center justify-start gap-1 rounded-md border border-transparent px-[calc(--spacing(2)-1px)] font-normal text-muted-foreground/70 text-xs sm:h-6"
        data-composer-context-control
      >
        {triggerContent}
      </span>
    );
  }

  return (
    <Menu>
      <MenuTrigger
        render={<Button variant="ghost" size="xs" />}
        className="min-w-0 max-w-[48%] flex-initial justify-start font-normal text-muted-foreground/70 text-xs! hover:text-foreground/80"
        data-composer-context-control
        data-composer-shortcut={[
          showEnvironmentPicker && !envLocked ? "composer.host" : "",
          !envModeLocked ? "composer.workspace" : "",
        ].join(" ")}
      >
        {triggerContent}
        <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
      </MenuTrigger>
      <MenuPopup align="start" side="top" className="w-64" {...composerFloatingLayerProps}>
        {showEnvironmentPicker && availableEnvironments && onEnvironmentChange ? (
          <>
            <MenuGroup>
              <MenuGroupLabel>Run on</MenuGroupLabel>
              <MenuRadioGroup
                value={autoEnvironmentLabel ? "auto" : environmentId}
                onValueChange={(value) =>
                  value === "auto"
                    ? onAutoEnvironment?.()
                    : onEnvironmentChange(value as EnvironmentId)
                }
              >
                {onAutoEnvironment && (
                  <MenuRadioItem
                    value="auto"
                    disabled={envLocked}
                    onClick={() => {
                      if (autoEnvironmentLabel) onAutoEnvironment?.();
                    }}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <ScaleIcon className="size-3" aria-hidden="true" />
                      <span className="min-w-0 truncate">
                        {autoEnvironmentLabel ?? "Auto balance"}
                      </span>
                    </span>
                  </MenuRadioItem>
                )}
                {availableEnvironments.map((env) => (
                  <MenuRadioItem
                    key={env.environmentId}
                    disabled={envLocked}
                    value={env.environmentId}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <EnvironmentMachineIcon kind={env.machine} className="size-3" />
                      <span className="min-w-0 truncate">{env.label}</span>
                    </span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
          </>
        ) : null}
        <MenuGroup>
          <MenuGroupLabel>Workspace</MenuGroupLabel>
          <MenuRadioGroup
            value={effectiveEnvMode}
            onValueChange={(value, eventDetails) => {
              if (!isExplicitWorkspaceModeSelectionReason(eventDetails.reason)) return;
              if (value.startsWith("copy:")) {
                const copy = copies.data?.copies.find((item) => `copy:${item.path}` === value);
                if (copy) multiworkTarget?.onSelect(copy);
                return;
              }
              if (value === "previous-worktree") {
                onUsePreviousWorktree();
                return;
              }
              onEnvModeChange(value as EnvMode);
            }}
          >
            <MenuRadioItem disabled={envModeLocked} value="local">
              <span className="flex min-w-0 items-center gap-1.5">
                {activeWorktreePath ? (
                  <FolderGitIcon className="size-3" />
                ) : (
                  <FolderIcon className="size-3" />
                )}
                <span className="min-w-0 truncate">
                  {resolveCurrentWorkspaceLabel(activeWorktreePath)}
                </span>
              </span>
            </MenuRadioItem>
            <MenuRadioItem disabled={envModeLocked} value="worktree">
              <span className="flex min-w-0 items-center gap-1.5">
                <FolderGit2Icon className="size-3" />
                <span className="min-w-0 truncate">{resolveEnvModeLabel("worktree")}</span>
              </span>
            </MenuRadioItem>
            <MenuRadioItem disabled={envModeLocked} value="multiwork">
              New multiwork copy
            </MenuRadioItem>
            {copies.data?.copies.map((copy) => (
              <MenuRadioItem key={copy.path} value={`copy:${copy.path}`} disabled={envModeLocked}>
                <span className="max-w-64 truncate">Multiwork · {copy.branch || copy.name}</span>
              </MenuRadioItem>
            ))}
            {previousWorktreeLabel ? (
              <MenuRadioItem disabled={envModeLocked} value="previous-worktree">
                <span className="flex min-w-0 items-center gap-1.5">
                  <HistoryIcon className="size-3" />
                  <span className="min-w-0 truncate">{previousWorktreeLabel}</span>
                </span>
              </MenuRadioItem>
            ) : null}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
});

/**
 * Collapse the strip's labels to icons only when the text no longer fits.
 *
 * Hidden labels stay measurable because their inner text keeps its natural
 * width while the outer layout box collapses. This lets every pass recompute
 * the expanded width without remembered values that could go stale or latch
 * the strip compact. A small hysteresis keeps the boundary from flapping.
 */
const COMPOSER_CONTEXT_MOTION_DURATION_MS = 180;
const COMPOSER_CONTEXT_MOTION_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
const COMPOSER_CONTEXT_LABEL_SELECTOR = "[data-composer-label]";

function useLabelsOverflow(element: HTMLDivElement | null): boolean {
  const [overflows, setOverflows] = useState(false);
  const pendingLabelRectsRef = useRef<Map<HTMLElement, DOMRect> | null>(null);
  const labelAnimationsRef = useRef(new Map<HTMLElement, Animation>());
  // A render-synced mirror instead of useEffectEvent: the compiler memoizes
  // the event callback, which left observers reading the first render's null
  // element forever.
  const stateRef = useRef({ element, overflows });
  stateRef.current = { element, overflows };

  const measure = useCallback(() => {
    const { element: current, overflows: compact } = stateRef.current;
    if (!current) return;
    const available = current.clientWidth;
    if (available === 0) return;
    // flex-1 stretches the groups to fill the strip, so their own boxes always
    // measure "full". Sum the laid-out content instead, skipping hidden form
    // artifacts and other out-of-flow nodes.
    const contentWidth = (parent: Element): number => {
      const gap = Number.parseFloat(getComputedStyle(parent).columnGap) || 0;
      let width = 0;
      let counted = 0;
      for (const child of parent.children) {
        if (!(child instanceof HTMLElement)) continue;
        if (child.offsetWidth === 0) continue;
        const style = getComputedStyle(child);
        const position = style.position;
        if (position === "absolute" || position === "fixed") continue;
        width +=
          child.offsetWidth +
          (Number.parseFloat(style.marginInlineStart) || 0) +
          (Number.parseFloat(style.marginInlineEnd) || 0);
        counted += 1;
      }
      return width + gap * Math.max(0, counted - 1);
    };
    const stripGap = Number.parseFloat(getComputedStyle(current).columnGap) || 0;
    let needed = 0;
    let groups = 0;
    for (const child of current.children) {
      if (!(child instanceof HTMLElement) || child.offsetWidth <= 1) continue;
      needed += contentWidth(child);
      groups += 1;
    }
    needed += stripGap * Math.max(0, groups - 1);
    for (const label of current.querySelectorAll<HTMLElement>("[data-composer-label]")) {
      // The clipping can happen below the marker (SelectValue truncates
      // internally), where the outer span's scrollWidth matches its clipped
      // box. The text's real width is the largest scrollWidth in the subtree.
      let textWidth = label.scrollWidth;
      for (const inner of label.querySelectorAll<HTMLElement>("*")) {
        textWidth = Math.max(textWidth, inner.scrollWidth);
      }
      // Subtract the visible width even during an animation. The content
      // sum already includes it; only the hidden text needs reserving.
      needed += Math.max(0, textWidth - label.getBoundingClientRect().width);
    }
    const nextOverflows = resolveContextStripLabelsCompact({
      compact,
      neededWidth: needed,
      availableWidth: available,
    });
    if (nextOverflows !== compact) {
      pendingLabelRectsRef.current = new Map(
        Array.from(current.querySelectorAll<HTMLElement>(COMPOSER_CONTEXT_LABEL_SELECTOR)).map(
          (label) => [label, label.getBoundingClientRect()],
        ),
      );
    }
    setOverflows(nextOverflows);
  }, []);

  useLayoutEffect(() => {
    const previousRects = pendingLabelRectsRef.current;
    if (!previousRects) return;
    pendingLabelRectsRef.current = null;

    for (const animation of labelAnimationsRef.current.values()) {
      animation.cancel();
    }
    labelAnimationsRef.current.clear();

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    for (const [label, previousRect] of previousRects) {
      if (!label.isConnected) continue;
      const nextWidth = label.getBoundingClientRect().width;
      if (Math.abs(previousRect.width - nextWidth) < 0.5) continue;

      // Animate the space occupied by each label so flex layout keeps the
      // trailing controls anchored. Translating the whole group after its
      // width snaps sends expanded text beyond the strip's right edge.
      const animation = label.animate(
        [
          { width: `${previousRect.width}px`, maxWidth: `${previousRect.width}px` },
          { width: `${nextWidth}px`, maxWidth: `${nextWidth}px` },
        ],
        {
          duration: COMPOSER_CONTEXT_MOTION_DURATION_MS,
          easing: COMPOSER_CONTEXT_MOTION_EASING,
          fill: "backwards",
        },
      );
      labelAnimationsRef.current.set(label, animation);
      animation.addEventListener(
        "finish",
        () => {
          if (labelAnimationsRef.current.get(label) === animation) {
            labelAnimationsRef.current.delete(label);
          }
        },
        { once: true },
      );
    }
  }, [overflows]);

  useEffect(
    () => () => {
      for (const animation of labelAnimationsRef.current.values()) {
        animation.cancel();
      }
    },
    [],
  );

  // Label widths can change without the strip box moving (font family or
  // size preferences), so re-measure on every render as well as on resize
  // and font loads.
  useEffect(() => {
    measure();
  });

  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [element, measure]);

  return overflows;
}

export const BranchToolbar = memo(function BranchToolbar({
  ref,
  environmentId,
  threadId,
  showGitControls,
  draftId,
  onEnvModeChange,
  effectiveEnvModeOverride,
  activeThreadBranchOverride,
  onActiveThreadBranchOverrideChange,
  startFromOrigin,
  onStartFromOriginChange,
  autoEnvironmentLabel,
  onAutoEnvironment,
  envLocked,
  allowWorkspaceModeChange = false,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
  availableEnvironments,
  onEnvironmentChange,
  contextStripCollapsed,
  onContextStripCollapsedChange,
  composerControlsHostRef,
}: BranchToolbarProps) {
  const branchSelectorRef = useRef<BranchToolbarBranchSelectorHandle>(null);
  const composerFloatingLayerProps = useComposerMenuProps();
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const draftThread = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : store.getDraftThreadByRef(threadRef),
  );
  const serverThread = useThreadShell(threadRef);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const activeProjectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const activeProject = useProject(activeProjectRef);
  const isMobile = useIsMobile();
  const updateProject = useAtomCommand(projectEnvironment.update, { reportFailure: false });
  const hasActiveThread = serverThread !== null || draftThread !== null;
  const activeWorktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const effectiveEnvMode =
    effectiveEnvModeOverride ??
    resolveEffectiveEnvMode({
      activeWorktreePath,
      hasServerThread: serverThread !== null,
      draftThreadEnvMode: draftThread?.envMode,
    });
  const envModeLocked =
    !allowWorkspaceModeChange &&
    (envLocked || (serverThread !== null && activeWorktreePath !== null));

  // "Previous worktree" hops a draft into the most recently active worktree
  // of this project — the "keep going where I just was" follow-up flow. Only
  // drafts can hop; started server threads have their workspace pinned.
  const canUsePreviousWorktree = draftThread !== null && serverThread === null && !envModeLocked;
  const multiworkTarget =
    canUsePreviousWorktree && activeProject && activeProjectRef
      ? {
          environmentId,
          cwd: activeProject.workspaceRoot,
          onSelect: (copy: import("@t3tools/contracts").MultiworkCopy) =>
            setDraftThreadContext(draftId ?? threadRef, {
              branch: copy.branch || null,
              worktreePath: copy.path,
              envMode: "multiwork",
              environmentSelection: "manual",
              projectRef: activeProjectRef,
            }),
        }
      : undefined;
  const projectRefsForWorktreeLookup = useMemo(
    () => (canUsePreviousWorktree && activeProjectRef ? [activeProjectRef] : []),
    [canUsePreviousWorktree, activeProjectRef],
  );
  const projectThreads = useThreadShellsForProjectRefs(projectRefsForWorktreeLookup);
  const previousWorktreeSeed = useMemo(
    () =>
      canUsePreviousWorktree
        ? resolvePreviousWorktreeSeed({
            threads: projectThreads,
            currentWorktreePath: activeWorktreePath,
          })
        : null,
    [activeWorktreePath, canUsePreviousWorktree, projectThreads],
  );
  const previousWorktreeLabel = previousWorktreeSeed
    ? resolvePreviousWorktreeLabel(previousWorktreeSeed)
    : null;
  const onUsePreviousWorktree = useCallback(() => {
    if (!previousWorktreeSeed || !activeProjectRef) return;
    // Same shape the branch selector writes when picking a branch that
    // already lives in a worktree: point the draft at the existing tree.
    setDraftThreadContext(draftId ?? threadRef, {
      branch: previousWorktreeSeed.branch,
      worktreePath: previousWorktreeSeed.worktreePath,
      envMode: "worktree",
      projectRef: activeProjectRef,
    });
  }, [activeProjectRef, draftId, previousWorktreeSeed, setDraftThreadContext, threadRef]);

  useImperativeHandle(
    ref,
    () => ({
      openBranchPicker: () => branchSelectorRef.current?.open(),
      usePreviousWorktree: () => {
        if (!showGitControls || !canUsePreviousWorktree || !previousWorktreeSeed) return;
        onUsePreviousWorktree();
        onComposerFocusRequest?.();
      },
    }),
    [
      canUsePreviousWorktree,
      onComposerFocusRequest,
      onUsePreviousWorktree,
      previousWorktreeSeed,
      showGitControls,
    ],
  );

  const showEnvironmentPicker = Boolean(
    availableEnvironments && availableEnvironments.length > 1 && onEnvironmentChange,
  );
  const activeEnvironmentOption =
    availableEnvironments?.find((env) => env.environmentId === environmentId) ?? null;
  const showEnvironmentIndicator = shouldShowEnvironmentIndicator({
    activeEnvironment: activeEnvironmentOption,
    canPickEnvironment: showEnvironmentPicker,
  });
  const [stripElement, setStripElement] = useState<HTMLDivElement | null>(null);
  const labelsOverflow = useLabelsOverflow(stripElement);
  const workspaceRoots = useMemo(
    () =>
      activeProject?.workspaceRoots?.length
        ? activeProject.workspaceRoots
        : activeProject
          ? [{ path: activeProject.workspaceRoot, label: "Primary directory" }]
          : [],
    [activeProject?.workspaceRoot, activeProject?.workspaceRoots],
  );
  const canCollapseContextStrip = !isMobile && showGitControls && workspaceRoots.length > 1;
  const isContextStripCollapsed =
    (isMobile && showGitControls && workspaceRoots.length > 1) ||
    (canCollapseContextStrip && contextStripCollapsed);
  const openDirectoryPicker = useOpenDirectoryCommandPalette();
  const reportWorkspaceRootFailure = useCallback(
    (result: Awaited<ReturnType<typeof updateProject>>) => {
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to update project directories",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
    [],
  );
  const persistWorkspaceRoots = useCallback(
    async (nextRoots: typeof workspaceRoots) => {
      if (!activeProject) return;
      const result = await updateProject({
        environmentId: activeProject.environmentId,
        input: { projectId: activeProject.id, workspaceRoots: nextRoots },
      });
      reportWorkspaceRootFailure(result);
    },
    [activeProject, reportWorkspaceRootFailure, updateProject],
  );
  const addWorkspaceRoot = useCallback(() => {
    if (!activeProject) return;
    openDirectoryPicker({
      environmentId: activeProject.environmentId,
      initialPath: activeProject.workspaceRoot,
      onSelect: async (selectedPath) => {
        const normalizedPath = selectedPath.replace(/[\\/]+$/, "") || selectedPath;
        if (workspaceRoots.some((root) => root.path === normalizedPath)) {
          toastManager.add({ type: "warning", title: "Directory is already in this project" });
          return;
        }
        await persistWorkspaceRoots([...workspaceRoots, { path: normalizedPath }]);
      },
    });
  }, [activeProject, openDirectoryPicker, persistWorkspaceRoots, workspaceRoots]);
  const setWorkspaceRootMode = useCallback(
    (path: string, mode: EnvMode) => {
      void persistWorkspaceRoots(
        workspaceRoots.map((root) =>
          root.path === path ? { ...root, defaultThreadEnvMode: mode } : root,
        ),
      );
    },
    [persistWorkspaceRoots, workspaceRoots],
  );
  const setWorkspaceRootColor = useCallback(
    (path: string, color: ProjectWorkspaceColor) => {
      void persistWorkspaceRoots(
        workspaceRoots.map((root) => (root.path === path ? { ...root, color } : root)),
      );
    },
    [persistWorkspaceRoots, workspaceRoots],
  );
  const [guidanceWorkspacePath, setGuidanceWorkspacePath] = useState<string | null>(null);
  const guidanceWorkspace =
    workspaceRoots.find((root) => root.path === guidanceWorkspacePath) ?? null;
  const [guidanceDraft, setGuidanceDraft] = useState("");
  const openAgentGuidance = useCallback((workspace: ProjectWorkspace) => {
    setGuidanceWorkspacePath(workspace.path);
    setGuidanceDraft(workspace.agentGuidance ?? "");
  }, []);
  const saveAgentGuidance = useCallback(async () => {
    if (!guidanceWorkspace) return;
    const guidance = guidanceDraft.trim();
    await persistWorkspaceRoots(
      workspaceRoots.map((root) =>
        root.path === guidanceWorkspace.path
          ? {
              ...root,
              ...(guidance ? { agentGuidance: guidance } : { agentGuidance: undefined }),
            }
          : root,
      ),
    );
    setGuidanceWorkspacePath(null);
  }, [guidanceDraft, guidanceWorkspace, persistWorkspaceRoots, workspaceRoots]);

  const addWorkspaceRootButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Add directory to project"
            onClick={addWorkspaceRoot}
          />
        }
      >
        <PlusIcon className="size-3" />
      </TooltipTrigger>
      <TooltipPopup side="top">Add directory to project</TooltipPopup>
    </Tooltip>
  );

  const expandContextStrip = useCallback(() => {
    if (isMobile) return;
    onContextStripCollapsedChange(false);
  }, [isMobile, onContextStripCollapsedChange]);

  const useDirectoryChips = showGitControls && workspaceRoots.length > 1;
  const showCompactStrip = isContextStripCollapsed || useDirectoryChips;
  const compactContextStrip = showCompactStrip ? (
    <div
      className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 overflow-x-auto overflow-y-hidden py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      onClick={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest("button,[role='button']")) {
          return;
        }
        if (!useDirectoryChips) expandContextStrip();
      }}
    >
      {addWorkspaceRootButton}
      {showEnvironmentIndicator && availableEnvironments ? (
        <BranchToolbarEnvironmentSelector
          compact
          envLocked={envLocked}
          environmentId={environmentId}
          availableEnvironments={availableEnvironments}
          {...(showEnvironmentPicker && onEnvironmentChange ? { onEnvironmentChange } : {})}
        />
      ) : null}
      {workspaceRoots.map((root, rootIndex) => {
        const isPrimary = rootIndex === 0;
        const controls = (
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <WorkspaceBadge
              workspace={root}
              index={rootIndex}
              compact
              onColorChange={(color) => setWorkspaceRootColor(root.path, color)}
            />
            <BranchToolbarEnvModeSelector
              compact
              envLocked={isPrimary ? envModeLocked : false}
              effectiveEnvMode={
                isPrimary ? effectiveEnvMode : (root.defaultThreadEnvMode ?? "local")
              }
              activeWorktreePath={isPrimary ? activeWorktreePath : null}
              onEnvModeChange={(mode) =>
                isPrimary ? onEnvModeChange(mode) : setWorkspaceRootMode(root.path, mode)
              }
              {...(isPrimary
                ? {
                    previousWorktreeLabel,
                    onUsePreviousWorktree,
                    ...(multiworkTarget ? { multiworkTarget } : {}),
                  }
                : {})}
            />
            <AgentGuidanceButton workspace={root} onClick={() => openAgentGuidance(root)} />
            <BranchToolbarBranchSelector
              ref={branchSelectorRef}
              compact
              className="min-w-0 max-w-36"
              environmentId={environmentId}
              threadId={threadId}
              {...(draftId ? { draftId } : {})}
              envLocked={isPrimary ? envLocked : false}
              allowWorkspaceModeChange={isPrimary ? allowWorkspaceModeChange : false}
              {...(isPrimary && effectiveEnvModeOverride
                ? { effectiveEnvModeOverride }
                : !isPrimary && root.defaultThreadEnvMode
                  ? { effectiveEnvModeOverride: root.defaultThreadEnvMode }
                  : {})}
              {...(isPrimary && activeThreadBranchOverride !== undefined
                ? { activeThreadBranchOverride }
                : {})}
              {...(isPrimary && onActiveThreadBranchOverrideChange
                ? { onActiveThreadBranchOverrideChange }
                : {})}
              startFromOrigin={startFromOrigin}
              onStartFromOriginChange={onStartFromOriginChange}
              {...(isPrimary && onCheckoutPullRequestRequest
                ? { onCheckoutPullRequestRequest }
                : {})}
              {...(isPrimary ? {} : { workspaceRootOverride: root.path })}
              {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
            />
          </div>
        );
        return useDirectoryChips ? (
          <Popover key={root.path}>
            <PopoverTrigger
              data-composer-context-control="true"
              className={workspaceBadgeClassName(
                resolveWorkspaceColor(root, rootIndex),
                "flex h-7 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              aria-label={`Directory controls for ${workspaceDisplayName(root, rootIndex)}`}
              title={root.path}
            >
              <FolderIcon className="size-3 shrink-0 opacity-70" />
              <span className="truncate">{workspaceDisplayName(root, rootIndex)}</span>
              <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
            </PopoverTrigger>
            <PopoverPopup
              {...composerFloatingLayerProps}
              side="top"
              align="start"
              className="w-80 max-w-[calc(100vw-2rem)]"
              viewportClassName="space-y-3 p-3"
            >
              <div className="space-y-1">
                <PopoverTitle className="text-xs">
                  {workspaceDisplayName(root, rootIndex)}
                  {isPrimary ? (
                    <span className="ms-2 font-normal text-muted-foreground">Primary</span>
                  ) : null}
                </PopoverTitle>
                <p className="break-all font-mono text-[10px] text-muted-foreground">{root.path}</p>
              </div>
              {controls}
            </PopoverPopup>
          </Popover>
        ) : (
          <div key={root.path} className="shrink-0">
            {controls}
          </div>
        );
      })}
      {!useDirectoryChips ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="ms-auto shrink-0 max-md:hidden"
                aria-label="Expand project context"
                onClick={expandContextStrip}
              />
            }
          >
            <ChevronDownIcon className="size-3" />
          </TooltipTrigger>
          <TooltipPopup side="top">Expand project context</TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  ) : null;

  const collapseContextStripButton = canCollapseContextStrip ? (
    <div className="pointer-events-none absolute end-0 bottom-1 start-1 z-20 flex">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="pointer-events-auto bg-background/45 text-muted-foreground/70 shadow-xs hover:bg-background/75 hover:text-foreground"
              aria-label="Collapse project context"
              onClick={() => onContextStripCollapsedChange(true)}
            />
          }
        >
          <ChevronUpIcon className="size-3" />
        </TooltipTrigger>
        <TooltipPopup side="top">Collapse project context</TooltipPopup>
      </Tooltip>
    </div>
  ) : null;

  if (!hasActiveThread || !activeProject) return null;

  return (
    <div
      ref={setStripElement}
      data-compact={!showCompactStrip && labelsOverflow ? "" : undefined}
      data-collapsed={showCompactStrip ? "true" : undefined}
      className="chat-composer-context-strip group/composer-context -mt-4 mx-auto flex w-[calc(100%-2.75rem)] max-w-[calc(48rem-2.75rem)] items-center gap-2 overflow-x-clip overflow-y-visible ps-1 pe-2 pt-5 pb-1"
    >
      {composerControlsHostRef ? (
        <div
          ref={composerControlsHostRef}
          className="flex min-w-0 shrink items-center gap-1 empty:hidden"
          data-composer-controls-host="true"
        />
      ) : null}
      {compactContextStrip}
      {!showCompactStrip && isMobile && showGitControls ? (
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {addWorkspaceRootButton}
          <MobileRunContextSelector
            {...(multiworkTarget ? { multiworkTarget } : {})}
            autoEnvironmentLabel={autoEnvironmentLabel}
            onAutoEnvironment={onAutoEnvironment}
            envLocked={envLocked}
            envModeLocked={envModeLocked}
            environmentId={environmentId}
            availableEnvironments={availableEnvironments}
            showEnvironmentPicker={showEnvironmentPicker}
            showEnvironmentIndicator={showEnvironmentIndicator}
            onEnvironmentChange={onEnvironmentChange}
            effectiveEnvMode={effectiveEnvMode}
            activeWorktreePath={activeWorktreePath}
            onEnvModeChange={onEnvModeChange}
            previousWorktreeLabel={previousWorktreeLabel}
            onUsePreviousWorktree={onUsePreviousWorktree}
          />
        </div>
      ) : !showCompactStrip ? (
        <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          <div className="flex min-w-0 max-w-full items-center gap-1">
            {showGitControls ? addWorkspaceRootButton : null}
            {showGitControls && workspaceRoots.length > 1 ? (
              workspaceRoots[0] ? (
                <WorkspaceBadge
                  workspace={workspaceRoots[0]}
                  index={0}
                  onColorChange={(color) => setWorkspaceRootColor(workspaceRoots[0]!.path, color)}
                />
              ) : null
            ) : null}
            {showEnvironmentIndicator && availableEnvironments && (
              <>
                <BranchToolbarEnvironmentSelector
                  envLocked={envLocked}
                  environmentId={environmentId}
                  availableEnvironments={availableEnvironments}
                  {...(showEnvironmentPicker && onEnvironmentChange ? { onEnvironmentChange } : {})}
                />
                {showGitControls ? (
                  <Separator orientation="vertical" className="mx-0.5 h-3.5!" />
                ) : null}
              </>
            )}
            {showGitControls ? (
              <BranchToolbarEnvModeSelector
                envLocked={envModeLocked}
                {...(multiworkTarget ? { multiworkTarget } : {})}
                effectiveEnvMode={effectiveEnvMode}
                activeWorktreePath={activeWorktreePath}
                onEnvModeChange={onEnvModeChange}
                previousWorktreeLabel={previousWorktreeLabel}
                onUsePreviousWorktree={onUsePreviousWorktree}
              />
            ) : null}
          </div>
          {showGitControls
            ? workspaceRoots.slice(1).map((root, rootIndex) => (
                <div key={root.path} className="flex min-w-0 max-w-full items-center gap-1">
                  <span aria-hidden="true" className="size-6 shrink-0" />
                  <WorkspaceBadge
                    workspace={root}
                    index={rootIndex + 1}
                    onColorChange={(color) => setWorkspaceRootColor(root.path, color)}
                  />
                  <BranchToolbarEnvModeSelector
                    envLocked={false}
                    effectiveEnvMode={root.defaultThreadEnvMode ?? "local"}
                    activeWorktreePath={null}
                    onEnvModeChange={(mode) => setWorkspaceRootMode(root.path, mode)}
                  />
                </div>
              ))
            : null}
        </div>
      ) : null}

      {!showCompactStrip && showGitControls ? (
        <div className="flex min-w-0 flex-1 flex-col items-end gap-0.5 md:ml-auto md:flex-none">
          <div className="flex min-w-0 max-w-full items-center gap-1">
            {workspaceRoots[0] ? (
              <AgentGuidanceButton
                workspace={workspaceRoots[0]}
                onClick={() => openAgentGuidance(workspaceRoots[0]!)}
              />
            ) : null}
            <BranchToolbarBranchSelector
              ref={branchSelectorRef}
              className="min-w-0 flex-1 justify-end"
              environmentId={environmentId}
              threadId={threadId}
              {...(draftId ? { draftId } : {})}
              envLocked={envLocked}
              allowWorkspaceModeChange={allowWorkspaceModeChange}
              {...(effectiveEnvModeOverride ? { effectiveEnvModeOverride } : {})}
              {...(activeThreadBranchOverride !== undefined ? { activeThreadBranchOverride } : {})}
              {...(onActiveThreadBranchOverrideChange
                ? { onActiveThreadBranchOverrideChange }
                : {})}
              startFromOrigin={startFromOrigin}
              onStartFromOriginChange={onStartFromOriginChange}
              {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
              {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
            />
          </div>
          {workspaceRoots.slice(1).map((root, rootIndex) => (
            <div key={root.path} className="flex min-w-0 max-w-full items-center gap-1">
              {isMobile ? (
                <span className="max-w-24 truncate text-[10px] text-muted-foreground/60">
                  {workspaceDisplayName(root, rootIndex + 1)}
                </span>
              ) : null}
              <AgentGuidanceButton workspace={root} onClick={() => openAgentGuidance(root)} />
              <BranchToolbarBranchSelector
                className="min-w-0 flex-1 justify-end"
                environmentId={environmentId}
                threadId={threadId}
                {...(draftId ? { draftId } : {})}
                envLocked={false}
                allowWorkspaceModeChange={false}
                {...(root.defaultThreadEnvMode
                  ? { effectiveEnvModeOverride: root.defaultThreadEnvMode }
                  : {})}
                workspaceRootOverride={root.path}
                startFromOrigin={startFromOrigin}
                onStartFromOriginChange={onStartFromOriginChange}
                {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
              />
            </div>
          ))}
        </div>
      ) : null}
      {!showCompactStrip ? collapseContextStripButton : null}
      <Dialog
        open={guidanceWorkspace !== null}
        onOpenChange={(open) => {
          if (!open) setGuidanceWorkspacePath(null);
        }}
      >
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Agent guidance</DialogTitle>
            <DialogDescription>
              Private instructions sent with every agent turn for this directory. They are not shown
              in the chat transcript.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-2">
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {guidanceWorkspace?.path}
              </p>
              <Textarea
                value={guidanceDraft}
                maxLength={8000}
                placeholder="Example: Commit directly to main after each completed change. Do not create a branch."
                onChange={(event) => setGuidanceDraft(event.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                {guidanceDraft.length.toLocaleString()} / 8,000 characters
              </p>
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setGuidanceWorkspacePath(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveAgentGuidance()}>
              Save guidance
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
});
