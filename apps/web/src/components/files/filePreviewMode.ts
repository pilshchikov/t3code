export const isMarkdownPreviewFile = (path: string): boolean => /\.(?:md|mdx)$/i.test(path);

export type MarkdownPreviewMode = "source" | "rendered";

const MARKDOWN_PREVIEW_MODE_STORAGE_KEY = "t3code.markdownPreviewMode";

interface MarkdownPreviewModeStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export function normalizeMarkdownPreviewMode(
  value: string | null | undefined,
): MarkdownPreviewMode {
  return value === "rendered" ? "rendered" : "source";
}

export function readMarkdownPreviewMode(
  storage: MarkdownPreviewModeStorage | undefined = typeof window === "undefined"
    ? undefined
    : window.localStorage,
): MarkdownPreviewMode {
  try {
    return normalizeMarkdownPreviewMode(storage?.getItem(MARKDOWN_PREVIEW_MODE_STORAGE_KEY));
  } catch {
    return "source";
  }
}

export function writeMarkdownPreviewMode(
  mode: MarkdownPreviewMode,
  storage: MarkdownPreviewModeStorage | undefined = typeof window === "undefined"
    ? undefined
    : window.localStorage,
): void {
  try {
    storage?.setItem(MARKDOWN_PREVIEW_MODE_STORAGE_KEY, mode);
  } catch {}
}

export function shouldRenderMarkdownPreview(
  path: string | null | undefined,
  mode: MarkdownPreviewMode,
): boolean {
  return Boolean(path && isMarkdownPreviewFile(path) && mode === "rendered");
}

export function setMarkdownTaskChecked(
  markdown: string,
  markerOffset: number,
  checked: boolean,
): string {
  if (
    markerOffset < 0 ||
    markdown[markerOffset] !== "[" ||
    !/[ xX]/.test(markdown[markerOffset + 1] ?? "") ||
    markdown[markerOffset + 2] !== "]"
  ) {
    return markdown;
  }

  return `${markdown.slice(0, markerOffset + 1)}${checked ? "x" : " "}${markdown.slice(markerOffset + 2)}`;
}
