import { useLayoutEffect, useRef } from "react";
import type { LegendListRef } from "@legendapp/list/react";
import type { AssistantCitationRequest } from "./AssistantCitationSource";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import type { RememberedTimelinePosition } from "./timelineScrollAnchoring";

/**
 * Scrolls a newly shown thread back to where the user left it, or to its end,
 * and reports the thread positioned once the saved row settles.
 */
export function useTimelinePositionRestore({
  listRef,
  listIdentityKey,
  restoringThreadPosition,
  rememberedPosition,
  rows,
  citationRequest,
  cancelPositionRestoreRef,
  onManualNavigation,
  onIsAtEndChange,
  onPositioned,
}: {
  readonly listRef: React.RefObject<LegendListRef | null>;
  readonly listIdentityKey: string;
  readonly restoringThreadPosition: boolean;
  readonly rememberedPosition: RememberedTimelinePosition | undefined;
  readonly rows: MessagesTimelineRow[];
  readonly citationRequest: AssistantCitationRequest | null;
  readonly cancelPositionRestoreRef: React.RefObject<(() => void) | null> | undefined;
  readonly onManualNavigation: () => void;
  readonly onIsAtEndChange: (atEnd: boolean) => void;
  readonly onPositioned: (identity: string) => void;
}) {
  const positionRestoreBudgetRef = useRef<{ threadKey: string; deadline: number } | null>(null);
  const restoreRowIndex =
    rememberedPosition?.atEnd === false
      ? rows.findIndex((row) => row.id === rememberedPosition.rowId)
      : -1;
  useLayoutEffect(() => {
    if (!restoringThreadPosition || rows.length === 0) return;
    const list = listRef.current;
    if (!list) return;
    if (citationRequest !== null) {
      onPositioned(listIdentityKey);
      return;
    }
    let cancelled = false;
    let settleFrame: number | null = null;
    let recoveryFrame: number | null = null;
    if (positionRestoreBudgetRef.current?.threadKey !== listIdentityKey) {
      positionRestoreBudgetRef.current = {
        threadKey: listIdentityKey,
        deadline: performance.now() + 1000,
      };
    }
    const deadline = positionRestoreBudgetRef.current.deadline;
    const viewport: HTMLElement | null = list.getScrollableNode?.() ?? null;
    const cancelRestoration = () => {
      if (cancelled) return;
      cancelled = true;
      if (settleFrame !== null) cancelAnimationFrame(settleFrame);
      if (recoveryFrame !== null) cancelAnimationFrame(recoveryFrame);
      // Supersede any pending estimated-index scroll before the browser applies the gesture.
      if (viewport) void list.scrollToOffset({ offset: viewport.scrollTop, animated: false });
      onPositioned(listIdentityKey);
    };
    const cancelForNavigation = () => {
      cancelRestoration();
      onManualNavigation();
    };
    const onScrollKey = (event: globalThis.KeyboardEvent) => {
      if (
        ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key) &&
        !(
          event.target instanceof Element &&
          event.target.closest("input, textarea, [contenteditable=true]")
        )
      )
        cancelForNavigation();
    };
    viewport?.addEventListener("wheel", cancelForNavigation, { passive: true });
    viewport?.addEventListener("touchmove", cancelForNavigation, { passive: true });
    viewport?.addEventListener("pointerdown", cancelForNavigation, { passive: true });
    viewport?.ownerDocument.addEventListener("keydown", onScrollKey);
    const position = rememberedPosition;
    const index = restoreRowIndex;
    const canRestoreRow =
      position?.atEnd === false && index >= 0 && Number.isFinite(position.offsetWithinRow);
    if (canRestoreRow) onManualNavigation();
    const finishAtEnd = () => {
      if (cancelled) return;
      // Do not wait for another imperative-scroll promise: the virtualizer may be
      // stuck settling the same layout that prevented the original restore.
      const element = list.getScrollableNode?.();
      if (element) {
        const offset = Math.max(0, element.scrollHeight - element.clientHeight);
        void list.scrollToOffset?.({ offset, animated: false }).catch(() => {});
        element.scrollTop = offset;
      }
      void list.scrollToEnd?.({ animated: false }).catch(() => {});
      onIsAtEndChange(true);
      onPositioned(listIdentityKey);
    };
    // This deadline runs independently of scroll promises and survives data churn.
    // Otherwise a never-resolving scroll, or stream updates restarting the effect,
    // can leave the conversation at the beginning forever.
    const recoverUnfinishedRestore = () => {
      if (cancelled) return;
      if (performance.now() >= deadline) {
        finishAtEnd();
      } else {
        recoveryFrame = requestAnimationFrame(recoverUnfinishedRestore);
      }
    };
    recoveryFrame = requestAnimationFrame(recoverUnfinishedRestore);
    if (cancelPositionRestoreRef) cancelPositionRestoreRef.current = cancelRestoration;
    const scrolling = canRestoreRow
      ? list.scrollToIndex({
          index,
          animated: false,
          viewPosition: 0,
          viewOffset: -position.offsetWithinRow,
        })
      : list.scrollToEnd?.({ animated: false });
    void Promise.resolve(scrolling)
      .then(() => {
        if (cancelled) return;
        if (!canRestoreRow) {
          const element = list.getScrollableNode?.();
          if (element && element.scrollHeight - element.clientHeight - element.scrollTop > 40) {
            finishAtEnd();
            return;
          }
          onIsAtEndChange(true);
          onPositioned(listIdentityKey);
          return;
        }
        // Index scrolling starts from estimates. Keep the saved row mounted
        // until its measured position and the DOM agree for two layout frames.
        let stableFrames = 0;
        let attempts = 0;
        const reconcile = () => {
          if (cancelled) return;
          // Missing/unmeasurable rows must never strand a thread at offset zero.
          attempts += 1;
          if (attempts > 60) {
            finishAtEnd();
            return;
          }
          const state = list.getState();
          const rowIndex = state.indexByKey(position.rowId);
          const row = rowIndex === undefined ? undefined : state.elementAtIndex(rowIndex);
          const element = list.getScrollableNode();
          if (!row || !element || element.clientHeight === 0) {
            settleFrame = requestAnimationFrame(reconcile);
            return;
          }
          const offset = Math.max(
            0,
            Math.min(
              element.scrollTop +
                row.getBoundingClientRect().top -
                element.getBoundingClientRect().top +
                position.offsetWithinRow,
              element.scrollHeight - element.clientHeight,
            ),
          );
          if (!Number.isFinite(offset)) {
            finishAtEnd();
            return;
          }
          if (Math.abs(element.scrollTop - offset) > 1) {
            stableFrames = 0;
            void list.scrollToOffset({ offset, animated: false }).then(() => {
              if (!cancelled) settleFrame = requestAnimationFrame(reconcile);
            });
            return;
          }
          stableFrames += 1;
          if (stableFrames >= 2) {
            onPositioned(listIdentityKey);
          } else {
            settleFrame = requestAnimationFrame(reconcile);
          }
        };
        settleFrame = requestAnimationFrame(reconcile);
      })
      .catch(finishAtEnd);
    return () => {
      cancelled = true;
      if (cancelPositionRestoreRef?.current === cancelRestoration) {
        cancelPositionRestoreRef.current = null;
      }
      if (settleFrame !== null) cancelAnimationFrame(settleFrame);
      if (recoveryFrame !== null) cancelAnimationFrame(recoveryFrame);
      viewport?.removeEventListener("wheel", cancelForNavigation);
      viewport?.removeEventListener("touchmove", cancelForNavigation);
      viewport?.removeEventListener("pointerdown", cancelForNavigation);
      viewport?.ownerDocument.removeEventListener("keydown", onScrollKey);
    };
  }, [
    citationRequest,
    cancelPositionRestoreRef,
    listIdentityKey,
    listRef,
    onManualNavigation,
    onPositioned,
    onIsAtEndChange,
    rememberedPosition,
    restoringThreadPosition,
    rows.length,
    restoreRowIndex,
  ]);
}
