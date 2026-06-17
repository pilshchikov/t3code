import { describe, expect, it } from "vite-plus/test";

import {
  directChildProjectEntries,
  fileBreadcrumbs,
  firstFileInDirectory,
  parentDirectoryPath,
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
    expect(fileBreadcrumbs("workspace", "/src//index.ts").map((crumb) => crumb.label)).toEqual([
      "workspace",
      "src",
      "index.ts",
    ]);
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
