import { PROVIDER_SEND_TURN_MAX_IMAGE_BYTES } from "@t3tools/contracts";
import {
  CheckIcon,
  CircleIcon,
  DiamondIcon,
  HandIcon,
  Maximize2Icon,
  Minimize2Icon,
  MinusIcon,
  MousePointer2Icon,
  MoveUpRightIcon,
  PenLineIcon,
  Redo2Icon,
  SquareIcon,
  Trash2Icon,
  TypeIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { useComposerDraftStore, type ComposerImageAttachment } from "../../composerDraftStore";
import { prepareImageForAttachment } from "../../lib/imageCompression";
import { observeResize } from "../../lib/observeResize";
import { cn, randomUUID } from "~/lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import {
  boundsIntersect,
  drawElement,
  elementBounds,
  exportSketchPng,
  sketchBackground,
  hitTest,
  normalizeShape,
  textFont,
  textFontSizeFor,
  translateElement,
  type Bounds,
  type Point,
  type SketchElement,
  type View,
} from "./sketchScene";
import { useSketchCanvasStore, type SketchWindowRect } from "./sketchCanvasStore";

type Tool = "select" | "hand" | "pen" | "line" | "arrow" | "rect" | "ellipse" | "diamond" | "text";

const TOOLS: ReadonlyArray<{ tool: Tool; label: string; key: string; icon: ReactNode }> = [
  { tool: "select", label: "Select", key: "V", icon: <MousePointer2Icon /> },
  { tool: "hand", label: "Pan", key: "H", icon: <HandIcon /> },
  { tool: "pen", label: "Pen", key: "P", icon: <PenLineIcon /> },
  { tool: "line", label: "Line", key: "L", icon: <MinusIcon /> },
  { tool: "arrow", label: "Arrow", key: "A", icon: <MoveUpRightIcon /> },
  { tool: "rect", label: "Box", key: "R", icon: <SquareIcon /> },
  { tool: "ellipse", label: "Ellipse", key: "O", icon: <CircleIcon /> },
  { tool: "diamond", label: "Diamond", key: "D", icon: <DiamondIcon /> },
  { tool: "text", label: "Text", key: "T", icon: <TypeIcon /> },
];

const COLORS = [
  "#ffffff",
  "#9ca3af",
  "#f87171",
  "#fb923c",
  "#facc15",
  "#4ade80",
  "#22d3ee",
  "#60a5fa",
  "#c084fc",
  "#f472b6",
];

const WIDTHS = [
  { width: 2, label: "Thin" },
  { width: 4, label: "Medium" },
  { width: 8, label: "Bold" },
];

const SELECTION_COLOR = "#60a5fa";
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

interface TextEditor {
  readonly world: Point;
  readonly value: string;
  readonly editingId: string | null;
  readonly color: string;
  readonly fontSize: number;
}

type Gesture =
  | { kind: "pan"; startScreen: Point; startView: View }
  | { kind: "draw"; element: SketchElement; origin: Point }
  | { kind: "move"; lastWorld: Point; moved: boolean; before: readonly SketchElement[] }
  | { kind: "marquee"; origin: Point; current: Point; additive: boolean };

function snapAngle(origin: Point, point: Point): Point {
  const angle = Math.atan2(point.y - origin.y, point.x - origin.x);
  const step = Math.PI / 12;
  const snapped = Math.round(angle / step) * step;
  const length = Math.hypot(point.x - origin.x, point.y - origin.y);
  return { x: origin.x + Math.cos(snapped) * length, y: origin.y + Math.sin(snapped) * length };
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
}

interface PaintScene {
  readonly elements: readonly SketchElement[];
  readonly selection: ReadonlySet<string>;
  readonly view: View;
  readonly hiddenId: string | null;
  readonly background: string;
}

