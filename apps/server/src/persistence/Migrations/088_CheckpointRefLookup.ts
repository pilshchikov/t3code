import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE INDEX idx_orchestration_v2_projection_checkpoints_ref
    ON orchestration_v2_projection_checkpoints(json_extract(payload_json, '$.ref'))`;
});
