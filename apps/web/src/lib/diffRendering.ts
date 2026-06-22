import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import {
  registerCustomTheme,
  resolveTheme,
  type DiffsThemeNames,
  type FileDiffMetadata,
  type ThemeRegistration,
} from "@pierre/diffs";
import type { EditorSyntaxTheme } from "@t3tools/contracts/settings";

export const DIFF_THEME_NAMES = {
  light: "pierre-light",
  dark: "pierre-dark",
} as const;

const JETBRAINS_DRACULA_NIGHT_THEME_NAME = "t3-jetbrains-dracula-night";
const JETBRAINS_DRACULA_NIGHT_BG = "#0b0d12";
const JETBRAINS_DRACULA_NIGHT_FG = "#f4f4ee";

export const EDITOR_SYNTAX_THEME_OPTIONS: ReadonlyArray<{
  value: EditorSyntaxTheme;
  label: string;
}> = [
  { value: "app", label: "Follow app" },
  { value: "jetbrains-dracula-night", label: "JetBrains Dracula Night" },
  { value: "dracula", label: "Dracula" },
  { value: "dark-plus", label: "Dark+" },
  { value: "github-dark-default", label: "GitHub Dark" },
  { value: "tokyo-night", label: "Tokyo Night" },
  { value: "catppuccin-mocha", label: "Catppuccin Mocha" },
  { value: "vesper", label: "Vesper" },
];

const EDITOR_SYNTAX_THEME_NAMES = {
  "jetbrains-dracula-night": JETBRAINS_DRACULA_NIGHT_THEME_NAME,
  dracula: "dracula",
  "dark-plus": "dark-plus",
  "github-dark-default": "github-dark-default",
  "tokyo-night": "tokyo-night",
  "catppuccin-mocha": "catppuccin-mocha",
  vesper: "vesper",
} satisfies Record<Exclude<EditorSyntaxTheme, "app">, DiffsThemeNames>;

const EDITOR_SYNTAX_THEME_SURFACES = {
  "jetbrains-dracula-night": {
    background: JETBRAINS_DRACULA_NIGHT_BG,
    foreground: JETBRAINS_DRACULA_NIGHT_FG,
  },
  dracula: { background: "#282a36", foreground: "#f8f8f2" },
  "dark-plus": { background: "#1e1e1e", foreground: "#d4d4d4" },
  "github-dark-default": { background: "#0d1117", foreground: "#e6edf3" },
  "tokyo-night": { background: "#1a1b26", foreground: "#c0caf5" },
  "catppuccin-mocha": { background: "#1e1e2e", foreground: "#cdd6f4" },
  vesper: { background: "#101010", foreground: "#ffffff" },
} satisfies Record<Exclude<EditorSyntaxTheme, "app">, { background: string; foreground: string }>;

let customEditorThemesRegistered = false;

function ensureCustomEditorThemesRegistered() {
  if (customEditorThemesRegistered) return;
  customEditorThemesRegistered = true;

  registerCustomTheme(JETBRAINS_DRACULA_NIGHT_THEME_NAME, async () => {
    const dracula = await resolveTheme("dracula");
    const settings = dracula.settings.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            settings: {
              ...entry.settings,
              background: JETBRAINS_DRACULA_NIGHT_BG,
              foreground: JETBRAINS_DRACULA_NIGHT_FG,
            },
          }
        : entry,
    );

    return {
      ...dracula,
      name: JETBRAINS_DRACULA_NIGHT_THEME_NAME,
      displayName: "JetBrains Dracula Night",
      bg: JETBRAINS_DRACULA_NIGHT_BG,
      fg: JETBRAINS_DRACULA_NIGHT_FG,
      colors: {
        ...dracula.colors,
        "editor.background": JETBRAINS_DRACULA_NIGHT_BG,
        "editor.foreground": JETBRAINS_DRACULA_NIGHT_FG,
        "editor.lineHighlightBackground": "#151925",
        "editor.selectionBackground": "#304057",
        "editor.inactiveSelectionBackground": "#253044",
        "editorCursor.foreground": "#bbbbbb",
        "editorLineNumber.foreground": "#596274",
        "editorLineNumber.activeForeground": "#aeb7c4",
        "gitDecoration.addedResourceForeground": "#50fa7b",
        "gitDecoration.deletedResourceForeground": "#ff5555",
        "gitDecoration.modifiedResourceForeground": "#8be9fd",
        "terminal.ansiGreen": "#50fa7b",
        "terminal.ansiRed": "#ff5555",
        "terminal.ansiBlue": "#8be9fd",
      },
      settings,
      type: "dark",
    } satisfies ThemeRegistration;
  });
}

export type DiffThemeName = DiffsThemeNames;

export interface ResolvedEditorDiffTheme {
  readonly themeName: DiffThemeName;
  readonly themeType: "light" | "dark";
  readonly background: string;
  readonly foreground: string;
}

export function resolveDiffThemeName(theme: "light" | "dark"): DiffThemeName {
  return theme === "dark" ? DIFF_THEME_NAMES.dark : DIFF_THEME_NAMES.light;
}