function paintSketch(canvas: HTMLCanvasElement, scene: PaintScene, active: Gesture | null) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { elements, selection, view, hiddenId } = scene;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = scene.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const spacing = 24 * view.zoom;
  if (spacing >= 8) {
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    const offsetX = (((view.x % spacing) + spacing) % spacing) * dpr;
    const offsetY = (((view.y % spacing) + spacing) % spacing) * dpr;
    const dot = Math.max(1, dpr);
    for (let x = offsetX; x < canvas.width; x += spacing * dpr) {
      for (let y = offsetY; y < canvas.height; y += spacing * dpr) ctx.fillRect(x, y, dot, dot);
    }
  }

  ctx.setTransform(view.zoom * dpr, 0, 0, view.zoom * dpr, view.x * dpr, view.y * dpr);
  for (const element of elements) {
    if (hiddenId !== element.id) drawElement(ctx, element);
  }
  if (active?.kind === "draw") drawElement(ctx, active.element);

  ctx.setLineDash([4 / view.zoom, 4 / view.zoom]);
  ctx.lineWidth = 1 / view.zoom;
  ctx.strokeStyle = SELECTION_COLOR;
  const pad = 4 / view.zoom;
  for (const element of elements) {
    if (!selection.has(element.id)) continue;
    const bounds = elementBounds(element);
    ctx.strokeRect(
      bounds.minX - pad,
      bounds.minY - pad,
      bounds.maxX - bounds.minX + pad * 2,
      bounds.maxY - bounds.minY + pad * 2,
    );
  }
  if (active?.kind === "marquee") {
    ctx.fillStyle = "rgba(96,165,250,0.08)";
    const x = Math.min(active.origin.x, active.current.x);
    const y = Math.min(active.origin.y, active.current.y);
    const w = Math.abs(active.current.x - active.origin.x);
    const h = Math.abs(active.current.y - active.origin.y);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }
  ctx.setLineDash([]);
}

function Tip(props: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.children} />
      <TooltipPopup side="top">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

