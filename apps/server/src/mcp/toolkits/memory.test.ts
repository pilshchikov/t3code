import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { McpSchema, McpServer } from "effect/unstable/ai";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { McpInvocationContext, type McpInvocationScope } from "../McpInvocationContext.ts";
import { MemoryToolkit, MemoryHandlersLive } from "./memory.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "memory-test", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "memory-test", version: "1" },
  },
  getClient: Effect.die("unused"),
});
const scope: McpInvocationScope = {
  environmentId: EnvironmentId.make("test"),
  threadId: ThreadId.make("memory-a"),
  providerInstanceId: ProviderInstanceId.make("claude"),
  providerSessionId: "memory-test",
  capabilities: new Set(["memory"]),
  issuedAt: 1,
};
const testLayer = McpServer.toolkit(MemoryToolkit).pipe(
  Layer.provide(MemoryHandlersLive),
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provideMerge(SqlitePersistenceMemory),
);

it.effect(
  "MCP saves and reads only its thread's project, without returning full contents on list or save",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      for (const id of ["a", "b"]) {
        yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at) VALUES (${id}, 'Project', '/test', '[]', '2026-09-08', '2026-09-08')`;
        yield* sql`INSERT INTO projection_threads (thread_id, project_id, title, created_at, updated_at) VALUES (${`memory-${id}`}, ${id}, 'Thread', '2026-09-08', '2026-09-08')`;
      }
      const server = yield* McpServer.McpServer;
      const call = (name: string, args: Record<string, unknown>, invocation = scope) =>
        server
          .callTool({ name, arguments: args })
          .pipe(
            Effect.provideService(McpInvocationContext, invocation),
            Effect.provideService(McpSchema.McpServerClient, client),
          );
      const saved = yield* call("project_memory_save", {
        name: "hosts",
        description: "Before deployment",
        content: "Private inventory location",
      });
      expect(saved.isError).not.toBe(true);
      expect(encodeJson(saved)).not.toContain("Private inventory location");
      const index = yield* call("project_memory_list", {});
      expect(encodeJson(index)).toContain("Before deployment");
      expect(encodeJson(index)).not.toContain("Private inventory location");
      expect(encodeJson(yield* call("project_memory_read", { name: "hosts" }))).toContain(
        "Private inventory location",
      );
      const other = yield* call(
        "project_memory_read",
        { name: "hosts" },
        { ...scope, threadId: ThreadId.make("memory-b") },
      );
      expect(other.isError).toBe(true);
      const denied = yield* call(
        "project_memory_list",
        {},
        { ...scope, capabilities: new Set(["preview"]) },
      );
      expect(denied.isError).toBe(true);
      const invalid = yield* Effect.exit(
        call("project_memory_save", { name: "../bad", description: "bad", content: "bad" }),
      );
      expect(invalid._tag).toBe("Failure");
    }).pipe(Effect.provide(testLayer)),
);
