import { PROJECT_TRACKED_FOLDERS_MAX } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

interface LegacyRoot {
  readonly path?: unknown;
  readonly label?: unknown;
  readonly color?: unknown;
  readonly agentGuidance?: unknown;
}

interface TrackedFolder {
  readonly path: string;
  readonly name: string;
  readonly discovered?: boolean;
}

const Json = Schema.fromJsonString(Schema.Unknown);
const decodeJson = Schema.decodeUnknownEffect(Json);
const encodeJson = Schema.encodeEffect(Json);

const parseArray = (text: string | null) =>
  decodeJson(text ?? "[]").pipe(
    Effect.map((value): ReadonlyArray<unknown> => (Array.isArray(value) ? value : [])),
    Effect.orElseSucceed((): ReadonlyArray<unknown> => []),
  );

const nonEmpty = (value: unknown) =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

const trimSlashes = (value: string) => (value.length > 1 ? value.replace(/[\\/]+$/, "") : value);

const isInside = (root: string, candidate: string) => {
  const base = trimSlashes(root);
  return (
    candidate === base || candidate.startsWith(`${base}/`) || candidate.startsWith(`${base}\\`)
  );
};

const basename = (value: string) => trimSlashes(value).split(/[\\/]/).pop() || value;

// Projection-only, like upstream's tracked-folder migration: the fork's extra workspace roots
// become tracked folders, and `workspace_roots_json` keeps only per-folder color and guidance.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    readonly projectId: string;
    readonly workspaceRoot: string;
    readonly roots: string | null;
    readonly tracked: string | null;
  }>`
    SELECT
      project_id AS "projectId",
      workspace_root AS "workspaceRoot",
      workspace_roots_json AS "roots",
      tracked_folders_json AS "tracked"
    FROM projection_projects
  `;
  for (const row of rows) {
    const roots = (yield* parseArray(row.roots)) as ReadonlyArray<LegacyRoot>;
    const tracked = [...((yield* parseArray(row.tracked)) as ReadonlyArray<TrackedFolder>)];
    const settings: Array<{ path: string; color?: string; agentGuidance?: string }> = [];
    for (const root of roots) {
      const path = nonEmpty(root.path);
      if (path === undefined) continue;
      const color = nonEmpty(root.color);
      const agentGuidance = nonEmpty(root.agentGuidance);
      if (color !== undefined || agentGuidance !== undefined) {
        settings.push({
          path,
          ...(color === undefined ? {} : { color }),
          ...(agentGuidance === undefined ? {} : { agentGuidance }),
        });
      }
      if (
        isInside(row.workspaceRoot, path) ||
        tracked.some((folder) => folder.path === path) ||
        tracked.length >= PROJECT_TRACKED_FOLDERS_MAX
      ) {
        continue;
      }
      const name =
        (nonEmpty(root.label) ?? basename(path)).slice(0, 128).trim() || path.slice(0, 128);
      tracked.push({ path, name });
    }
    yield* sql`
      UPDATE projection_projects
      SET
        tracked_folders_json = ${yield* encodeJson(tracked)},
        workspace_roots_json = ${yield* encodeJson(settings)}
      WHERE project_id = ${row.projectId}
    `;
  }
});
