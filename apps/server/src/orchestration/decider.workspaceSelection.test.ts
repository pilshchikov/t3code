import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { decideOrchestrationCommand } from "./decider.ts";

const now = "2026-09-13T00:00:00.000Z";
const readModel: OrchestrationReadModel = {
  snapshotSequence: 0,
  projects: [],
  updatedAt: now,
  threads: [
    {
      id: ThreadId.make("thread"),
      projectId: ProjectId.make("project"),
      title: "Task",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "main",
      worktreePath: null,
      pullRequests: [],
      latestTurn: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    },
  ],
};
const command = {
  type: "thread.meta.update" as const,
  commandId: CommandId.make("workspace-select"),
  threadId: ThreadId.make("thread"),
  expectedBranch: "main",
  expectedWorktreePath: null,
  branch: "task",
  worktreePath: "/worktrees/task",
};

it.layer(NodeServices.layer)("atomic workspace selection", (it) => {
  it.effect("changes branch and checkout together when expectations match", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({ command, readModel });
      expect(result).toMatchObject({
        type: "thread.meta-updated",
        payload: { branch: "task", worktreePath: "/worktrees/task" },
      });
    }),
  );
  it.effect("rejects a stale branch without applying the new checkout", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: { ...command, expectedBranch: "old" },
        readModel,
      }).pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "OrchestrationCommandInvariantError" });
    }),
  );
  it.effect("rejects a stale path even if the branch name matches", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: { ...command, expectedWorktreePath: "/other" },
        readModel,
      }).pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "OrchestrationCommandInvariantError" });
    }),
  );
});
