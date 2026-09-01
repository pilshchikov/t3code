import { describe, expect, it } from "vite-plus/test";

import { resolveFilePreviewRoots } from "./filePreviewRoots";

describe("resolveFilePreviewRoots", () => {
  it("replaces the primary project checkout with the thread worktree", () => {
    expect(
      resolveFilePreviewRoots("/worktrees/project/task", [
        { path: "/repos/project", label: "Primary directory", color: "blue" },
        { path: "/repos/services", label: "Services", color: "green" },
      ]),
    ).toEqual([
      { path: "/worktrees/project/task", label: "Primary directory", color: "blue" },
      { path: "/repos/services", label: "Services", color: "green" },
    ]);
  });

  it("keeps configured secondary roots when the primary checkout is already active", () => {
    expect(
      resolveFilePreviewRoots("/repos/project", [
        { path: "/repos/project", label: "Primary directory" },
        { path: "/repos/services", label: "Services" },
      ]),
    ).toEqual([
      { path: "/repos/project", label: "Primary directory" },
      { path: "/repos/services", label: "Services" },
    ]);
  });

  it("uses the active checkout when the project has no configured root list", () => {
    expect(resolveFilePreviewRoots("/repos/project", undefined)).toEqual([
      { path: "/repos/project", label: "Primary directory" },
    ]);
  });
});
