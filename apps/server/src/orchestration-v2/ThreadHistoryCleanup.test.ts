import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Tracer from "effect/Tracer";
import * as SqlClient from "effect/sql/SqlClient";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ThreadCommandExecutor from "./ThreadCommandExecutor.ts";
import * as ThreadHistoryCleanup from "./ThreadHistoryCleanup.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const settings = {
  ...DEFAULT_SERVER_SETTINGS,
  storageCleanup: { ...DEFAULT_SERVER_SETTINGS.storageCleanup, settledThreadAfterDays: 7 },
};
const makeTestLayer = (
  deleteRefs: CheckpointStore.CheckpointStore["Service"]["deleteCheckpointRefs"] = () =>
    Effect.void,
) => {
  const baseLayer = Layer.mergeAll(
    Sqlite.layerMemory,
    NodeServices.layer,
    ThreadCommandExecutor.layer,
    Layer.succeed(ServerSettings.ServerSettingsService, {
      getSettings: Effect.succeed(settings),
    } as unknown as ServerSettings.ServerSettingsService["Service"]),
    Layer.succeed(CheckpointStore.CheckpointStore, {
      deleteCheckpointRefs: deleteRefs,
    } as unknown as CheckpointStore.CheckpointStore["Service"]),
  );
  return ThreadHistoryCleanup.layer.pipe(
    Layer.provideMerge(ProjectionStore.layer.pipe(Layer.provideMerge(baseLayer))),
  );
};
const old = "2026-10-01T00:00:00.000Z";
const before = DateTime.makeUnsafe("2026-10-25T00:00:00.000Z");
const payload = (id: string, extra = {}) =>
  JSON.stringify({
    id,
    projectId: "project",
    title: id,
    createdAt: old,
    updatedAt: old,
    settledAt: old,
    settledOverride: "settled",
    pinnedAt: null,
    deletedAt: old,
    ...extra,
  });
const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const id of ["expired", "pending", "shared", "live", "recent", "pinned"]) {
    yield* sql`INSERT INTO orchestration_v2_projection_threads (
      thread_id, project_id, title, default_provider, provider_instance_id, runtime_mode,
      interaction_mode, created_at, updated_at, deleted_at, payload_json
    ) VALUES (${id}, 'project', ${id}, 'codex', 'codex', 'full-access', 'default', ${old}, ${old}, ${id === "live" ? null : old},
      ${payload(id, id === "pinned" ? { pinnedAt: old } : id === "live" ? { deletedAt: null, settledAt: null, forkedFrom: { type: "run", threadId: "shared" } } : {})})`;
    yield* sql`INSERT INTO orchestration_v2_projection_messages (message_id, thread_id, role, streaming, created_at, updated_at, payload_json)
      VALUES (${id + "-message"}, ${id}, 'user', 0, ${id === "recent" ? "2026-10-31T00:00:00.000Z" : old}, ${old}, ${JSON.stringify({ id: id + "-message", text: "retained searchable history", role: "user" })})`;
    for (const version of [1, 2])
      yield* sql`INSERT INTO orchestration_events
      (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, actor_kind, payload_json, metadata_json, application_event_version)
      VALUES (${id + "-event-" + version}, 'thread', ${id}, ${version}, ${version === 1 ? "message.updated" : "thread.deleted"}, ${old}, 'server', ${version === 1 ? '{"text":"large old prompt"}' : "{}"}, '{}', 2)`;
  }
  yield* sql`INSERT INTO orchestration_v2_projection_provider_sessions
    (provider_session_id, thread_id, provider, status, updated_at, payload_json)
    VALUES ('shared-driver', 'expired', 'codex', 'ready', ${old}, '{}')`;
  yield* sql`INSERT INTO orchestration_v2_projection_provider_session_bindings
    (provider_session_id, thread_id) VALUES ('shared-driver', 'live')`;
  yield* sql`INSERT INTO orchestration_v2_effect_outbox
    (effect_id, command_id, thread_id, effect_type, payload_json, status, attempt_count, available_at, created_at, updated_at)
    VALUES ('pending-effect', 'delete-pending', 'pending', 'attachment.cleanup', '{}', 'pending', 0, ${old}, ${old}, ${old})`;
});

