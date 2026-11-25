import { describe, expect, it } from "vite-plus/test";

import {
  resolveThreadWorkspaces,
  threadWorkspaceInstructions,
} from "@t3tools/shared/threadWorkspaces";
import { resolveFileWorktreeOptions } from "./filePreviewRoots";

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

describe("per-repository thread selections", () => {
  const project = {
    workspaceRoot: "/frontend",
    trackedFolders: [
      { path: "/backend", name: "Backend" },
      { path: "/tools", name: "tools" },
    ],
    folderSettings: [{ path: "/backend", color: "green" as const }],
  };
  it("uses configured identities independently of the selected checkout", () => {
    const roots = resolveThreadWorkspaces(project, {
      worktreePath: "/worktrees/frontend",
      branch: "ui",
      workspaceSelections: [
        { workspaceRoot: "/backend", cwd: "/worktrees/backend", branch: "api" },
        { workspaceRoot: "/unconfigured", cwd: "/elsewhere", branch: "bad" },
      ],
    });
    expect(roots.map((r) => [r.workspaceRoot, r.path, r.branch, r.primary])).toEqual([
      ["/frontend", "/worktrees/frontend", "ui", true],
      ["/backend", "/worktrees/backend", "api", false],
      ["/tools", "/tools", null, false],
    ]);
    expect(roots[1]?.color).toBe("green");
    expect(threadWorkspaceInstructions(roots, true)).toContain("thread_workspace_select");
    expect(threadWorkspaceInstructions(roots, true)).toContain(
      "selected cwd /worktrees/backend; branch api",
    );
  });
  it("lets repositories in the thread's task folder follow the thread", () => {
    const roots = resolveThreadWorkspaces(
      project,
      {
        worktreePath: "/tasks/feature/frontend",
        branch: "feature",
        workspaceSelections: [
          { workspaceRoot: "/backend", cwd: "/worktrees/backend", branch: "api" },
        ],
      },
      {
        repositories: [
          {
            repositoryPath: "/backend",
            worktreePath: "/tasks/feature/backend",
            name: "backend",
          },
        ],
      },
    );
    expect(roots.map((r) => [r.workspaceRoot, r.path, r.branch, r.followsTaskFolder])).toEqual([
      ["/frontend", "/tasks/feature/frontend", "feature", false],
      ["/backend", "/tasks/feature/backend", "feature", true],
      ["/tools", "/tools", null, false],
    ]);
    expect(threadWorkspaceInstructions(roots, false)).toBe("");
  });
});
