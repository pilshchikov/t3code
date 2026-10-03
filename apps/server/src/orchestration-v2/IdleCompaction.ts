import { ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as ServerSettings from "../serverSettings.ts";

export class IdleCompactionError extends Schema.TaggedError<IdleCompactionError>()(
  "IdleCompactionError",
  { cause: Schema.Defect() },
) {}

export class IdleCompaction extends Context.Service<
  IdleCompaction,
  {
    readonly due: (
      threadId?: ThreadId,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly threadId: ThreadId; readonly runId: RunId }>,
      IdleCompactionError
    >;
  }
>()("t3/orchestration-v2/IdleCompaction") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const settings = yield* ServerSettings.ServerSettingsService;
  const due = Effect.fn("IdleCompaction.due")(
    function* (threadId?: ThreadId) {
      const preferences = yield* settings.getSettings;
      if (
        !preferences.idleCompactionEnabled &&
        !Object.values(preferences.projectSettingsOverrides).some(
          (override) => override.idleCompactionEnabled === true,
        )
      )
        return [];
      const policies = [
        preferences,
        ...Object.keys(preferences.projectSettingsOverrides).map(
          (projectId) => resolveProjectSettings(preferences, ProjectId.make(projectId)).settings,
        ),
      ].filter((policy) => policy.idleCompactionEnabled);
      const minTokens = Math.min(...policies.map((policy) => policy.idleCompactionTokens));
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      const cutoff = DateTime.formatIso(
        DateTime.makeUnsafe(
          now - Math.min(...policies.map((policy) => policy.idleCompactionMinutes)) * 60_000,
        ),
      );
      // Read only summaries, never transcripts. Check all pending tasks, including
      // persistent monitors and commands that intentionally do not hold completion alerts.
      const rows = yield* sql<{
        thread_id: string;
        project_id: string;
        run_id: string;
        used_tokens: number;
        idle_since: string;
      }>`
      SELECT t.thread_id, t.project_id, r.run_id,
        json_extract(p.payload_json, '$.contextUsage.usedTokens') AS used_tokens,
        max(r.completed_at, p.updated_at,
          COALESCE((SELECT max(provider.updated_at) FROM orchestration_v2_projection_provider_threads provider
            WHERE provider.thread_id = t.thread_id), r.completed_at),
          COALESCE((SELECT max(i.updated_at) FROM orchestration_v2_projection_turn_items i
            WHERE i.thread_id = t.thread_id), r.completed_at),
          COALESCE((SELECT max(s.updated_at) FROM orchestration_v2_projection_subagents s
            WHERE s.thread_id = t.thread_id), r.completed_at)) AS idle_since
      FROM orchestration_v2_projection_threads t
      JOIN orchestration_v2_projection_provider_threads p
        ON p.provider_thread_id = t.active_provider_thread_id
        AND p.provider_instance_id = t.provider_instance_id
      JOIN orchestration_v2_projection_runs r ON r.run_id = (
        SELECT latest.run_id FROM orchestration_v2_projection_runs latest
        WHERE latest.thread_id = t.thread_id ORDER BY latest.ordinal DESC LIMIT 1
      ) AND r.status = 'completed'
      JOIN orchestration_v2_projection_messages m
        ON m.message_id = json_extract(r.payload_json, '$.userMessageId')
      WHERE (${threadId ?? null} IS NULL OR t.thread_id = ${threadId ?? null})
        AND t.deleted_at IS NULL AND t.archived_at IS NULL
        AND json_extract(t.payload_json, '$.settledOverride') IS NOT 'settled'
        AND json_extract(t.payload_json, '$.snoozedUntil') IS NULL
        AND json_extract(t.payload_json, '$.lineage.relationshipToParent') IS NOT 'subagent'
        AND p.driver IN ('claudeAgent', 'codex')
        AND p.status IN ('idle', 'not_loaded')
        AND r.completed_at <= ${cutoff}
        AND json_extract(p.payload_json, '$.contextUsage.usedTokens') >= ${minTokens}
        AND lower(trim(json_extract(m.payload_json, '$.text'))) <> '/compact'
        AND NOT EXISTS (SELECT 1 FROM orchestration_v2_projection_runs busy
          WHERE busy.thread_id = t.thread_id
          AND busy.status IN ('queued', 'preparing', 'starting', 'running', 'waiting'))
        AND NOT EXISTS (SELECT 1 FROM orchestration_v2_projection_runtime_requests request
          WHERE request.thread_id = t.thread_id AND request.status = 'pending')
        AND NOT EXISTS (SELECT 1 FROM orchestration_v2_projection_provider_threads background
          WHERE background.thread_id = t.thread_id
          AND json_array_length(background.payload_json, '$.pendingBackgroundTasks') > 0)
        AND NOT EXISTS (SELECT 1 FROM orchestration_v2_projection_turn_items item
          WHERE item.thread_id = t.thread_id AND item.status IN ('pending', 'running', 'waiting')
          AND item.type IN ('command_execution', 'dynamic_tool', 'subagent')
          AND NOT EXISTS (SELECT 1 FROM orchestration_v2_projection_runs abandoned
            WHERE abandoned.run_id = item.run_id AND abandoned.status = 'rolled_back'))
        AND NOT EXISTS (SELECT 1 FROM orchestration_v2_projection_subagents child
          WHERE child.thread_id = t.thread_id AND child.status IN ('pending', 'running', 'waiting'))
      ORDER BY t.thread_id
    `;
      return rows.flatMap((row) => {
        const policy = resolveProjectSettings(preferences, ProjectId.make(row.project_id)).settings;
        const idleSince = Date.parse(row.idle_since);
        return policy.idleCompactionEnabled &&
          Number.isFinite(idleSince) &&
          now - idleSince >= policy.idleCompactionMinutes * 60_000 &&
          Number.isFinite(row.used_tokens) &&
          row.used_tokens >= policy.idleCompactionTokens
          ? [{ threadId: ThreadId.make(row.thread_id), runId: RunId.make(row.run_id) }]
          : [];
      });
    },
    Effect.mapError((cause) => new IdleCompactionError({ cause })),
  );
  return IdleCompaction.of({ due });
});

export const layer = Layer.effect(IdleCompaction, make);
