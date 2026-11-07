import { CheckpointRef, ThreadId, type StorageCleanupReportEntry } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import * as Layer from "effect/Layer";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as SqlClient from "effect/sql/SqlClient";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadCommandExecutor from "./ThreadCommandExecutor.ts";
import { EVENT_LOG_PRUNED_THROUGH } from "../persistence/OrchestrationEventStore.ts";

export class ThreadHistoryCleanupError extends Schema.TaggedError<ThreadHistoryCleanupError>()(
  "ThreadHistoryCleanupError",
  { cause: Schema.Defect() },
) {}

export class ThreadHistoryCleanup extends Context.Service<
  ThreadHistoryCleanup,
  {
    readonly run: (input: {
      before: DateTime.Utc;
      retentionDays: number;
    }) => Effect.Effect<ReadonlyArray<StorageCleanupReportEntry>, ThreadHistoryCleanupError>;
  }
>()("t3/orchestration-v2/ThreadHistoryCleanup") {}

const HISTORY_TABLES = [
  "orchestration_v2_projection_runs",
  "orchestration_v2_projection_run_attempts",
  "orchestration_v2_projection_nodes",
  "orchestration_v2_projection_provider_threads",
  "orchestration_v2_projection_provider_turns",
  "orchestration_v2_projection_runtime_requests",
  "orchestration_v2_projection_messages",
  "orchestration_v2_projection_plans",
  "orchestration_v2_projection_turn_items",
  "orchestration_v2_projection_checkpoint_scopes",
  "orchestration_v2_projection_checkpoints",
  "orchestration_v2_projection_context_handoffs",
  "orchestration_v2_projection_subagents",
  "orchestration_v2_turn_item_positions",
  "orchestration_v2_projection_provider_session_bindings",
  "orchestration_v2_thread_launch_workflows",
  "orchestration_v2_effect_outbox",
  "orchestration_v2_events",
  "orchestration_v2_command_receipts",
  "mcp_app_model_context",
  "provider_session_runtime",
  "projection_thread_messages",
  "projection_thread_sessions",
  "projection_thread_pull_requests",
] as const;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const fs = yield* FileSystem.FileSystem;
  const checkpoints = yield* CheckpointStore.CheckpointStore;
  const locks = yield* ThreadCommandExecutor.ThreadCommandExecutor;
  const settings = yield* ServerSettings.ServerSettingsService;

  const canPurge = Effect.fn("ThreadHistoryCleanup.canPurge")(function* (
    before: string,
    threadId?: ThreadId,
    afterId = "",
  ) {
    const rows = yield* sql<{ thread_id: string; title: string }>`
      SELECT thread_id, title FROM orchestration_v2_projection_threads AS t
      WHERE ${threadId === undefined ? sql`t.thread_id > ${afterId}` : sql`t.thread_id = ${threadId}`} AND t.deleted_at IS NOT NULL AND t.history_purged_at IS NULL
        AND json_extract(t.payload_json, '$.settledAt') <= ${before}
        AND json_extract(t.payload_json, '$.pinnedAt') IS NULL
        AND json_extract(t.payload_json, '$.settledOverride') IS NOT 'active'
        AND NOT EXISTS (
          SELECT 1 FROM orchestration_v2_effect_outbox AS e
          WHERE e.thread_id = t.thread_id AND e.status NOT IN ('succeeded', 'cancelled')
        )
        AND NOT EXISTS (
          SELECT 1 FROM orchestration_v2_projection_provider_sessions AS s
          JOIN orchestration_v2_projection_provider_session_bindings AS b ON b.provider_session_id = s.provider_session_id
          WHERE b.thread_id = t.thread_id AND s.status NOT IN ('stopped', 'error')
        )
        AND NOT EXISTS (
          SELECT 1 FROM orchestration_v2_projection_runs AS r WHERE r.thread_id = t.thread_id
            AND (r.status IN ('pending', 'queued', 'preparing', 'starting', 'running', 'waiting')
              OR r.requested_at > ${before} OR r.completed_at > ${before})
        )
        AND NOT EXISTS (
          SELECT 1 FROM orchestration_v2_projection_messages AS m
          WHERE m.thread_id = t.thread_id AND m.created_at > ${before}
        )
      ORDER BY t.thread_id LIMIT 100
    `;
    return rows;
  });

  const run = Effect.fn("ThreadHistoryCleanup.run")(
    function* (input: { before: DateTime.Utc; retentionDays: number }) {
      const before = DateTime.formatIso(input.before);
      const removed: StorageCleanupReportEntry[] = [];
      for (let cursor = ""; ;) {
        const candidates = yield* canPurge(before, undefined, cursor);
        if (candidates.length === 0) break;
        for (const candidate of candidates) {
          if (
            (yield* settings.getSettings).storageCleanup.settledThreadAfterDays !==
            input.retentionDays
          )
            return removed;
          const threadId = ThreadId.make(candidate.thread_id);
          const purged = yield* locks
            .withLock(
              threadId,
              Effect.gen(function* () {
                if (
                  !(yield* canPurge(before, threadId))[0] ||
                  (yield* projections.getHistoryDependentThreadIds(threadId)).length > 0
                )
                  return;
                const refs = yield* sql<{
                  ref: string;
                  cwd: string;
                  workspace_root: string | null;
                }>`
          SELECT json_extract(c.payload_json, '$.ref') AS ref,
            json_extract(s.payload_json, '$.cwd') AS cwd, p.workspace_root
          FROM orchestration_v2_projection_checkpoints AS c
          JOIN orchestration_v2_projection_checkpoint_scopes AS s ON s.scope_id = c.scope_id
          JOIN orchestration_v2_projection_threads AS t ON t.thread_id = c.thread_id
          LEFT JOIN projection_projects AS p ON p.project_id = t.project_id
          WHERE c.thread_id = ${threadId} AND NOT EXISTS (
            SELECT 1 FROM orchestration_v2_projection_checkpoints AS other
            JOIN orchestration_v2_projection_threads AS owner ON owner.thread_id = other.thread_id
            WHERE owner.deleted_at IS NULL AND other.thread_id != c.thread_id AND json_extract(other.payload_json, '$.ref') = json_extract(c.payload_json, '$.ref')
          )
        `;
                for (const ref of refs) {
                  if (!ref.ref.startsWith("refs/t3/orchestration-v2/checkpoints/")) continue;
                  const cwd = (yield* fs.exists(ref.cwd)) ? ref.cwd : ref.workspace_root;
                  if (cwd === null || !(yield* fs.exists(cwd))) continue;
                  yield* checkpoints.deleteCheckpointRefs({
                    cwd,
                    checkpointRefs: [CheckpointRef.make(ref.ref)],
                  });
                }
                if (
                  (yield* settings.getSettings).storageCleanup.settledThreadAfterDays !==
                  input.retentionDays
                )
                  return;
                return yield* sql.withTransaction(
                  Effect.gen(function* () {
                    const thread = (yield* canPurge(before, threadId))[0];
                    if (!thread) return;
                    const head = yield* sql<{
                      sequence: number;
                    }>`SELECT COALESCE(MAX(sequence), 0) AS sequence
            FROM orchestration_events WHERE aggregate_kind = 'thread' AND stream_id = ${threadId}`;
                    const sequence = head[0]!.sequence;
                    // Gaps in event history require a snapshot on reconnect; retain the stream's high-water tombstone.
                    yield* sql`INSERT INTO orchestration_v2_projection_metadata
            (projection_name, schema_version, last_sequence, updated_at)
            VALUES (${EVENT_LOG_PRUNED_THROUGH}, ${ProjectionStore.ORCHESTRATION_V2_PROJECTION_SCHEMA_VERSION}, ${sequence}, ${DateTime.formatIso(yield* DateTime.now)})
            ON CONFLICT(projection_name) DO UPDATE SET last_sequence = MAX(last_sequence, excluded.last_sequence)`;
                    yield* sql`DELETE FROM orchestration_events
            WHERE aggregate_kind = 'thread' AND stream_id = ${threadId} AND sequence < ${sequence}
              AND NOT EXISTS (
                SELECT 1 FROM orchestration_events AS other WHERE other.stream_id != ${threadId}
                  AND json_extract(other.payload_json, '$.promptSequence') = orchestration_events.sequence
              )`;
                    yield* sql`UPDATE orchestration_events SET payload_json = json_set(
            json_remove(payload_json, '$.guestShare', '$.titleRegeneration', '$.historyOrigin', '$.linkOrigin', '$.peerThreadWatches'),
            '$.title', 'Deleted thread', '$.activeProviderThreadId', NULL)
            WHERE aggregate_kind = 'thread' AND stream_id = ${threadId} AND sequence = ${sequence} AND event_type = 'thread.deleted'`;
                    yield* sql`DELETE FROM orchestration_command_receipts WHERE aggregate_kind = 'thread' AND aggregate_id = ${threadId}`;
                    yield* sql`DELETE FROM orchestration_v2_projection_provider_sessions
            WHERE thread_id = ${threadId} AND NOT EXISTS (
              SELECT 1 FROM orchestration_v2_projection_provider_session_bindings AS b
              WHERE b.provider_session_id = orchestration_v2_projection_provider_sessions.provider_session_id AND b.thread_id != ${threadId}
            )`;
                    yield* sql`DELETE FROM orchestration_v2_projection_context_transfers
            WHERE source_thread_id = ${threadId} AND NOT EXISTS (
              SELECT 1 FROM orchestration_v2_projection_threads AS t
              WHERE t.thread_id = target_thread_id AND t.deleted_at IS NULL
            )`;
                    yield* sql`DELETE FROM orchestration_v2_projection_context_transfers
            WHERE target_thread_id = ${threadId} AND NOT EXISTS (
              SELECT 1 FROM orchestration_v2_projection_threads AS t
              WHERE t.thread_id = source_thread_id AND t.deleted_at IS NULL
            )`;
                    for (const table of HISTORY_TABLES)
                      yield* sql`DELETE FROM ${sql(table)} WHERE thread_id = ${threadId}`;
                    yield* sql`DELETE FROM projection_threads WHERE thread_id = ${threadId}`;
                    yield* sql`UPDATE orchestration_v2_projection_threads SET history_purged_at = ${DateTime.formatIso(yield* DateTime.now)},
            title = 'Deleted thread', active_provider_thread_id = NULL,
            payload_json = json_set(json_remove(payload_json, '$.guestShare', '$.titleRegeneration', '$.historyOrigin', '$.linkOrigin', '$.peerThreadWatches'), '$.title', 'Deleted thread', '$.activeProviderThreadId', NULL)
            WHERE thread_id = ${threadId}`;
                    return true;
                  }),
                );
              }),
            )
            .pipe(
              Effect.catch((cause) =>
                Effect.logWarning("Thread history purge failed", { threadId, cause }).pipe(
                  Effect.as(false),
                ),
              ),
            );
          if (purged !== undefined)
            removed.push({
              kind: "thread",
              outcome: purged ? "removed" : "failed",
              reason: purged
                ? "Permanently removed expired conversation history"
                : "Thread history cleanup failed; it will be retried",
              path: null,
              projectPath: null,
              threadId,
              threadTitle: candidate.title,
              bytes: null,
              files: null,
            });
        }
        if (removed.length >= 100) break;
        cursor = candidates[candidates.length - 1]!.thread_id;
        yield* Effect.yieldNow;
      }
      return removed;
    },
    Effect.mapError((cause) => new ThreadHistoryCleanupError({ cause })),
  );
  return ThreadHistoryCleanup.of({ run });
});

export const layer = Layer.effect(ThreadHistoryCleanup, make);