export function SketchCanvasOverlay() {
  const open = useSketchCanvasStore((store) => store.open);
  const expanded = useSketchCanvasStore((store) => store.expanded);
  const origin = useSketchCanvasStore((store) => store.origin);
  const rect = useSketchCanvasStore((store) => store.rect);
  const close = useSketchCanvasStore((store) => store.close);
  const setExpanded = useSketchCanvasStore((store) => store.setExpanded);
  const setRect = useSketchCanvasStore((store) => store.setRect);

  const [elements, setElements] = useState<readonly SketchElement[]>([]);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]!);
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [textEditor, setTextEditorState] = useState<TextEditor | null>(null);
  const [sending, setSending] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const [history, setHistory] = useState<{
    past: readonly (readonly SketchElement[])[];
    future: readonly (readonly SketchElement[])[];
  }>({ past: [], future: [] });

  const clipboard = useRef<readonly SketchElement[]>([]);
  const gesture = useRef<Gesture | null>(null);
  // Blur, Enter and a canvas click can all end one edit in the same tick; only the first commits.
  const openEditor = useRef<TextEditor | null>(null);
  const setTextEditor = (next: TextEditor | null) => {
    openEditor.current = next;
    setTextEditorState(next);
  };
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const frame = useRef<number | null>(null);
  const scene = useRef<PaintScene>({
    elements,
    selection,
    view,
    hiddenId: null,
    background: sketchBackground(null),
  });

  const commit = (next: readonly SketchElement[], before: readonly SketchElement[] = elements) => {
    setHistory((current) => ({ past: [...current.past.slice(-199), before], future: [] }));
    setElements(next);
  };

  const undo = () => {
    const previous = history.past.at(-1);
    if (!previous) return;
    setHistory({ past: history.past.slice(0, -1), future: [...history.future, elements] });
    setElements(previous);
    setSelection(new Set());
  };

  const redo = () => {
    const next = history.future.at(-1);
    if (!next) return;
    setHistory({ past: [...history.past, elements], future: history.future.slice(0, -1) });
    setElements(next);
    setSelection(new Set());
  };

  const requestRedraw = () => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (canvasRef.current) paintSketch(canvasRef.current, scene.current, gesture.current);
    });
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- paints the imperative canvas after scene, selection or view changes
  useEffect(() => {
    scene.current = {
      elements,
      selection,
      view,
      hiddenId: textEditor?.editingId ?? null,
      background: sketchBackground(rootRef.current),
    };
    if (canvasRef.current) paintSketch(canvasRef.current, scene.current, gesture.current);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the canvas backing store matched to its resizable window
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!open || !canvas) return;
    return observeResize(canvas, () => {
      const dpr = window.devicePixelRatio || 1;
      const box = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(box.width * dpr));
      canvas.height = Math.max(1, Math.round(box.height * dpr));
      paintSketch(canvas, scene.current, gesture.current);
    });
  }, [open]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- wheel must be non-passive so pinch and scroll pan the canvas instead of the chat behind it
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!open || !canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = canvas.getBoundingClientRect();
      const screen = { x: event.clientX - box.left, y: event.clientY - box.top };
      setView((current) => {
        if (event.ctrlKey || event.metaKey) {
          const zoom = Math.min(
            MAX_ZOOM,
            Math.max(MIN_ZOOM, current.zoom * Math.exp(-event.deltaY * 0.01)),
          );
          const worldX = (screen.x - current.x) / current.zoom;
          const worldY = (screen.y - current.y) / current.zoom;
          return { zoom, x: screen.x - worldX * zoom, y: screen.y - worldY * zoom };
        }
        return { ...current, x: current.x - event.deltaX, y: current.y - event.deltaY };
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [open]);

  if (!open || !origin || !rect) return null;

  const toWorld = (event: { clientX: number; clientY: number }): Point => {
    const box = canvasRef.current!.getBoundingClientRect();
    return {
      x: (event.clientX - box.left - view.x) / view.zoom,
      y: (event.clientY - box.top - view.y) / view.zoom,
    };
  };

  const topElementAt = (point: Point) => {
    const tolerance = 6 / view.zoom;
    for (let index = elements.length - 1; index >= 0; index -= 1) {
      if (hitTest(elements[index]!, point, tolerance)) return elements[index]!;
    }
    return null;
  };

  const applyStyleToSelection = (next: { color?: string; width?: number }) => {
    if (selection.size === 0) return;
    commit(
      elements.map((element) => (selection.has(element.id) ? { ...element, ...next } : element)),
    );
  };

  const openTextEditor = (
    world: Point,
    existing: Extract<SketchElement, { kind: "text" }> | null,
  ) => {
    setTextEditor({
      world: existing ? { x: existing.x, y: existing.y } : world,
      value: existing?.text ?? "",
      editingId: existing?.id ?? null,
      color: existing?.color ?? color,
      fontSize: existing?.fontSize ?? textFontSizeFor(strokeWidth),
    });
  };

  const commitText = () => {
    const editor = openEditor.current;
    setTextEditor(null);
    if (!editor) return;
    const text = editor.value.replace(/\s+$/, "");
    if (editor.editingId) {
      commit(
        text.length === 0
          ? elements.filter((element) => element.id !== editor.editingId)
          : elements.map((element) =>
              element.id === editor.editingId && element.kind === "text"
                ? { ...element, text }
                : element,
            ),
      );
      return;
    }
    if (text.length === 0) return;
    commit([
      ...elements,
      {
        id: randomUUID(),
        kind: "text",
        color: editor.color,
        width: strokeWidth,
        x: editor.world.x,
        y: editor.world.y,
        text,
        fontSize: editor.fontSize,
      },
    ]);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    // The browser's own mousedown focus would steal focus from the text editor just opened.
    event.preventDefault();
    if (textEditor) {
      commitText();
      rootRef.current?.focus({ preventScroll: true });
      return;
    }
    rootRef.current?.focus({ preventScroll: true });
    const world = toWorld(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.button === 1 || tool === "hand" || spaceHeld) {
      gesture.current = {
        kind: "pan",
        startScreen: { x: event.clientX, y: event.clientY },
        startView: view,
      };
      setPanning(true);
      return;
    }
    if (event.button !== 0) return;
    const base = { id: randomUUID(), color, width: strokeWidth };
    switch (tool) {
      case "select": {
        const hit = topElementAt(world);
        if (hit) {
          const nextSelection = event.shiftKey
            ? new Set([...selection, hit.id])
            : selection.has(hit.id)
              ? selection
              : new Set([hit.id]);
          setSelection(nextSelection);
          gesture.current = { kind: "move", lastWorld: world, moved: false, before: elements };
        } else {
          if (!event.shiftKey) setSelection(new Set());
          gesture.current = {
            kind: "marquee",
            origin: world,
            current: world,
            additive: event.shiftKey,
          };
        }
        return;
      }
      case "text": {
        const hit = topElementAt(world);
        openTextEditor(world, hit?.kind === "text" ? hit : null);
        return;
      }
      case "pen":
        gesture.current = {
          kind: "draw",
          origin: world,
          element: { ...base, kind: "stroke", points: [world] },
        };
        break;
      case "line":
      case "arrow":
        gesture.current = {
          kind: "draw",
          origin: world,
          element: { ...base, kind: tool, start: world, end: world },
        };
        break;
      case "rect":
      case "ellipse":
      case "diamond":
        gesture.current = {
          kind: "draw",
          origin: world,
          element: { ...base, kind: tool, x: world.x, y: world.y, w: 0, h: 0 },
        };
        break;
    }
    requestRedraw();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const active = gesture.current;
    if (!active) return;
    if (active.kind === "pan") {
      setView({
        ...active.startView,
        x: active.startView.x + event.clientX - active.startScreen.x,
        y: active.startView.y + event.clientY - active.startScreen.y,
      });
      return;
    }
    const world = toWorld(event);
    if (active.kind === "move") {
      const dx = world.x - active.lastWorld.x;
      const dy = world.y - active.lastWorld.y;
      if (dx === 0 && dy === 0) return;
      gesture.current = { ...active, lastWorld: world, moved: true };
      setElements((current) =>
        current.map((element) =>
          selection.has(element.id) ? translateElement(element, dx, dy) : element,
        ),
      );
      return;
    }
    if (active.kind === "marquee") {
      gesture.current = { ...active, current: world };
      requestRedraw();
      return;
    }
    const element = active.element;
    switch (element.kind) {
      case "stroke": {
        const last = element.points[element.points.length - 1]!;
        if (Math.hypot(world.x - last.x, world.y - last.y) < 1.5 / view.zoom) return;
        gesture.current = {
          ...active,
          element: { ...element, points: [...element.points, world] },
        };
        break;
      }
      case "line":
      case "arrow":
        gesture.current = {
          ...active,
          element: { ...element, end: event.shiftKey ? snapAngle(active.origin, world) : world },
        };
        break;
      case "rect":
      case "ellipse":
      case "diamond": {
        let w = world.x - active.origin.x;
        let h = world.y - active.origin.y;
        if (event.shiftKey) {
          const side = Math.max(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * side;
          h = Math.sign(h || 1) * side;
        }
        gesture.current = { ...active, element: { ...element, w, h } };
        break;
      }
      case "text":
        break;
    }
    requestRedraw();
  };

  const onPointerUp = () => {
    const active = gesture.current;
    gesture.current = null;
    setPanning(false);
    if (!active) return;
    if (active.kind === "move") {
      if (active.moved) commit(elements, active.before);
      return;
    }
    if (active.kind === "marquee") {
      const area: Bounds = {
        minX: Math.min(active.origin.x, active.current.x),
        minY: Math.min(active.origin.y, active.current.y),
        maxX: Math.max(active.origin.x, active.current.x),
        maxY: Math.max(active.origin.y, active.current.y),
      };
      const picked = elements
        .filter((element) => boundsIntersect(elementBounds(element), area))
        .map((element) => element.id);
      setSelection(new Set(active.additive ? [...selection, ...picked] : picked));
      requestRedraw();
      return;
    }
    if (active.kind !== "draw") return;
    let element = active.element;
    if (element.kind === "rect" || element.kind === "ellipse" || element.kind === "diamond") {
      element = normalizeShape(element);
      if (element.w < 3 && element.h < 3) return requestRedraw();
    }
    if (
      (element.kind === "line" || element.kind === "arrow") &&
      Math.hypot(element.end.x - element.start.x, element.end.y - element.start.y) < 3
    ) {
      return requestRedraw();
    }
    commit([...elements, element]);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const hit = topElementAt(toWorld(event));
    if (hit?.kind === "text") openTextEditor({ x: hit.x, y: hit.y }, hit);
  };

  const zoomBy = (factor: number) => {
    const box = canvasRef.current?.getBoundingClientRect();
    const center = { x: (box?.width ?? 0) / 2, y: (box?.height ?? 0) / 2 };
    setView((current) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.zoom * factor));
      const worldX = (center.x - current.x) / current.zoom;
      const worldY = (center.y - current.y) / current.zoom;
      return { zoom, x: center.x - worldX * zoom, y: center.y - worldY * zoom };
    });
  };

  const fitToContent = () => {
    const box = canvasRef.current?.getBoundingClientRect();
    const bounds = elements.length > 0 ? elements.map(elementBounds) : [];
    if (!box || bounds.length === 0) {
      setView({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const minX = Math.min(...bounds.map((b) => b.minX));
    const minY = Math.min(...bounds.map((b) => b.minY));
    const maxX = Math.max(...bounds.map((b) => b.maxX));
    const maxY = Math.max(...bounds.map((b) => b.maxY));
    const zoom = Math.min(
      2,
      Math.max(
        MIN_ZOOM,
        Math.min((box.width - 48) / (maxX - minX), (box.height - 48) / (maxY - minY)),
      ),
    );
    setView({
      zoom,
      x: box.width / 2 - ((minX + maxX) / 2) * zoom,
      y: box.height / 2 - ((minY + maxY) / 2) * zoom,
    });
  };

  const clearAll = () => {
    if (elements.length === 0) return;
    commit([]);
    setSelection(new Set());
  };

  const send = async () => {
    if (sending || elements.length === 0) return;
    setSending(true);
    try {
      const blob = await exportSketchPng(elements, scene.current.background);
      if (!blob) return;
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const prepared = await prepareImageForAttachment(
        new File([blob], `sketch-${stamp}.png`, { type: "image/png" }),
        PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
      );
      if (!prepared.ok) {
        toastManager.add({ type: "error", title: "The sketch is too large to attach." });
        return;
      }
      const file = prepared.file;
      const attachment: ComposerImageAttachment = {
        type: "image",
        id: randomUUID(),
        name: file.name || `sketch-${stamp}.png`,
        mimeType: file.type,
        sizeBytes: file.size,
        previewUrl: URL.createObjectURL(file),
        file,
      };
      const stored = useComposerDraftStore.getState().addImages(origin.target, [attachment]);
      if (stored.length === 0) {
        URL.revokeObjectURL(attachment.previewUrl);
        toastManager.add({ type: "error", title: "Could not attach the sketch." });
        return;
      }
      toastManager.add({ type: "success", title: `Sketch added to ${origin.label}` });
      setHistory({ past: [], future: [] });
      setElements([]);
      setSelection(new Set());
      setView({ x: 0, y: 0, zoom: 1 });
      close();
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target)) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && key === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (mod && key === "enter") {
      event.preventDefault();
      void send();
      return;
    }
    if (mod && key === "a") {
      event.preventDefault();
      setTool("select");
      setSelection(new Set(elements.map((element) => element.id)));
      return;
    }
    if (mod && key === "c") {
      clipboard.current = elements.filter((element) => selection.has(element.id));
      return;
    }
    if (mod && (key === "v" || key === "d")) {
      const source = key === "d" ? elements.filter((e) => selection.has(e.id)) : clipboard.current;
      if (source.length === 0) return;
      event.preventDefault();
      const offset = 16 / view.zoom;
      const copies = source.map((element) => ({
        ...translateElement(element, offset, offset),
        id: randomUUID(),
      }));
      if (key === "v") clipboard.current = copies;
      commit([...elements, ...copies]);
      setSelection(new Set(copies.map((copy) => copy.id)));
      setTool("select");
      return;
    }
    if (mod && key === "0") {
      event.preventDefault();
      fitToContent();
      return;
    }
    if (mod) return;
    if ((key === "delete" || key === "backspace") && selection.size > 0) {
      event.preventDefault();
      commit(elements.filter((element) => !selection.has(element.id)));
      setSelection(new Set());
      return;
    }
    if (key.startsWith("arrow") && selection.size > 0) {
      event.preventDefault();
      const step = (event.shiftKey ? 10 : 1) / view.zoom;
      const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
      const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
      commit(
        elements.map((element) =>
          selection.has(element.id) ? translateElement(element, dx, dy) : element,
        ),
      );
      return;
    }
    if (key === "escape") {
      if (selection.size > 0) setSelection(new Set());
      else if (expanded) setExpanded(false);
      else close();
      return;
    }
    if (key === " ") {
      event.preventDefault();
      setSpaceHeld(true);
      return;
    }
    if (key === "+" || key === "=") return zoomBy(1.2);
    if (key === "-") return zoomBy(1 / 1.2);
    const picked = TOOLS.find((entry) => entry.key.toLowerCase() === key);
    if (picked) {
      setTool(picked.tool);
      if (picked.tool !== "select") setSelection(new Set());
      return;
    }
    const digit = Number.parseInt(key, 10);
    if (digit >= 1 && digit <= COLORS.length) {
      setColor(COLORS[digit - 1]!);
      applyStyleToSelection({ color: COLORS[digit - 1]! });
    }
  };

  const startWindowDrag = (event: ReactPointerEvent<HTMLDivElement>, mode: "move" | "resize") => {
    if (expanded || event.button !== 0) return;
    if (mode === "move" && (event.target as HTMLElement).closest("button,input,label")) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY, rect };
    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - start.x;
      const dy = move.clientY - start.y;
      const next: SketchWindowRect =
        mode === "move"
          ? {
              ...start.rect,
              x: Math.max(0, Math.min(window.innerWidth - 80, start.rect.x + dx)),
              y: Math.max(0, Math.min(window.innerHeight - 40, start.rect.y + dy)),
            }
          : {
              ...start.rect,
              width: Math.max(320, start.rect.width + dx),
              height: Math.max(240, start.rect.height + dy),
            };
      setRect(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const cursor =
    spaceHeld || tool === "hand"
      ? panning
        ? "grabbing"
        : "grab"
      : tool === "select"
        ? "default"
        : tool === "text"
          ? "text"
          : "crosshair";

  const editorScreen = textEditor
    ? {
        left: textEditor.world.x * view.zoom + view.x,
        top: textEditor.world.y * view.zoom + view.y,
      }
    : null;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      data-sketch-canvas=""
      data-expanded={expanded ? "" : undefined}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => {
        if (event.key === " ") setSpaceHeld(false);
      }}
      className={cn(
        "fixed z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl outline-none",
        expanded && "inset-6",
      )}
      style={
        expanded ? undefined : { left: rect.x, top: rect.y, width: rect.width, height: rect.height }
      }
    >
      <div
        className="flex shrink-0 cursor-grab items-center gap-1 border-b border-border px-2 py-1 active:cursor-grabbing"
        onPointerDown={(event) => startWindowDrag(event, "move")}
        onDoubleClick={() => setExpanded(!expanded)}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
          {TOOLS.map((entry) => (
            <Tip key={entry.tool} label={`${entry.label} (${entry.key})`}>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={entry.label}
                aria-pressed={tool === entry.tool}
                data-pressed={tool === entry.tool ? "" : undefined}
                onClick={() => {
                  setTool(entry.tool);
                  if (entry.tool !== "select") setSelection(new Set());
                  rootRef.current?.focus({ preventScroll: true });
                }}
              >
                {entry.icon}
              </Button>
            </Tip>
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          <Tip label="Undo (⌘Z)">
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Undo"
              disabled={history.past.length === 0}
              onClick={undo}
            >
              <Undo2Icon />
            </Button>
          </Tip>
          <Tip label="Redo (⇧⌘Z)">
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Redo"
              disabled={history.future.length === 0}
              onClick={redo}
            >
              <Redo2Icon />
            </Button>
          </Tip>
          <Tip label="Clear canvas">
            <Button
              type="button"
              size="icon-xs"
              variant="ghost-destructive"
              aria-label="Clear canvas"
              disabled={elements.length === 0}
              onClick={clearAll}
            >
              <Trash2Icon />
            </Button>
          </Tip>
        </div>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={expanded ? "Shrink canvas" : "Expand canvas"}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Hide canvas"
          onClick={close}
        >
          <XIcon />
        </Button>
      </div>

      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 size-full touch-none"
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
        />
        {textEditor && editorScreen ? (
          <textarea
            ref={(node) => node?.focus({ preventScroll: true })}
            value={textEditor.value}
            rows={Math.max(1, textEditor.value.split("\n").length)}
            onChange={(event) => setTextEditor({ ...textEditor, value: event.target.value })}
            onBlur={commitText}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") {
                setTextEditor(null);
                rootRef.current?.focus({ preventScroll: true });
              } else if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                commitText();
                rootRef.current?.focus({ preventScroll: true });
              }
            }}
            className="absolute resize-none overflow-hidden whitespace-pre border-none bg-transparent p-0 outline-none"
            style={{
              left: editorScreen.left,
              top: editorScreen.top,
              color: textEditor.color,
              font: textFont(textEditor.fontSize * view.zoom),
              lineHeight: 1.25,
              minWidth: 40,
              width: `${Math.max(2, ...textEditor.value.split("\n").map((line) => line.length + 1))}ch`,
            }}
          />
        ) : null}
        {elements.length === 0 && !textEditor ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-white/50">
            Draw here. Scroll to pan, ⌘ + scroll to zoom.
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border px-2 py-1.5">
        <div className="flex items-center gap-1">
          {COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Color ${swatch}`}
              onClick={() => {
                setColor(swatch);
                applyStyleToSelection({ color: swatch });
              }}
              className={cn(
                "size-4 rounded-full ring-offset-1 ring-offset-popover",
                color === swatch ? "ring-2 ring-primary" : "ring-1 ring-border",
              )}
              style={{ background: swatch }}
            />
          ))}
          <label
            className={cn(
              "relative size-4 cursor-pointer overflow-hidden rounded-full ring-offset-1 ring-offset-popover",
              COLORS.includes(color) ? "ring-1 ring-border" : "ring-2 ring-primary",
            )}
            style={{
              background: COLORS.includes(color)
                ? "conic-gradient(#f87171, #facc15, #4ade80, #22d3ee, #60a5fa, #c084fc, #f87171)"
                : color,
            }}
          >
            <input
              type="color"
              aria-label="Custom color"
              value={color}
              onChange={(event) => {
                setColor(event.target.value);
                applyStyleToSelection({ color: event.target.value });
              }}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
        </div>
        <span className="h-4 w-px bg-border" />
        <div className="flex items-center gap-0.5">
          {WIDTHS.map((entry) => (
            <Button
              key={entry.width}
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={`${entry.label} stroke`}
              aria-pressed={strokeWidth === entry.width}
              data-pressed={strokeWidth === entry.width ? "" : undefined}
              onClick={() => {
                setStrokeWidth(entry.width);
                applyStyleToSelection({ width: entry.width });
              }}
            >
              <span
                aria-hidden
                className="block w-3.5 rounded-full bg-current"
                style={{ height: Math.max(1.5, entry.width / 1.6) }}
              />
            </Button>
          ))}
        </div>
        <span className="h-4 w-px bg-border" />
        <Button type="button" size="compact" variant="ghost" onClick={fitToContent}>
          {Math.round(view.zoom * 100)}%
        </Button>
        <div className="ms-auto flex items-center gap-1.5">
          <span className="hidden max-w-40 truncate text-xs text-muted-foreground sm:inline">
            → {origin.label}
          </span>
          <Tip label="Add to chat (⌘↵)">
            <Button
              type="button"
              size="compact"
              disabled={elements.length === 0 || sending}
              onClick={() => void send()}
            >
              <CheckIcon />
              Add
            </Button>
          </Tip>
        </div>
      </div>
      {expanded ? null : (
        <div
          aria-hidden
          className="absolute right-0 bottom-0 size-3.5 cursor-nwse-resize"
          onPointerDown={(event) => startWindowDrag(event, "resize")}
        />
      )}
    </div>
  );
}
