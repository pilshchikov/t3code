import { describe, expect, it, vi } from "vite-plus/test";
import { measuredEndOffset, settleListScroll } from "./useTimelinePositionRestore";

describe("settleListScroll", () => {
  it.each([false, true])(
    "hands off when a streaming reply keeps moving the end (stalled promise: %s)",
    async (stalled) => {
      vi.useFakeTimers();
      // The node test environment has no animation frames; fake ones run on the fake clock.
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
        setTimeout(() => callback(0), 16),
      );
      // Every correction lands, then the reply grows before the next frame.
      const element = { scrollTop: 0, scrollHeight: 5_000, clientHeight: 800 };
      const list = {
        getScrollableNode: () => element as unknown as HTMLElement,
        scrollToOffset: ({ offset }: { offset: number }) => {
          element.scrollTop = offset;
          element.scrollHeight += 40;
          return stalled ? new Promise<void>(() => {}) : Promise.resolve();
        },
      };

      let settled = false;
      void settleListScroll(list, measuredEndOffset, () => false).then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(5_000);
      vi.useRealTimers();
      vi.unstubAllGlobals();

      expect(settled).toBe(true);
    },
  );
});
