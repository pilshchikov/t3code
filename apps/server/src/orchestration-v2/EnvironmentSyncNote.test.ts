import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { pendingEnvironmentSyncNote, writeEnvironmentSyncNote } from "./EnvironmentSyncNote.ts";

const projectId = ProjectId.make("project:note");
const syncedAt = "2026-10-12T10:00:00.000Z";
const turn = (status: "completed" | "failed", completedAt: string) => ({
  status,
  completedAt: DateTime.makeUnsafe(completedAt),
});

const withRepository = <A, E>(
  body: (
    ask: (input: {
      readonly threadId: string;
      readonly providerTurns?: ReadonlyArray<ReturnType<typeof turn>>;
      readonly carriesText?: boolean;
      readonly cwd?: string;
    }) => Effect.Effect<string>,
    root: string,
  ) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-sync-note-" });
    yield* fileSystem.makeDirectory(path.join(root, ".git"));
    yield* writeEnvironmentSyncNote(fileSystem, root, {
      originLabel: "Laptop",
      hostLabel: "Mini",
      originWorkspaceRoot: "/Users/a/code/app",
      syncedAt,
      checkouts: [
        { path: root, originPath: "/Users/a/code/app", notes: [] },
        {
          path: "/worktrees/app/feature",
          originPath: "/Users/a/trees/feature",
          notes: ["Branch feature is ahead here."],
        },
      ],
    });
    const projects = {
      getById: () => Effect.succeed(Option.some({ workspaceRoot: root } as never)),
    };
    return yield* body(
      (input) =>
        pendingEnvironmentSyncNote({
          fileSystem,
          projects,
          projectId,
          threadId: ThreadId.make(input.threadId),
          providerTurns: input.providerTurns ?? [],
          carriesText: input.carriesText ?? true,
          cwd: input.cwd ?? root,
        }),
      root,
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

it.effect("tells the first thread after a sync where its checkout came from", () =>
  withRepository((ask) =>
    Effect.gen(function* () {
      const note = yield* ask({ threadId: "first", cwd: "/worktrees/app/feature" });
      assert.include(note, 'synced to "Mini" from another machine, "Laptop"');
      assert.include(note, "There it lives in /Users/a/trees/feature.");
      assert.include(note, "Branch feature is ahead here.");
      // Another thread is not told again, and the first keeps the note while its turn retries.
      assert.equal(yield* ask({ threadId: "second" }), "");
      assert.notEqual(yield* ask({ threadId: "first" }), "");
    }),
  ),
);

it.effect("stops once a turn completed after the sync", () =>
  withRepository((ask) =>
    Effect.gen(function* () {
      const before = [turn("completed", "2026-10-12T09:00:00.000Z")];
      assert.notEqual(yield* ask({ threadId: "old", providerTurns: before }), "");
      const failed = [...before, turn("failed", "2026-10-12T11:00:00.000Z")];
      assert.notEqual(yield* ask({ threadId: "old", providerTurns: failed }), "");
      const done = [...failed, turn("completed", "2026-10-12T12:00:00.000Z")];
      assert.equal(yield* ask({ threadId: "old", providerTurns: done }), "");
    }),
  ),
);

it.effect("leaves the note unclaimed for turns that carry no text", () =>
  withRepository((ask) =>
    Effect.gen(function* () {
      assert.equal(yield* ask({ threadId: "compacting", carriesText: false }), "");
      assert.notEqual(yield* ask({ threadId: "next" }), "");
    }),
  ),
);

it.effect("says nothing in a project that never received a sync", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-sync-note-" });
    const note = yield* pendingEnvironmentSyncNote({
      fileSystem,
      projects: { getById: () => Effect.succeed(Option.some({ workspaceRoot: root } as never)) },
      projectId,
      threadId: ThreadId.make("thread"),
      providerTurns: [],
      carriesText: true,
      cwd: root,
    });
    assert.equal(note, "");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