export function resolveEditorDiffTheme(
  editorSyntaxTheme: EditorSyntaxTheme,
  appResolvedTheme: "light" | "dark",
): ResolvedEditorDiffTheme {
  ensureCustomEditorThemesRegistered();
  if (editorSyntaxTheme === "app") {
    return {
      themeName: resolveDiffThemeName(appResolvedTheme),
      themeType: appResolvedTheme,
      background: appResolvedTheme === "dark" ? "#0a0a0a" : "#ffffff",
      foreground: appResolvedTheme === "dark" ? "#ffffff" : "#000000",
    };
  }

  const surface = EDITOR_SYNTAX_THEME_SURFACES[editorSyntaxTheme];
  return {
    themeName: EDITOR_SYNTAX_THEME_NAMES[editorSyntaxTheme],
    themeType: "dark",
    background: surface.background,
    foreground: surface.foreground,
  };
}

export function getEditorSyntaxThemeLabel(theme: EditorSyntaxTheme): string {
  return (
    EDITOR_SYNTAX_THEME_OPTIONS.find((option) => option.value === theme)?.label ?? "Follow app"
  );
}

const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;
const SECONDARY_HASH_SEED = 0x9e3779b9;
const SECONDARY_HASH_MULTIPLIER = 0x85ebca6b;

export function fnv1a32(
  input: string,
  seed = FNV_OFFSET_BASIS_32,
  multiplier = FNV_PRIME_32,
): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, multiplier) >>> 0;
  }
  return hash >>> 0;
}

export function buildPatchCacheKey(patch: string, scope = "diff-panel"): string {
  const normalizedPatch = patch.trim();
  const primary = fnv1a32(normalizedPatch, FNV_OFFSET_BASIS_32, FNV_PRIME_32).toString(36);
  const secondary = fnv1a32(
    normalizedPatch,
    SECONDARY_HASH_SEED,
    SECONDARY_HASH_MULTIPLIER,
  ).toString(36);
  return `${scope}:${normalizedPatch.length}:${primary}:${secondary}`;
}

export type RenderablePatch =
  | {
      kind: "files";
      files: FileDiffMetadata[];
    }
  | {
      kind: "raw";
      text: string;
      reason: string;
    };

interface RenderablePatchOptions {
  /**
   * Pierre's partial-patch parser keeps hunk render starts in source-file
   * coordinates. Its virtualizer iterates partial patches as compact rows, so
   * review diffs need compact render starts while retaining collapsedBefore
   * for the "N unmodified lines" separator.
   */
  compactPartialHunkOffsets?: boolean;
}

export function compactPartialHunkOffsets(file: FileDiffMetadata): FileDiffMetadata {
  if (!file.isPartial) return file;

  let splitLineStart = 0;
  let unifiedLineStart = 0;
  const hunks = file.hunks.map((hunk) => {
    const compactHunk = {
      ...hunk,
      splitLineStart,
      unifiedLineStart,
    };
    splitLineStart += hunk.splitLineCount;
    unifiedLineStart += hunk.unifiedLineCount;
    return compactHunk;
  });

  return {
    ...file,
    hunks,
    splitLineCount: splitLineStart,
    unifiedLineCount: unifiedLineStart,
    ...(file.cacheKey ? { cacheKey: `${file.cacheKey}:compact-partial` } : {}),
  };
}

export function getRenderablePatch(
  patch: string | undefined,
  cacheScope = "diff-panel",
  options: RenderablePatchOptions = {},
): RenderablePatch | null {
  if (!patch) return null;
  const normalizedPatch = patch.trim();
  if (normalizedPatch.length === 0) return null;

  try {
    const parsedPatches = parsePatchFiles(
      normalizedPatch,
      buildPatchCacheKey(normalizedPatch, cacheScope),
    );
    const files = parsedPatches.flatMap((parsedPatch) =>
      options.compactPartialHunkOffsets
        ? parsedPatch.files.map(compactPartialHunkOffsets)
        : parsedPatch.files,
    );
    if (files.length > 0) {
      return { kind: "files", files };
    }

    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Unsupported diff format. Showing raw patch.",
    };
  } catch {
    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Failed to parse patch. Showing raw patch.",
    };
  }
}

export function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? "";
  if (raw.startsWith("a/") || raw.startsWith("b/")) {
    return raw.slice(2);
  }
  return raw;
}

export function buildFileDiffRenderKey(fileDiff: FileDiffMetadata): string {
  return fileDiff.cacheKey ?? `${fileDiff.prevName ?? "none"}:${fileDiff.name}`;
}

export function getDiffCollapseIconClassName(fileDiff: FileDiffMetadata): string {
  switch (fileDiff.type) {
    case "new":
      return "text-[var(--diffs-addition-base)]";
    case "deleted":
      return "text-[var(--diffs-deletion-base)]";
    case "change":
    case "rename-pure":
    case "rename-changed":
      return "text-[var(--diffs-modified-base)]";
    default:
      return "text-muted-foreground/80";
  }
}