it.effect(
  "purges expired history after resource cleanup, preserves live/shared/recent data, and is idempotent",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const service = yield* ThreadHistoryCleanup.ThreadHistoryCleanup;
      yield* seed;
      const anchor = (yield* sql<{
        sequence: number;
      }>`SELECT sequence FROM orchestration_events WHERE event_id = 'expired-event-1'`)[0]!
        .sequence;
      yield* sql`UPDATE orchestration_events SET payload_json = '{"prompt":"shared prompt"}' WHERE sequence = ${anchor}`;
      yield* sql`INSERT INTO orchestration_events
        (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, actor_kind, payload_json, metadata_json, application_event_version)
        VALUES ('live-borrower', 'thread', 'live', 3, 'subagent.updated', ${old}, 'server', ${JSON.stringify({ promptSequence: anchor })}, '{}', 2)`;
      const deletes: string[] = [];
      const refLookups: string[] = [];
      const tracer = Tracer.make({
        span(options) {
          const span = new Tracer.NativeSpan(options);
          const end = span.end.bind(span);
          span.end = (endTime, exit) => {
            end(endTime, exit);
            const query = span.attributes.get("db.query.text");
            if (typeof query === "string" && /DELETE FROM orchestration_events\b/.test(query))
              deletes.push(query);
            if (typeof query === "string" && /p\.workspace_root\b/.test(query))
              refLookups.push(query);
          };
          return span;
        },
      });
      const removed = yield* service
        .run({ before, retentionDays: 7 })
        .pipe(Effect.withTracer(tracer));
      assert.equal(deletes.length, 1);
      const plan = yield* sql.unsafe<{ detail: string }>(`EXPLAIN QUERY PLAN ${deletes[0]}`, [
        "expired",
        100,
        "expired",
      ]);
      assert.isTrue(
        plan.some((row) => row.detail.includes("idx_orchestration_events_prompt_reference")),
        JSON.stringify(plan),
      );
      assert.isFalse(
        plan.some((row) => /SCAN other/.test(row.detail)),
        JSON.stringify(plan),
      );
      assert.equal(refLookups.length, 1);
      const refPlan = yield* sql.unsafe<{ detail: string }>(`EXPLAIN QUERY PLAN ${refLookups[0]}`, [
        "expired",
      ]);
      assert.isTrue(
        refPlan.some((row) =>
          row.detail.includes("idx_orchestration_v2_projection_checkpoints_ref"),
        ),
        JSON.stringify(refPlan),
      );
      assert.equal(
        (yield* sql`SELECT * FROM orchestration_v2_projection_provider_sessions WHERE provider_session_id = 'shared-driver'`)
          .length,
        1,
      );
      assert.deepEqual(
        removed.map((entry) => [String(entry.threadId), entry.outcome]),
        [["expired", "removed"]],
      );
      assert.deepEqual(
        (yield* sql<{
          thread_id: string;
        }>`SELECT thread_id FROM orchestration_v2_projection_messages ORDER BY thread_id`).map(
          (row) => row.thread_id,
        ),
        ["live", "pending", "pinned", "recent", "shared"],
      );
      assert.equal(
        (yield* sql`SELECT * FROM orchestration_events WHERE stream_id = 'expired'`).length,
        2,
      );
      assert.equal(
        (yield* sql`SELECT * FROM orchestration_v2_projection_threads WHERE thread_id = 'expired' AND history_purged_at IS NOT NULL`)
          .length,
        1,
      );
      assert.equal(
        (yield* sql`SELECT json_extract(payload_json, '$.prompt') AS prompt FROM orchestration_events WHERE sequence = ${anchor}`)[0]
          ?.prompt,
        "shared prompt",
      );
      assert.deepEqual(yield* service.run({ before, retentionDays: 7 }), []);
      yield* sql`UPDATE orchestration_v2_effect_outbox SET status = 'succeeded' WHERE thread_id = 'pending'`;
      assert.deepEqual(
        (yield* service.run({ before, retentionDays: 7 })).map((entry) => String(entry.threadId)),
        ["pending"],
      );
      const boundary = yield* sql<{
        last_sequence: number;
      }>`SELECT last_sequence FROM orchestration_v2_projection_metadata WHERE projection_name = 'event-log-pruned-through'`;
      assert.isAbove(boundary[0]!.last_sequence, 0);
    }).pipe(Effect.provide(makeTestLayer())),
);

it.effect("keeps stored history when the retention policy no longer matches the sweep", () =>
  Effect.gen(function* () {
    yield* seed;
    const service = yield* ThreadHistoryCleanup.ThreadHistoryCleanup;
    assert.deepEqual(yield* service.run({ before, retentionDays: 14 }), []);
    const sql = yield* SqlClient.SqlClient;
    assert.equal((yield* sql`SELECT * FROM orchestration_v2_projection_messages`).length, 6);
  }).pipe(Effect.provide(makeTestLayer())),
);

it.effect(
  "removes owned checkpoint refs and preserves refs used by another live conversation",
  () => {
    const removedRefs: string[] = [];
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.makeTempDirectoryScoped();
      yield* seed;
      for (const id of ["expired", "live"]) {
        yield* sql`INSERT INTO orchestration_v2_projection_checkpoint_scopes (
        scope_id, thread_id, node_id, kind, ordinal_within_parent, advances_app_run_count, created_at, payload_json
      ) VALUES (${id + "-scope"}, ${id}, ${id + "-node"}, 'root_run', 0, 1, ${old}, ${JSON.stringify({ cwd })})`;
      }
      for (const [id, owner, ref, ordinal] of [
        ["owned-checkpoint", "expired", "refs/t3/orchestration-v2/checkpoints/owned/0", 0],
        ["shared-checkpoint", "expired", "refs/t3/orchestration-v2/checkpoints/shared/0", 1],
        ["live-checkpoint", "live", "refs/t3/orchestration-v2/checkpoints/shared/0", 0],
      ] as const) {
        yield* sql`INSERT INTO orchestration_v2_projection_checkpoints (
        checkpoint_id, thread_id, scope_id, node_id, ordinal_within_scope, status, captured_at, payload_json
      ) VALUES (${id}, ${owner}, ${owner + "-scope"}, ${owner + "-node"}, ${ordinal}, 'ready', ${old}, ${JSON.stringify({ ref })})`;
      }
      const service = yield* ThreadHistoryCleanup.ThreadHistoryCleanup;
      assert.deepEqual(
        (yield* service.run({ before, retentionDays: 7 })).map((entry) => entry.outcome),
        ["removed"],
      );
      assert.deepEqual(removedRefs, ["refs/t3/orchestration-v2/checkpoints/owned/0"]);
      assert.equal(
        (yield* sql`SELECT * FROM orchestration_v2_projection_checkpoints WHERE thread_id = 'live'`)
          .length,
        1,
      );
    }).pipe(
      Effect.provide(
        makeTestLayer((input) =>
          Effect.sync(() => {
            removedRefs.push(...input.checkpointRefs);
          }),
        ),
      ),
    );
  },
);
