import { describe, expect, it } from "vite-plus/test";

import {
  directChildProjectEntries,
  fileBreadcrumbChildren,
  fileBreadcrumbParent,
  fileBreadcrumbs,
  firstFileInDirectory,
  parentDirectoryPath,
  workspaceDocumentDirectory,
} from "./filePath";

describe("fileBreadcrumbs", () => {
  it("builds project, directory, and file crumbs", () => {
    expect(fileBreadcrumbs("t3code", "apps/web/src/main.tsx")).toEqual([
      { label: "t3code", path: "", kind: "project" },
      { label: "apps", path: "apps", kind: "directory" },
      { label: "web", path: "apps/web", kind: "directory" },
      { label: "src", path: "apps/web/src", kind: "directory" },
      { label: "main.tsx", path: "apps/web/src/main.tsx", kind: "file" },
    ]);
  });

  it("normalizes repeated separators", () => {
    expect(fileBreadcrumbs("workspace", "src//index.ts").map((crumb) => crumb.label)).toEqual([
      "workspace",
      "src",
      "index.ts",
    ]);
  });

  it("starts host paths outside the workspace at the filesystem root", () => {
    expect(fileBreadcrumbs("t3code", "/tmp/t3-cleanup/report.md")).toEqual([
      { label: "tmp", path: "/tmp", kind: "directory" },
      { label: "t3-cleanup", path: "/tmp/t3-cleanup", kind: "directory" },
      { label: "report.md", path: "/tmp/t3-cleanup/report.md", kind: "file" },
    ]);
    expect(fileBreadcrumbs("t3code", "C:\\Temp\\report.md")).toEqual([
      { label: "C:", path: "C:", kind: "directory" },
      { label: "Temp", path: "C:\\Temp", kind: "directory" },
      { label: "report.md", path: "C:\\Temp\\report.md", kind: "file" },
    ]);
    expect(fileBreadcrumbs("t3code", "\\\\server\\share\\report.md").map((c) => c.path)).toEqual([
      "\\\\server",
      "\\\\server\\share",
      "\\\\server\\share\\report.md",
    ]);
  });
});

describe("fileBreadcrumbChildren", () => {
  const entries = [
    { path: "README.md", kind: "file" as const },
    { path: "src", kind: "directory" as const },
    { path: "src-old", kind: "directory" as const },
    { path: "src/index.ts", kind: "file" as const },
    { path: "src/lib", kind: "directory" as const },
    { path: "src/lib/file10.ts", kind: "file" as const },
    { path: "src/lib/file2.ts", kind: "file" as const },
    { path: "src-old/index.ts", kind: "file" as const },
  ];

  it("returns only the immediate children of the project root", () => {
    expect(fileBreadcrumbChildren(entries, "")).toEqual([
      { path: "src", kind: "directory", label: "src" },
      { path: "src-old", kind: "directory", label: "src-old" },
      { path: "README.md", kind: "file", label: "README.md" },
    ]);
  });

  it("honors segment boundaries and sorts folders before files", () => {
    expect(fileBreadcrumbChildren(entries, "src")).toEqual([
      { path: "src/lib", kind: "directory", label: "lib" },
      { path: "src/index.ts", kind: "file", label: "index.ts" },
    ]);
  });

  it("uses natural file-name ordering", () => {
    expect(fileBreadcrumbChildren(entries, "src/lib").map((entry) => entry.label)).toEqual([
      "file2.ts",
      "file10.ts",
    ]);
  });

  it("returns an empty list for an empty or missing directory", () => {
    expect(fileBreadcrumbChildren(entries, "missing")).toEqual([]);
  });
});

describe("fileBreadcrumbParent", () => {
  it.each([
    ["src/lib", "src"],
    ["src", ""],
    ["", null],
  ])("returns the parent of %j", (path, expected) => {
    expect(fileBreadcrumbParent(path)).toBe(expected);
  });
});

describe("project file navigation helpers", () => {
  const entries = [
    { path: "README.md", kind: "file" },
    { path: "apps", kind: "directory" },
    { path: "apps/web", kind: "directory" },
    { path: "apps/web/package.json", kind: "file" },
    { path: "apps/web/src", kind: "directory" },
    { path: "apps/web/src/main.tsx", kind: "file" },
    { path: "apps/web/src/router.ts", kind: "file" },
    { path: "packages", kind: "directory" },
    { path: "packages/shared", kind: "directory" },
    { path: "packages/shared/src", kind: "directory" },
    { path: "packages/shared/src/index.ts", kind: "file" },
  ] as const;

  it("resolves the parent directory path for a file", () => {
    expect(parentDirectoryPath("apps/web/src/main.tsx")).toBe("apps/web/src");
    expect(parentDirectoryPath("README.md")).toBe("");
  });

  it("resolves the directory containing a workspace document", () => {
    expect(workspaceDocumentDirectory("/Users/example/project", "docs/index.md")).toBe(
      "/Users/example/project/docs",
    );
    expect(workspaceDocumentDirectory("/Users/example/project/", "README.md")).toBe(
      "/Users/example/project",
    );
    expect(workspaceDocumentDirectory("C:\\work\\project", "docs/index.md")).toBe(
      "C:\\work\\project\\docs",
    );
  });

  it("returns only direct children of a directory, with directories first", () => {
    expect(directChildProjectEntries(entries, "apps/web")).toEqual([
      { path: "apps/web/src", kind: "directory" },
      { path: "apps/web/package.json", kind: "file" },
    ]);
    expect(directChildProjectEntries(entries, "")).toEqual([
      { path: "apps", kind: "directory" },
      { path: "packages", kind: "directory" },
      { path: "README.md", kind: "file" },
    ]);
  });

  it("finds the first file under a directory", () => {
    expect(firstFileInDirectory(entries, "apps/web/src")).toBe("apps/web/src/main.tsx");
    expect(firstFileInDirectory(entries, "packages")).toBe("packages/shared/src/index.ts");
    expect(firstFileInDirectory(entries, "missing")).toBeNull();
  });
});
