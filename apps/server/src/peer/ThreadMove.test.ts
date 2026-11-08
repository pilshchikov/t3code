import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import type * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as PeerOrchestration from "../peers/PeerOrchestration.ts";
import * as Peers from "../peers/Peers.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as PeerForwarding from "./PeerForwarding.ts";
import * as RemoteDelegation from "./RemoteDelegation.ts";
import * as ThreadMove from "./ThreadMove.ts";

const here = EnvironmentId.make("env-mac");
const there = EnvironmentId.make("env-mini");
const threadId = ThreadId.make("thread-games");
const item = (id: string, type: string, text: string) => ({
  id,
  type,
  text,
  threadId,
  runId: "run-1",
  providerThreadId: null,
  status: "completed",
});

const setup = (options: { readonly activeRunId: string | null }) => {
  const calls: Array<{ tool: string; environmentId: string; params: Record<string, unknown> }> = [];
  const copies: Array<Peers.PeerCopyInput> = [];
  const dispatched: Array<unknown> = [];
  const layer = ThreadMove.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () =>
            Effect.succeed({
              id: threadId,
              projectId: ProjectId.make("project-mac"),
              title: "Games",
              modelSelection: { instanceId: "claude", model: "opus" },
              runtimeMode: "full-access",
              interactionMode: "default",
              worktreePath: "/Users/me/games/.t3/worktrees/feature",
              branch: "feature",
              activeRunId: options.activeRunId,
              deletedAt: null,
            } as never),
          getThreadRecords: () =>
            Effect.succeed({
              turnItems: [
                item("i1", "user_message", "Build the level editor"),
                item("i2", "command_execution", "ls"),
                item("i3", "assistant_message", "The editor saves to levels/"),
              ],
            } as never),
          dispatch: (command) =>
            Effect.sync(() => {
              dispatched.push(command);
              return { sequence: 1 } as never;
            }),
        }),
        Layer.mock(ProjectService.ProjectService)({
          getById: () => Effect.succeedSome({ workspaceRoot: "/Users/me/games" } as never),
        }),
        Layer.mock(RemoteDelegation.RemoteDelegation)({
          resolveProject: () => Effect.succeed(ProjectId.make("project-mini")),
        }),
        Layer.mock(PeerForwarding.PeerForwarding)({
          call: (_scope, tool, environmentId, params) =>
            Effect.sync(() => {
              calls.push({
                tool: tool.name,
                environmentId,
                params: params as Record<string, unknown>,
              });
              return (
                tool.name === "t3_project_read"
                  ? { id: "project-mini", workspaceRoot: "/Users/mini/games" }
                  : {
                      threadId: "thread-there",
                      projectId: "project-mini",
                      link: "t3://thread-there",
                    }
              ) as never;
            }),
        }),
        Layer.mock(PeerOrchestration.PeerOrchestration)({}),
        Layer.mock(Peers.Peers)({
          copy: (input) =>
            Effect.sync(() => {
              copies.push(input);
              return { files: 2, bytes: 10, skipped: [] };
            }),
        }),
        Layer.mock(ServerEnvironment.ServerEnvironment)({
          getEnvironmentId: Effect.succeed(here),
          getDescriptor: Effect.succeed({ environmentId: here, label: "MacBook" } as never),
        }),
      ),
    ),
  );
  return { layer, calls, copies, dispatched };
};

const scope = {
  environmentId: here,
  requestNamespace: "test",
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
  thread: undefined,
  client: undefined,
} satisfies McpInvocationContext.McpInvocationScope;

it.effect("continues an idle thread on the other machine with its files and history", () => {
  const { layer, calls, copies, dispatched } = setup({ activeRunId: null });
  return Effect.gen(function* () {
    const mover = yield* ThreadMove.ThreadMove;
    const result = yield* mover.move(scope, {
      threadId,
      environmentId: there,
      copyPaths: ["levels/", "notes.md"],
    });
    assert.deepEqual(
      copies.map((copy) => [copy.direction, copy.localPath, copy.peerPath, copy.overwrite]),
      [
        [
          "to_peer",
          "/Users/me/games/.t3/worktrees/feature/levels",
          "/Users/mini/games/levels",
          false,
        ],
        [
          "to_peer",
          "/Users/me/games/.t3/worktrees/feature/notes.md",
          "/Users/mini/games/notes.md",
          false,
        ],
      ],
    );
    const launch = calls.find((call) => call.tool === "t3_thread_launch")!;
    assert.equal(launch.environmentId, there);
    assert.equal(launch.params.projectId, "project-mini");
    assert.equal(launch.params.clientRequestId, `move:${threadId}:${there}:project-mini`);
    const message = String(launch.params.message);
    assert.include(message, "moved here from MacBook (environmentId env-mac)");
    assert.include(message, "on branch feature. You now work in /Users/mini/games.");
    assert.include(message, "Copied here into /Users/mini/games: levels, notes.md.");
    assert.include(message, "Build the level editor");
    assert.include(message, "The editor saves to levels/");
    assert.notInclude(message, "Command: ls");
    assert.deepEqual(
      dispatched.map((command) => (command as { type: string; threadId: string }).type),
      ["thread.archive"],
    );
    assert.deepEqual(result, {
      threadId: ThreadId.make("thread-there"),
      environmentId: there,
      projectId: ProjectId.make("project-mini"),
      link: "t3://thread-there",
      copied: [
        { path: "levels", files: 2, bytes: 10 },
        { path: "notes.md", files: 2, bytes: 10 },
      ],
      sourceArchived: true,
    });
  }).pipe(Effect.provide(layer));
});

it.effect("keeps a running thread and refuses paths outside its folder", () => {
  const { layer, copies, dispatched } = setup({ activeRunId: "run-1" });
  return Effect.gen(function* () {
    const mover = yield* ThreadMove.ThreadMove;
    const escaped = yield* mover
      .move(scope, { threadId, environmentId: there, copyPaths: ["../secrets"] })
      .pipe(Effect.flip);
    assert.equal(escaped.code, "invalid_request");
    const sameProject = yield* mover
      .move(scope, { threadId, environmentId: here, projectId: ProjectId.make("project-mac") })
      .pipe(Effect.flip);
    assert.equal(sameProject.code, "invalid_request");
    assert.deepEqual(copies, []);
    const result = yield* mover.move(scope, { threadId, environmentId: there });
    assert.isFalse(result.sourceArchived);
    assert.deepEqual(dispatched, []);
  }).pipe(Effect.provide(layer));
});
