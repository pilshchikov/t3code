import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  EventId,
  ProjectId,
  ThreadId,
  type OrchestrationV2DomainEvent,
  type ThreadEnvironmentSync,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  mapSyncedPath,
  transformImportedEvent,
  type ImportTransform,
} from "./EnvironmentSyncTransform.ts";

const threadId = ThreadId.make("thread:transform");
const now = DateTime.makeUnsafe("2026-10-12T10:00:00.000Z");
const localSync: ThreadEnvironmentSync = {
  origin: { environmentId: EnvironmentId.make("laptop"), label: "Laptop" },
  originWorkspacePath: "/Users/a/code/app",
  host: { environmentId: EnvironmentId.make("mini"), label: "Mini" },
  syncedAt: "2026-10-12T09:00:00.000Z",
  afterRunOrdinal: 1,
  staleNativeThreadIds: [],
  notes: [],
};
const transform: ImportTransform = {
  projectId: ProjectId.make("project:here"),
  mappings: [
    { from: "/Users/a/code/app", to: "/Users/b/work/app" },
    { from: "/Users/a/.t3/worktrees/app/feature-x", to: "/Users/b/.t3/worktrees/app/feature-x" },
  ],
  fallbackWorktreePath: (branch) => `/Users/b/.t3/worktrees/app/${branch}`,
  localEnvironmentSync: () => localSync,
};

const threadEvent = (payload: Record<string, unknown>) =>
  ({
    id: EventId.make("event:thread"),
    type: "thread.metadata-updated",
    threadId,
    occurredAt: now,
    payload: {
      id: threadId,
      projectId: ProjectId.make("project:there"),
      branch: "feature/x",
      worktreePath: null,
      ...payload,
    },
  }) as unknown as OrchestrationV2DomainEvent;

const threadPayload = (event: OrchestrationV2DomainEvent) =>
  event.payload as unknown as Record<string, unknown>;

it("maps a path by its longest synced prefix and leaves others alone", () => {
  assert.equal(
    mapSyncedPath("/Users/a/code/app/src/index.ts", transform.mappings),
    "/Users/b/work/app/src/index.ts",
  );
  assert.equal(mapSyncedPath("/Users/a/code/app", transform.mappings), "/Users/b/work/app");
  assert.isNull(mapSyncedPath("/Users/a/code/app-other", transform.mappings));
});

it("files an imported thread under the local project and its local checkout", () => {
  const exported = threadPayload(
    transformImportedEvent(
      threadEvent({
        worktreePath: "/Users/a/.t3/worktrees/app/feature-x",
        workspaceSelections: [{ workspaceRoot: "/Users/a/other", cwd: "/Users/a/other" }],
        environmentSync: { ...localSync, afterRunOrdinal: 99 },
      }),
      transform,
    ),
  );
  assert.equal(exported.projectId, "project:here");
  assert.equal(exported.worktreePath, "/Users/b/.t3/worktrees/app/feature-x");
  assert.isUndefined(exported.workspaceSelections);
  // The other host's record of its own imports does not replace this one's.
  assert.deepEqual(exported.environmentSync, localSync);

  const unknownWorktree = threadPayload(
    transformImportedEvent(threadEvent({ worktreePath: "/Users/a/elsewhere/tree" }), transform),
  );
  assert.equal(unknownWorktree.worktreePath, "/Users/b/.t3/worktrees/app/feature/x");
});

it("keeps pull request links but not their watches", () => {
  const imported = threadPayload(
    transformImportedEvent(
      threadEvent({
        pullRequests: [{ number: 7, url: "https://example.com/pr/7", watch: { since: "x" } }],
      }),
      transform,
    ),
  );
  assert.deepEqual(imported.pullRequests, [{ number: 7, url: "https://example.com/pr/7" }]);
});

it("records a provider session from another host as stopped", () => {
  const imported = transformImportedEvent(
    {
      id: EventId.make("event:session"),
      type: "provider-session.updated",
      threadId,
      occurredAt: now,
      payload: { status: "running", cwd: "/Users/a/code/app/packages/web" },
    } as unknown as OrchestrationV2DomainEvent,
    transform,
  );
  assert.deepInclude(imported.payload, {
    status: "stopped",
    cwd: "/Users/b/work/app/packages/web",
  });
});
