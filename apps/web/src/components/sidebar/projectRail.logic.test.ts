import { describe, expect, it } from "vite-plus/test";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import { projectKeysWithLiveWork } from "./projectRail.logic";

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

describe("projectKeysWithLiveWork", () => {
  it("marks projects with a running session, a pending approval, or a question", () => {
    const keys = projectKeysWithLiveWork([
      thread({ id: "a", projectId: "running", sessionStatus: "running" }),
      thread({ id: "b", projectId: "approval", hasPendingApprovals: true }),
      thread({ id: "c", projectId: "question", hasPendingUserInput: true }),
      thread({ id: "d", projectId: "quiet" }),
    ]);
    expect([...keys].sort()).toEqual(["local:approval", "local:question", "local:running"]);
  });

  it("ignores archived threads, which the sidebar hides until asked", () => {
    const keys = projectKeysWithLiveWork([
      thread({
        id: "e",
        projectId: "archived",
        hasPendingApprovals: true,
        archivedAt: "2026-01-01T00:00:00.000Z",
      }),
    ]);
    expect(keys.size).toBe(0);
  });
});
