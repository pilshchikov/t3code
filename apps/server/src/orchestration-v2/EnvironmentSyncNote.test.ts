import { assert, it } from "@effect/vitest";
import { EnvironmentId, RunAttemptId, RunId, type ThreadEnvironmentSync } from "@t3tools/contracts";

import { hasStaleNativeSession, pendingEnvironmentSyncNote } from "./EnvironmentSyncNote.ts";

const environmentSync: ThreadEnvironmentSync = {
  origin: { environmentId: EnvironmentId.make("laptop"), label: "Laptop" },
  originWorkspacePath: "/Users/a/code/app",
  host: { environmentId: EnvironmentId.make("mini"), label: "Mini" },
  syncedAt: "2026-10-12T10:00:00.000Z",
  afterRunOrdinal: 2,
  staleNativeThreadIds: ["native-from-laptop"],
  notes: [],
};
const thread = { environmentSync };
const run = (ordinal: number) => ({ id: RunId.make(`run:${ordinal}`), ordinal });
const attempt = (ordinal: number) => ({
  id: RunAttemptId.make(`attempt:${ordinal}`),
  runId: RunId.make(`run:${ordinal}`),
});
const turn = (ordinal: number, status: "completed" | "failed") => ({
  runAttemptId: RunAttemptId.make(`attempt:${ordinal}`),
  status,
});
const base = { thread, isCompaction: false, cwd: "/Users/b/work/app" };

it("tells the agent about the move on the first turn after the thread arrived", () => {
  const note = pendingEnvironmentSyncNote({
    ...base,
    run: run(3),
    runs: [run(1), run(2), run(3)],
    attempts: [attempt(1), attempt(2), attempt(3)],
    providerTurns: [turn(1, "completed"), turn(2, "completed")],
  });
  assert.include(note, 'It ran on "Laptop" in /Users/a/code/app');
  assert.include(note, 'It now runs on "Mini" in /Users/b/work/app');
});

it("repeats the note until a turn completes here, then stops", () => {
  const afterFailedTurn = pendingEnvironmentSyncNote({
    ...base,
    run: run(4),
    runs: [run(3), run(4)],
    attempts: [attempt(3), attempt(4)],
    providerTurns: [turn(3, "failed")],
  });
  assert.notEqual(afterFailedTurn, "");
  const afterCompletedTurn = pendingEnvironmentSyncNote({
    ...base,
    run: run(4),
    runs: [run(3), run(4)],
    attempts: [attempt(3), attempt(4)],
    providerTurns: [turn(3, "completed")],
  });
  assert.equal(afterCompletedTurn, "");
});

it("stays silent for compactions and for threads that never moved", () => {
  const input = {
    run: run(3),
    runs: [run(3)],
    attempts: [attempt(3)],
    providerTurns: [],
    cwd: null,
  };
  assert.equal(pendingEnvironmentSyncNote({ ...input, thread, isCompaction: true }), "");
  assert.equal(pendingEnvironmentSyncNote({ ...input, thread: {}, isCompaction: false }), "");
});

it("treats only sessions created on the other host as stale", () => {
  const ref = (nativeId: string) => ({
    nativeThreadRef: { driver: "codex" as never, nativeId, strength: "strong" as const },
  });
  assert.isTrue(hasStaleNativeSession(thread, ref("native-from-laptop")));
  assert.isFalse(hasStaleNativeSession(thread, ref("native-from-mini")));
  assert.isFalse(hasStaleNativeSession(thread, { nativeThreadRef: null }));
  assert.isFalse(hasStaleNativeSession({}, ref("native-from-laptop")));
});
