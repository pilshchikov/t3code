import { resolveTheme } from "@pierre/diffs";
import { describe, expect, it } from "vite-plus/test";
import {
  buildPatchCacheKey,
  getEditorSyntaxThemeLabel,
  resolveEditorDiffTheme,
} from "./diffRendering";

describe("buildPatchCacheKey", () => {
  it("returns a stable cache key for identical content", () => {
    const patch = "diff --git a/a.ts b/a.ts\n+console.log('hello')";

    expect(buildPatchCacheKey(patch)).toBe(buildPatchCacheKey(patch));
  });

  it("normalizes outer whitespace before hashing", () => {
    const patch = "diff --git a/a.ts b/a.ts\n+console.log('hello')";

    expect(buildPatchCacheKey(`\n${patch}\n`)).toBe(buildPatchCacheKey(patch));
  });

  it("changes when diff content changes", () => {
    const before = "diff --git a/a.ts b/a.ts\n+console.log('hello')";
    const after = "diff --git a/a.ts b/a.ts\n+console.log('hello world')";

    expect(buildPatchCacheKey(before)).not.toBe(buildPatchCacheKey(after));
  });

  it("changes when cache scope changes", () => {
    const patch = "diff --git a/a.ts b/a.ts\n+console.log('hello')";

    expect(buildPatchCacheKey(patch, "diff-panel:light")).not.toBe(
      buildPatchCacheKey(patch, "diff-panel:dark"),
    );
  });
});

describe("resolveEditorDiffTheme", () => {
  it("follows the app theme by default", () => {
    expect(resolveEditorDiffTheme("app", "light")).toEqual({
      themeName: "pierre-light",
      themeType: "light",
      background: "#ffffff",
      foreground: "#000000",
    });
    expect(resolveEditorDiffTheme("app", "dark")).toEqual({
      themeName: "pierre-dark",
      themeType: "dark",
      background: "#0a0a0a",
      foreground: "#ffffff",
    });
  });

  it("maps bundled dark editor themes", () => {
    expect(resolveEditorDiffTheme("github-dark-default", "light")).toEqual({
      themeName: "github-dark-default",
      themeType: "dark",
      background: "#0d1117",
      foreground: "#e6edf3",
    });
  });

  it("registers the JetBrains Dracula Night theme", async () => {
    const resolved = resolveEditorDiffTheme("jetbrains-dracula-night", "dark");
    const theme = await resolveTheme(resolved.themeName);

    expect(getEditorSyntaxThemeLabel("jetbrains-dracula-night")).toBe("JetBrains Dracula Night");
    expect(theme.name).toBe("t3-jetbrains-dracula-night");
    expect(theme.type).toBe("dark");
    expect(theme.bg).toBe("#0b0d12");
  });
});
