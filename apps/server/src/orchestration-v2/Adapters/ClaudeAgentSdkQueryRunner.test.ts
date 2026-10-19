// @effect-diagnostics nodeBuiltinImport:off -- the fake CLI and its leftover child are real processes.
import * as ClaudeSdk from "@anthropic-ai/claude-agent-sdk";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ProviderSessionId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { vi } from "vite-plus/test";

import { ProviderEventLoggers } from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  CLAUDE_AGENT_SDK_QUERY_PROTOCOL,
  ClaudeAgentSdkQueryRunner,
  layerQueryRunner,
} from "./ClaudeAdapterV2.ts";

vi.mock("@anthropic-ai/claude-agent-sdk", { spy: true });

it.effect("logs successful task stops for replay and omits failed stops", () =>
  Effect.gen(function* () {
    const writes: unknown[] = [];
    const stopTask = vi.fn(async (_taskId: string) => {});
    const query = vi.spyOn(ClaudeSdk, "query").mockReturnValue({
      stopTask,
    } as unknown as ClaudeSdk.Query);
    yield* Effect.addFinalizer(() => Effect.sync(() => query.mockRestore()));
    const threadId = ThreadId.make("thread-stop");
    const providerSessionId = ProviderSessionId.make("session-stop");
    yield* Effect.gen(function* () {
      const runner = yield* ClaudeAgentSdkQueryRunner;
      const session = yield* runner.open({
        threadId,
        providerSessionId,
        options: {
          sessionId: "native-session-stop",
          model: "claude-sonnet-4-6",
          tools: [],
          permissionMode: "default",
        },
      });
      writes.length = 0;
      yield* session.stopTask("workflow-task");
      assert.deepEqual(stopTask.mock.calls, [["workflow-task"]]);
      assert.deepEqual(writes, [
        {
          provider: "claudeAgent",
          protocol: CLAUDE_AGENT_SDK_QUERY_PROTOCOL,
          kind: "protocol",
          providerSessionId,
          event: {
            direction: "outgoing",
            stage: "decoded",
            payload: { type: "query.stop_task", taskId: "workflow-task" },
          },
        },
      ]);
      stopTask.mockRejectedValueOnce(new Error("Stop failed"));
      assert.isTrue(Exit.isFailure(yield* Effect.exit(session.stopTask("failed-task"))));
      assert.equal(writes.length, 1);
    }).pipe(
      Effect.provide(
        layerQueryRunner.pipe(
          Layer.provide(
            Layer.succeed(ProviderEventLoggers, {
              native: {
                filePath: "/tmp/events.log",
                write: (event) =>
                  Effect.sync(() => {
                    writes.push(event);
                  }),
                close: () => Effect.void,
              },
              canonical: undefined,
            }),
          ),
        ),
      ),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

const realQueryRunner = layerQueryRunner.pipe(
  Layer.provide(
    Layer.succeed(ProviderEventLoggers, {
      native: undefined,
      canonical: undefined,
    }),
  ),
  Layer.provide(NodeServices.layer),
);

describe("Claude account history forks", () => {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const cursor = "22222222-2222-4222-8222-222222222222";
  const sourceDirectory = "-original-worktree";
  const writeTranscript = (configDir: string, text: string) => {
    const project = NodePath.join(configDir, "projects", sourceDirectory);
    NodeFS.mkdirSync(project, { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(project, `${sessionId}.jsonl`),
      [
        {
          type: "user",
          uuid: "33333333-3333-4333-8333-333333333333",
          parentUuid: null,
          sessionId,
          message: { role: "user", content: text },
        },
        {
          type: "assistant",
          uuid: cursor,
          parentUuid: "33333333-3333-4333-8333-333333333333",
          sessionId,
          message: { role: "assistant", content: [{ type: "text", text }] },
        },
        {
          type: "user",
          uuid: "44444444-4444-4444-8444-444444444444",
          parentUuid: cursor,
          sessionId,
          message: { role: "user", content: "after-fork-cursor" },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n") + "\n",
    );
  };
  const withFixture = <E>(
    test: (root: string) => Effect.Effect<void, E, ClaudeAgentSdkQueryRunner>,
  ) =>
    Effect.gen(function* () {
      const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-claude-fork-"));
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => NodeFS.rmSync(root, { recursive: true, force: true })),
      );
      yield* test(root);
    }).pipe(
      Effect.provide(realQueryRunner),
      Effect.provideService(HostProcess.Arguments, [
        process.execPath,
        new URL("../../bin.ts", import.meta.url).pathname,
      ]),
    );

  it.effect(
    "forks concurrent account histories after changing worktrees, at the requested cursor",
    () =>
      withFixture((root) =>
        Effect.gen(function* () {
          const runner = yield* ClaudeAgentSdkQueryRunner;
          const results = yield* Effect.all(
            ["work", "personal"].map((account) =>
              Effect.gen(function* () {
                const configDir = NodePath.join(root, account);
                writeTranscript(configDir, `${account}-history`);
                const result = yield* runner.forkSession({
                  sessionId,
                  options: { dir: root, upToMessageId: cursor },
                  environment: { ...process.env, HOME: root, CLAUDE_CONFIG_DIR: configDir },
                  threadId: ThreadId.make(`fork-${account}`),
                  providerSessionId: ProviderSessionId.make(`session-${account}`),
                });
                const contents = NodeFS.readFileSync(
                  NodePath.join(
                    configDir,
                    "projects",
                    sourceDirectory,
                    `${result.sessionId}.jsonl`,
                  ),
                  "utf8",
                );
                assert.include(contents, `${account}-history`);
                assert.notInclude(contents, "after-fork-cursor");
                return result.sessionId;
              }),
            ),
            { concurrency: "unbounded" },
          );
          assert.notEqual(results[0], results[1]);
        }),
      ),
  );

  it.effect("uses a profile's HOME when no config directory is set", () =>
    withFixture((root) =>
      Effect.gen(function* () {
        const runner = yield* ClaudeAgentSdkQueryRunner;
        const configDir = NodePath.join(root, ".claude");
        writeTranscript(configDir, "home-profile-history");
        const result = yield* runner.forkSession({
          sessionId,
          options: {},
          environment: { ...process.env, HOME: root, CLAUDE_CONFIG_DIR: undefined },
          threadId: ThreadId.make("fork-home"),
          providerSessionId: ProviderSessionId.make("session-home"),
        });
        assert.include(
          NodeFS.readFileSync(
            NodePath.join(configDir, "projects", sourceDirectory, `${result.sessionId}.jsonl`),
            "utf8",
          ),
          "home-profile-history",
        );
      }),
    ),
  );

  it.effect("does not fall back to another account when the selected account has no session", () =>
    withFixture((root) =>
      Effect.gen(function* () {
        const runner = yield* ClaudeAgentSdkQueryRunner;
        writeTranscript(NodePath.join(root, ".claude"), "wrong-account-history");
        const result = yield* Effect.exit(
          runner.forkSession({
            sessionId,
            options: { dir: root },
            environment: {
              ...process.env,
              HOME: root,
              CLAUDE_CONFIG_DIR: NodePath.join(root, "work"),
            },
            threadId: ThreadId.make("fork-missing"),
            providerSessionId: ProviderSessionId.make("session-missing"),
          }),
        );
        assert.isTrue(Exit.isFailure(result));
        assert.deepEqual(
          NodeFS.readdirSync(NodePath.join(root, ".claude", "projects", sourceDirectory)),
          [`${sessionId}.jsonl`],
        );
      }),
    ),
  );
});

function fakeClaudeCli(script: string): string {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-claude-cli-"));
  const cli = NodePath.join(dir, "claude");
  NodeFS.writeFileSync(cli, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return cli;
}

const openFakeCli = (cli: string) =>
  Effect.gen(function* () {
    const runner = yield* ClaudeAgentSdkQueryRunner;
    return yield* runner.open({
      threadId: ThreadId.make("thread-fake-cli"),
      providerSessionId: ProviderSessionId.make("session-fake-cli"),
      options: {
        sessionId: "native-session-fake-cli",
        model: "claude-sonnet-4-6",
        tools: [],
        permissionMode: "default",
        pathToClaudeCodeExecutable: cli,
      },
    });
  });

describe.skipIf(HostProcess.Platform.defaultValue() === "win32")("Claude CLI process", () => {
  // The CLI stops the MCP servers it started, but not their children: a
  // plugin's `bun server.ts` outlives its `bun run` wrapper (#3089). The child
  // holds a FIFO open, so its death reads as end-of-file here, with no polling.
  it.effect("stops what the CLI left running when the session closes", () =>
    Effect.gen(function* () {
      const cli = fakeClaudeCli(
        [
          'dir=$(dirname "$0")',
          'sleep 600 > "$dir/alive" &',
          'echo $! > "$dir/leftover.pid"',
          "cat > /dev/null",
        ].join("\n"),
      );
      const dir = NodePath.dirname(cli);
      NodeChildProcess.execFileSync("mkfifo", [NodePath.join(dir, "alive")]);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          try {
            process.kill(Number(NodeFS.readFileSync(NodePath.join(dir, "leftover.pid"), "utf8")));
          } catch {}
          NodeFS.rmSync(dir, { recursive: true, force: true });
        }),
      );
      const alive = NodeFS.createReadStream(NodePath.join(dir, "alive"));
      const leftoverStarted = new Promise<void>((resolve) => alive.once("open", () => resolve()));
      const leftoverStopped = new Promise<void>((resolve) => alive.once("close", () => resolve()));
      alive.resume();

      const session = yield* openFakeCli(cli);
      yield* Effect.promise(() => leftoverStarted);
      yield* session.close;
      yield* Effect.promise(() => leftoverStopped);
    }).pipe(Effect.provide(realQueryRunner)),
  );
});
