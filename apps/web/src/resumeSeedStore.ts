import { create } from "zustand";

/**
 * One-off "continue this on-disk CLI session" seeds, keyed by the draft thread's id. Set when the
 * user picks a discovered Claude/Codex session in the sidebar; consumed by the composer on that
 * thread's first turn so the new t3 thread attaches to the existing provider session (round-trip).
 */
export interface ResumeSeed {
  readonly resumeCursor: unknown;
  /** For display/telemetry only; routing uses the draft's preset model selection. */
  readonly providerLabel: string;
  readonly title: string;
}

interface ResumeSeedStoreState {
  readonly seedsByThreadId: Readonly<Record<string, ResumeSeed>>;
  readonly setSeed: (threadId: string, seed: ResumeSeed) => void;
  readonly peekSeed: (threadId: string) => ResumeSeed | undefined;
  readonly clearSeed: (threadId: string) => void;
}

export const useResumeSeedStore = create<ResumeSeedStoreState>((set, get) => ({
  seedsByThreadId: {},
  setSeed: (threadId, seed) =>
    set((state) => ({ seedsByThreadId: { ...state.seedsByThreadId, [threadId]: seed } })),
  peekSeed: (threadId) => get().seedsByThreadId[threadId],
  clearSeed: (threadId) =>
    set((state) => {
      if (!(threadId in state.seedsByThreadId)) return state;
      const next = { ...state.seedsByThreadId };
      delete next[threadId];
      return { seedsByThreadId: next };
    }),
}));
