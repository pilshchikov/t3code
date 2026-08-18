import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

/**
 * A client-local arrangement of the sidebar's active threads. Dragging a row is a view preference,
 * not thread state, so it never leaves this device and never touches the server.
 */
interface SidebarThreadOrderState {
  order: readonly string[];
  setOrder: (order: readonly string[]) => void;
  clearOrder: () => void;
}

/** Stored arrangements older than this many entries are trimmed on write. */
const MAX_TRACKED_THREADS = 200;

export const useSidebarThreadOrderStore = create<SidebarThreadOrderState>()(
  persist(
    (set) => ({
      order: [],
      setOrder: (order) => set({ order: order.slice(0, MAX_TRACKED_THREADS) }),
      clearOrder: () => set({ order: [] }),
    }),
    {
      name: "t3code:sidebar-thread-order:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ order: state.order }),
    },
  ),
);

/**
 * Rearranges the threads the user has dragged while leaving every other thread where the ordinary
 * sort put it. Arranged threads take the slots they collectively occupy in the natural order, so a
 * brand new thread still surfaces at the top instead of sinking below a stale arrangement.
 */
export function applySidebarThreadOrder<TItem>(input: {
  items: readonly TItem[];
  order: readonly string[];
  getId: (item: TItem) => string;
}): TItem[] {
  const { getId, items, order } = input;
  if (order.length === 0 || items.length === 0) return [...items];

  const rankById = new Map(order.map((id, index) => [id, index] as const));
  const slots: number[] = [];
  const arranged: TItem[] = [];
  for (const [index, item] of items.entries()) {
    if (!rankById.has(getId(item))) continue;
    slots.push(index);
    arranged.push(item);
  }
  if (arranged.length < 2) return [...items];

  arranged.sort((left, right) => rankById.get(getId(left))! - rankById.get(getId(right))!);
  const result = [...items];
  for (const [position, slot] of slots.entries()) {
    result[slot] = arranged[position]!;
  }
  return result;
}
