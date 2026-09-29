import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import { projectRailStatuses } from "./projectRail.logic";

function thread(input: {
  id: string;
  projectId: string;
  archivedAt?: string;
  hasPendingApprovals?: boolean;
  hasPendingUserInput?: boolean;
  sessionStatus?: string;
}): EnvironmentThreadShell {
  return {
    environmentId: "local",
    id: ThreadId.make(input.id),
    projectId: ProjectId.make(input.projectId),
    title: input.id,
    archivedAt: input.archivedAt ?? null,
    hasPendingApprovals: input.hasPendingApprovals ?? false,
    hasPendingUserInput: input.hasPendingUserInput ?? false,
    session: input.sessionStatus ? { status: input.sessionStatus } : null,
    latestTurn: null,
  } as unknown as EnvironmentThreadShell;
}

describe("projectRailStatuses", () => {
  it("marks projects with a running session, a pending approval, or a question", () => {
    const keys = projectRailStatuses(
      [
        thread({ id: "a", projectId: "running", sessionStatus: "running" }),
        thread({ id: "b", projectId: "approval", hasPendingApprovals: true }),
        thread({ id: "c", projectId: "question", hasPendingUserInput: true }),
        thread({ id: "d", projectId: "quiet" }),
      ],
      {},
    );
    expect(keys.get("local:running")).toEqual({ running: true, completed: false, input: false });
    expect(keys.get("local:approval")?.input).toBe(true);
    expect(keys.get("local:question")?.input).toBe(true);
    expect(keys.get("local:quiet")).toEqual({ running: false, completed: false, input: false });
  });

  it("ignores archived threads, which the sidebar hides until asked", () => {
    const keys = projectRailStatuses(
      [
        thread({
          id: "e",
          projectId: "archived",
          hasPendingApprovals: true,
          archivedAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
      {},
    );
    expect(keys.size).toBe(0);
  });
});

it("keeps all three project signals and clears only completions that were read", () => {
  const completed = {
    ...thread({ id: "completed", projectId: "mixed" }),
    latestTurn: { completedAt: "2026-09-27T12:00:00.000Z" },
  } as EnvironmentThreadShell;
  const threads = [
    completed,
    thread({ id: "running", projectId: "mixed", sessionStatus: "running" }),
    thread({ id: "question", projectId: "mixed", hasPendingUserInput: true }),
    { ...completed, environmentId: EnvironmentId.make("remote") },
  ];
  const key = scopedThreadKey(scopeThreadRef(completed.environmentId, completed.id));
  expect(
    projectRailStatuses(threads, { [key]: "2026-09-27T11:00:00.000Z" }).get("local:mixed"),
  ).toEqual({ running: true, completed: true, input: true });
  expect(
    projectRailStatuses(threads, { [key]: "2026-09-27T13:00:00.000Z" }).get("local:mixed"),
  ).toEqual({ running: true, completed: false, input: true });
  expect(
    projectRailStatuses(threads, { [key]: "2026-09-27T11:00:00.000Z" }).get("remote:mixed")
      ?.completed,
  ).toBe(false);
});
