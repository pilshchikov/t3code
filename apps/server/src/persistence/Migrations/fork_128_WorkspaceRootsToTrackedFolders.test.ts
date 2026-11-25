import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";

it.layer(NodeSqliteClient.layerMemory())("128_ForkWorkspaceRootsToTrackedFolders", (it) => {
  it.effect("moves extra workspace roots into tracked folders and keeps color and guidance", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 127 });
      const now = "2026-01-01T00:00:00.000Z";
      const roots = JSON.stringify([
        { path: "/project", color: "blue", agentGuidance: "Primary notes" },
        { path: "/services", label: "Services", defaultThreadEnvMode: "local" },
        { path: "/tools", color: "red" },
        { path: "/project/packages/inner", agentGuidance: "Inner notes" },
        { path: "/known", label: "Renamed" },
      ]);
      const tracked = JSON.stringify([{ path: "/known", name: "known" }]);
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, workspace_roots_json, tracked_folders_json,
          scripts_json, created_at, updated_at
        ) VALUES ('project-1', 'Project', '/project', ${roots}, ${tracked}, '[]', ${now}, ${now})
      `;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, workspace_roots_json, scripts_json, created_at, updated_at
        ) VALUES ('project-2', 'Single', '/single', '[{"path":"/single"}]', '[]', ${now}, ${now})
      `;

      yield* runMigrations({ toMigrationInclusive: 128 });

      const rows = yield* sql<{
        readonly projectId: string;
        readonly roots: string;
        readonly tracked: string;
      }>`
        SELECT
          project_id AS "projectId",
          workspace_roots_json AS "roots",
          tracked_folders_json AS "tracked"
        FROM projection_projects
        ORDER BY project_id
      `;
      assert.deepEqual(
        rows.map((row) => ({
          projectId: row.projectId,
          roots: JSON.parse(row.roots),
          tracked: JSON.parse(row.tracked),
        })),
        [
          {
            projectId: "project-1",
            roots: [
              { path: "/project", color: "blue", agentGuidance: "Primary notes" },
              { path: "/tools", color: "red" },
              { path: "/project/packages/inner", agentGuidance: "Inner notes" },
            ],
            tracked: [
              { path: "/known", name: "known" },
              { path: "/services", name: "Services" },
              { path: "/tools", name: "tools" },
            ],
          },
          { projectId: "project-2", roots: [], tracked: [] },
        ],
      );
    }),
  );
});
