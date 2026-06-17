import { describe, expect, it } from "vite-plus/test";

import {
  formatFileCommentRange,
  normalizeFileCommentRange,
  remapFileCommentAnnotations,
} from "./fileCommentAnnotations";
import {
  isMarkdownPreviewFile,
  normalizeMarkdownPreviewMode,
  readMarkdownPreviewMode,
  setMarkdownTaskChecked,
  shouldRenderMarkdownPreview,
  writeMarkdownPreviewMode,
} from "./filePreviewMode";

describe("file comment annotations", () => {
  it("normalizes and formats selected line ranges", () => {
    expect(normalizeFileCommentRange({ start: 16, end: 7 })).toEqual({
      startLine: 7,
      endLine: 16,
    });
    expect(formatFileCommentRange(7, 7)).toBe("L7");
    expect(formatFileCommentRange(7, 16)).toBe("L7 to L16");
  });

  it("keeps an annotation range attached when Pierre remaps its anchor line", () => {
    expect(
      remapFileCommentAnnotations([
        {
          lineNumber: 20,
          metadata: {
            entries: [
              {
                id: "comment-1",
                kind: "comment",
                startLine: 7,
                endLine: 16,
                text: "Keep this guarded.",
              },
            ],
          },
        },
      ]),
    ).toEqual([
      {
        lineNumber: 20,
        metadata: {
          entries: [
            {
              id: "comment-1",
              kind: "comment",
              startLine: 11,
              endLine: 20,
              text: "Keep this guarded.",
            },
          ],
        },
      },
    ]);
  });
});

describe("isMarkdownPreviewFile", () => {
  it("recognizes markdown and MDX files case-insensitively", () => {
    expect(isMarkdownPreviewFile("README.md")).toBe(true);
    expect(isMarkdownPreviewFile("docs/guide.MDX")).toBe(true);
  });

  it("does not treat other text files as markdown", () => {
    expect(isMarkdownPreviewFile("docs/guide.txt")).toBe(false);
    expect(isMarkdownPreviewFile("docs/markdown.ts")).toBe(false);
  });
});

describe("markdown preview mode preference", () => {
  function storage(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial));
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
  }

  it("normalizes unknown values to source mode", () => {
    expect(normalizeMarkdownPreviewMode("rendered")).toBe("rendered");
    expect(normalizeMarkdownPreviewMode("source")).toBe("source");
    expect(normalizeMarkdownPreviewMode("path/to/README.md")).toBe("source");
    expect(normalizeMarkdownPreviewMode(null)).toBe("source");
  });

  it("reads and writes the global markdown preview mode", () => {
    const testStorage = storage();

    expect(readMarkdownPreviewMode(testStorage)).toBe("source");

    writeMarkdownPreviewMode("rendered", testStorage);
    expect(readMarkdownPreviewMode(testStorage)).toBe("rendered");

    writeMarkdownPreviewMode("source", testStorage);
    expect(readMarkdownPreviewMode(testStorage)).toBe("source");
  });

  it("applies rendered mode to every markdown path", () => {
    expect(shouldRenderMarkdownPreview("README.md", "rendered")).toBe(true);
    expect(shouldRenderMarkdownPreview("docs/new-file.mdx", "rendered")).toBe(true);
    expect(shouldRenderMarkdownPreview("README.md", "source")).toBe(false);
    expect(shouldRenderMarkdownPreview("src/main.ts", "rendered")).toBe(false);
    expect(shouldRenderMarkdownPreview(null, "rendered")).toBe(false);
  });
});

describe("setMarkdownTaskChecked", () => {
  const markdown = "- [ ] First\n- [x] Second\n";

  it("checks and unchecks the task marker at the supplied offset", () => {
    expect(setMarkdownTaskChecked(markdown, 2, true)).toBe("- [x] First\n- [x] Second\n");
    expect(setMarkdownTaskChecked(markdown, 14, false)).toBe("- [ ] First\n- [ ] Second\n");
    expect(setMarkdownTaskChecked("1. [X] Ordered\n", 3, false)).toBe("1. [ ] Ordered\n");
  });

  it("leaves the document unchanged for a stale or invalid marker offset", () => {
    expect(setMarkdownTaskChecked(markdown, 0, true)).toBe(markdown);
    expect(setMarkdownTaskChecked(markdown, 200, true)).toBe(markdown);
  });
});
