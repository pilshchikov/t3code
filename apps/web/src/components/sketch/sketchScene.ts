export interface Point {
  readonly x: number;
  readonly y: number;
}

interface ElementBase {
  readonly id: string;
  readonly color: string;
  readonly width: number;
}

export type ShapeKind = "rect" | "ellipse" | "diamond";
export type LineKind = "line" | "arrow";

export type SketchElement =
  | (ElementBase & { readonly kind: "stroke"; readonly points: readonly Point[] })
  | (ElementBase & { readonly kind: LineKind; readonly start: Point; readonly end: Point })
  | (ElementBase & {
      readonly kind: ShapeKind;
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    })
  | (ElementBase & {
      readonly kind: "text";
      readonly x: number;
      readonly y: number;
      readonly text: string;
      readonly fontSize: number;
    });

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface View {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

const SKETCH_BACKGROUND = "#0b0b0d";

export function sketchBackground(element: Element | null): string {
  const value = element
    ? getComputedStyle(element).getPropertyValue("--sketch-canvas-background").trim()
    : "";
  return value || SKETCH_BACKGROUND;
}
const FONT_FAMILY = "ui-sans-serif, system-ui, -apple-system, sans-serif";
const LINE_HEIGHT = 1.25;

let measureContext: CanvasRenderingContext2D | null = null;
function measure(): CanvasRenderingContext2D {
  measureContext ??= document.createElement("canvas").getContext("2d")!;
  return measureContext;
}

export function textFont(fontSize: number): string {
  return `500 ${fontSize}px ${FONT_FAMILY}`;
}

function textSize(element: Extract<SketchElement, { kind: "text" }>) {
  const ctx = measure();
  ctx.font = textFont(element.fontSize);
  const lines = element.text.split("\n");
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width), 4);
  return { width, height: lines.length * element.fontSize * LINE_HEIGHT };
}

export function textFontSizeFor(width: number): number {
  return width <= 2 ? 18 : width <= 4 ? 24 : 36;
}

export function elementBounds(element: SketchElement): Bounds {
  const pad = element.width / 2 + 1;
  switch (element.kind) {
    case "stroke": {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const point of element.points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
      return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
    }
    case "line":
    case "arrow": {
      const head = element.kind === "arrow" ? arrowHeadLength(element.width) : 0;
      const grow = pad + head;
      return {
        minX: Math.min(element.start.x, element.end.x) - grow,
        minY: Math.min(element.start.y, element.end.y) - grow,
        maxX: Math.max(element.start.x, element.end.x) + grow,
        maxY: Math.max(element.start.y, element.end.y) + grow,
      };
    }
    case "rect":
    case "ellipse":
    case "diamond":
      return {
        minX: element.x - pad,
        minY: element.y - pad,
        maxX: element.x + element.w + pad,
        maxY: element.y + element.h + pad,
      };
    case "text": {
      const size = textSize(element);
      return {
        minX: element.x - 2,
        minY: element.y - 2,
        maxX: element.x + size.width + 2,
        maxY: element.y + size.height + 2,
      };
    }
  }
}

