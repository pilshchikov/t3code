import type { ScopedThreadRef } from "@t3tools/contracts";
import { ProjectReadFileError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  formatFileCommentRange,
  normalizeFileCommentRange,
  remapFileCommentAnnotations,
} from "./fileCommentAnnotations";
import {
  filePreviewReadErrorMessage,
  isMarkdownPreviewFile,
  normalizeMarkdownPreviewMode,
  readMarkdownPreviewMode,
  resolveFilePreviewPath,
  setMarkdownTaskChecked,
  shouldRenderMarkdownPreview,
  shouldShowFileExplorer,
  writeMarkdownPreviewMode,
  workspaceAssetResource,
} from "./filePreviewMode";

const decodeReadError = Schema.decodeSync(ProjectReadFileError);

describe("file preview read errors", () => {
  it.each([
    ["path_not_file", "The path is a directory or special file, not a regular file."],
    ["binary_file", "The file is binary and cannot be displayed as text."],
    ["workspace_path_outside_root", "The requested path is outside the workspace."],
    ["resolved_path_outside_root", "The path resolves to a location outside the workspace."],
    [
      "operation_failed",
      "The file could not be accessed or read. It may be missing or inaccessible.",
    ],
  ] as const)("describes %s without revealing the platform cause", (failure, message) => {
    const error = new ProjectReadFileError({
      cwd: "/workspace",
      relativePath: "workspace/outline.md",
      failure,
      operation: "realpath-target",
      resolvedPath: "/workspace/workspace/outline.md",
      cause: new Error("EACCES: sensitive platform detail"),
    });
    expect(filePreviewReadErrorMessage(error)).toBe(message);
  });

  it("distinguishes an inaccessible workspace from an inaccessible file", () => {
    const error = new ProjectReadFileError({
      cwd: "/workspace",
      relativePath: "outline.md",
      failure: "operation_failed",
      operation: "realpath-workspace-root",
      operationPath: "/workspace",
    });
    expect(filePreviewReadErrorMessage(error)).toBe("The workspace folder could not be accessed.");
  });

  it("preserves the public message from older servers", () => {
    const error = decodeReadError({
      _tag: "ProjectReadFileError",
      message: "Legacy file read failure.",
    });
    expect(filePreviewReadErrorMessage(error)).toBe("Legacy file read failure.");
  });
});

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

describe("resolveFilePreviewPath", () => {
  it.each([
    ["/repo/project", null],
    ["/repo/project/", null],
    [".", null],
    [null, null],
    ["/repo/project/src", "/repo/project/src"],
    ["/repo/project/src/main.ts", "/repo/project/src/main.ts"],
    ["src/main.ts", "src/main.ts"],
    ["/repo/project-other", "/repo/project-other"],
    ["../other-worktree/report.md", "/repo/other-worktree/report.md"],
    ["./src/main.ts", "src/main.ts"],
    ["file:///tmp/report.md", "/tmp/report.md"],
    ["/tmp/report.md", "/tmp/report.md"],
  ])("opens %s in the appropriate workspace surface", (path, expected) => {
    const relativePath = resolveFilePreviewPath(path, "/repo/project");
    expect(relativePath).toBe(expected);
    if (expected === null) {
      expect(
        shouldShowFileExplorer({ relativePath, explorerOpen: false, attachmentOpen: false }),
      ).toBe(true);
    }
  });
});

describe("workspaceAssetResource", () => {
  const input = {
    kind: "workspace-file" as const,
    threadRef: {
      environmentId: "env" as ScopedThreadRef["environmentId"],
      threadId: "thread-1" as ScopedThreadRef["threadId"],
    },
    workspaceRoot: "/repo",
    absolutePath: "/repo/docs/index.html",
  };

  it("keeps the selected workspace root after the server knows the thread", () => {
    expect(workspaceAssetResource({ ...input, draft: false })).toEqual({
      _tag: "draft-workspace-file",
      cwd: "/repo",
      path: "/repo/docs/index.html",
    });
  });

  it("names the workspace root for a draft, which the server cannot resolve from a thread", () => {
    expect(workspaceAssetResource({ ...input, draft: true })).toEqual({
      _tag: "draft-workspace-file",
      cwd: "/repo",
      path: "/repo/docs/index.html",
    });
  });
});
