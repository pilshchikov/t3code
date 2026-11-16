import { create } from "zustand";

import { composerTargetKey, type ComposerThreadTarget } from "../../composerDraftStore";

export interface SketchOrigin {
  readonly target: ComposerThreadTarget;
  readonly label: string;
}

export interface SketchWindowRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface SketchCanvasState {
  readonly open: boolean;
  readonly expanded: boolean;
  readonly origin: SketchOrigin | null;
  readonly rect: SketchWindowRect | null;
  openFor(origin: SketchOrigin, anchor: DOMRect | null): void;
  close(): void;
  setExpanded(expanded: boolean): void;
  setRect(rect: SketchWindowRect): void;
}

const COMPACT_WIDTH = 460;
const COMPACT_HEIGHT = 360;

function compactRectNear(anchor: DOMRect | null): SketchWindowRect {
  const width = Math.min(COMPACT_WIDTH, window.innerWidth - 24);
  const height = Math.min(COMPACT_HEIGHT, window.innerHeight - 24);
  const x = anchor ? anchor.right - width : window.innerWidth - width - 24;
  const y = anchor ? anchor.top - height - 12 : window.innerHeight - height - 120;
  return {
    x: Math.max(12, Math.min(x, window.innerWidth - width - 12)),
    y: Math.max(12, Math.min(y, window.innerHeight - height - 12)),
    width,
    height,
  };
}

export const useSketchCanvasStore = create<SketchCanvasState>((set, get) => ({
  open: false,
  expanded: false,
  origin: null,
  rect: null,
  openFor: (origin, anchor) => {
    const current = get();
    if (
      current.open &&
      current.origin &&
      composerTargetKey(current.origin.target) === composerTargetKey(origin.target)
    ) {
      set({ open: false });
      return;
    }
    set({
      open: true,
      origin,
      rect: current.rect ?? compactRectNear(anchor),
    });
  },
  close: () => set({ open: false, expanded: false }),
  setExpanded: (expanded) => set({ expanded }),
  setRect: (rect) => set({ rect }),
}));