function unionBounds(elements: readonly SketchElement[]): Bounds | null {
  if (elements.length === 0) return null;
  let result = elementBounds(elements[0]!);
  for (const element of elements.slice(1)) {
    const next = elementBounds(element);
    result = {
      minX: Math.min(result.minX, next.minX),
      minY: Math.min(result.minY, next.minY),
      maxX: Math.max(result.maxX, next.maxX),
      maxY: Math.max(result.maxY, next.maxY),
    };
  }
  return result;
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

export function hitTest(element: SketchElement, point: Point, tolerance: number): boolean {
  switch (element.kind) {
    case "stroke": {
      const reach = element.width / 2 + tolerance;
      if (element.points.length === 1) {
        const only = element.points[0]!;
        return Math.hypot(point.x - only.x, point.y - only.y) <= reach;
      }
      for (let index = 1; index < element.points.length; index += 1) {
        if (distanceToSegment(point, element.points[index - 1]!, element.points[index]!) <= reach)
          return true;
      }
      return false;
    }
    case "line":
    case "arrow":
      return distanceToSegment(point, element.start, element.end) <= element.width / 2 + tolerance;
    default: {
      const bounds = elementBounds(element);
      return (
        point.x >= bounds.minX - tolerance &&
        point.x <= bounds.maxX + tolerance &&
        point.y >= bounds.minY - tolerance &&
        point.y <= bounds.maxY + tolerance
      );
    }
  }
}

export function translateElement(element: SketchElement, dx: number, dy: number): SketchElement {
  switch (element.kind) {
    case "stroke":
      return { ...element, points: element.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    case "line":
    case "arrow":
      return {
        ...element,
        start: { x: element.start.x + dx, y: element.start.y + dy },
        end: { x: element.end.x + dx, y: element.end.y + dy },
      };
    default:
      return { ...element, x: element.x + dx, y: element.y + dy };
  }
}

export function normalizeShape<T extends { x: number; y: number; w: number; h: number }>(
  shape: T,
): T {
  return {
    ...shape,
    x: shape.w < 0 ? shape.x + shape.w : shape.x,
    y: shape.h < 0 ? shape.y + shape.h : shape.y,
    w: Math.abs(shape.w),
    h: Math.abs(shape.h),
  };
}

function arrowHeadLength(width: number): number {
  return Math.max(12, width * 4);
}

function smooth(points: readonly Point[]): Point[] {
  if (points.length < 3) return [...points];
  const result: Point[] = [points[0]!];
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]!;
    const b = points[index + 1]!;
    result.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
    result.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
  }
  result.push(points[points.length - 1]!);
  return result;
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  element: Extract<SketchElement, { kind: "stroke" }>,
) {
  const points = smooth(element.points);
  if (points.length === 1) {
    const only = points[0]!;
    ctx.beginPath();
    ctx.arc(only.x, only.y, element.width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    lengths.push(lengths[index - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = lengths[lengths.length - 1]!;
  const taper = Math.min(total * 0.2, 40);
  for (let index = 1; index < points.length; index += 1) {
    const at = lengths[index]!;
    const fromEdge = Math.min(at, total - at);
    const scale = taper === 0 ? 1 : Math.max(0.35, Math.min(1, fromEdge / taper));
    ctx.lineWidth = element.width * scale;
    ctx.beginPath();
    ctx.moveTo(points[index - 1]!.x, points[index - 1]!.y);
    ctx.lineTo(points[index]!.x, points[index]!.y);
    ctx.stroke();
  }
}

function drawArrowHead(ctx: CanvasRenderingContext2D, start: Point, end: Point, width: number) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const length = arrowHeadLength(width);
  ctx.beginPath();
  ctx.moveTo(
    end.x - length * Math.cos(angle - Math.PI / 7),
    end.y - length * Math.sin(angle - Math.PI / 7),
  );
  ctx.lineTo(end.x, end.y);
  ctx.lineTo(
    end.x - length * Math.cos(angle + Math.PI / 7),
    end.y - length * Math.sin(angle + Math.PI / 7),
  );
  ctx.stroke();
}

export function drawElement(ctx: CanvasRenderingContext2D, element: SketchElement) {
  ctx.strokeStyle = element.color;
  ctx.fillStyle = element.color;
  ctx.lineWidth = element.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (element.kind) {
    case "stroke":
      drawStroke(ctx, element);
      return;
    case "line":
    case "arrow":
      ctx.beginPath();
      ctx.moveTo(element.start.x, element.start.y);
      ctx.lineTo(element.end.x, element.end.y);
      ctx.stroke();
      if (element.kind === "arrow") drawArrowHead(ctx, element.start, element.end, element.width);
      return;
    case "rect": {
      const radius = Math.min(10, Math.abs(element.w) / 4, Math.abs(element.h) / 4);
      ctx.beginPath();
      ctx.roundRect(element.x, element.y, element.w, element.h, radius);
      ctx.stroke();
      return;
    }
    case "ellipse":
      ctx.beginPath();
      ctx.ellipse(
        element.x + element.w / 2,
        element.y + element.h / 2,
        Math.abs(element.w / 2),
        Math.abs(element.h / 2),
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      return;
    case "diamond": {
      const cx = element.x + element.w / 2;
      const cy = element.y + element.h / 2;
      ctx.beginPath();
      ctx.moveTo(cx, element.y);
      ctx.lineTo(element.x + element.w, cy);
      ctx.lineTo(cx, element.y + element.h);
      ctx.lineTo(element.x, cy);
      ctx.closePath();
      ctx.stroke();
      return;
    }
    case "text":
      ctx.font = textFont(element.fontSize);
      ctx.textBaseline = "top";
      element.text.split("\n").forEach((line, index) => {
        ctx.fillText(line, element.x, element.y + index * element.fontSize * LINE_HEIGHT);
      });
      return;
  }
}

const EXPORT_PADDING = 24;
const EXPORT_MAX_SIDE = 4096;

export async function exportSketchPng(
  elements: readonly SketchElement[],
  background: string,
): Promise<Blob | null> {
  const bounds = unionBounds(elements);
  if (!bounds) return null;
  const width = bounds.maxX - bounds.minX + EXPORT_PADDING * 2;
  const height = bounds.maxY - bounds.minY + EXPORT_PADDING * 2;
  const scale = Math.min(2, EXPORT_MAX_SIDE / width, EXPORT_MAX_SIDE / height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(
    scale,
    0,
    0,
    scale,
    (EXPORT_PADDING - bounds.minX) * scale,
    (EXPORT_PADDING - bounds.minY) * scale,
  );
  for (const element of elements) drawElement(ctx, element);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
