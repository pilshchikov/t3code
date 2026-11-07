import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE orchestration_v2_projection_threads ADD COLUMN history_purged_at TEXT`;
  yield* sql`CREATE INDEX orchestration_v2_threads_history_cleanup_idx
    ON orchestration_v2_projection_threads(deleted_at)
    WHERE deleted_at IS NOT NULL AND history_purged_at IS NULL`;
});
