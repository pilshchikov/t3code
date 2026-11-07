import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE INDEX idx_orchestration_events_prompt_reference
    ON orchestration_events(json_extract(payload_json, '$.promptSequence'), stream_id)
    WHERE event_type IN ('subagent.updated', 'turn-item.updated')
      AND json_type(payload_json, '$.promptSequence') = 'integer'`;
});
