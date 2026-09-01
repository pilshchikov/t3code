import { describe, expect, it } from "vite-plus/test";

import { resolveFilePreviewRoots, resolveFileWorktreeOptions } from "./filePreviewRoots";

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

describe("resolveFileWorktreeOptions", () => {
  it("lists live worktrees by newest commit", () => {
    expect(
      resolveFileWorktreeOptions("/worktrees/project/task-b", [
        {
          name: "main",
          current: false,
          worktreePath: "/repos/project",
          lastCommitAt: 200,
        },
        {
          name: "feature/task-a",
          current: false,
          worktreePath: "/worktrees/project/task-a",
          lastCommitAt: 300,
        },
        {
          name: "feature/task-b",
          current: true,
          worktreePath: "/worktrees/project/task-b",
          lastCommitAt: 100,
        },
        {
          name: "origin/main",
          current: false,
          worktreePath: null,
          lastCommitAt: 400,
        },
      ]),
    ).toEqual([
      {
        path: "/worktrees/project/task-a",
        refName: "feature/task-a",
        current: false,
        lastCommitAt: 300,
      },
      { path: "/repos/project", refName: "main", current: false, lastCommitAt: 200 },
      {
        path: "/worktrees/project/task-b",
        refName: "feature/task-b",
        current: true,
        lastCommitAt: 100,
      },
    ]);
  });

  it("keeps a standalone active checkout available", () => {
    expect(resolveFileWorktreeOptions("/multiwork/project-copy/", [])).toEqual([
      {
        path: "/multiwork/project-copy/",
        refName: null,
        current: true,
        lastCommitAt: null,
      },
    ]);
  });

  it("deduplicates equivalent paths with trailing separators", () => {
    expect(
      resolveFileWorktreeOptions("/repos/project/", [
        {
          name: "main",
          current: true,
          worktreePath: "/repos/project",
          lastCommitAt: 100,
        },
      ]),
    ).toEqual([
      {
        path: "/repos/project",
        refName: "main",
        current: true,
        lastCommitAt: 100,
      },
    ]);
  });
});
