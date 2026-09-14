import { describe, expect, it } from "@effect/vitest";
import {
  ProjectId,
  ThreadId,
  ProviderInstanceId,
  ProviderDriverKind,
  type OrchestrationThreadShell,
  type ProviderSession,
  type TerminalSummary,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { TestClock } from "effect/testing";
import { ServerConfig } from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { TerminalManager } from "../terminal/Manager.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import {
  make,
  isSettledWorktreeExpired,
  SETTLED_WORKTREE_RETENTION_MS,
} from "./SettledWorktreeCleanup.ts";

const NOW = "2026-09-13T12:00:00.000Z";
const OLD = "2026-09-01T12:00:00.000Z";
const threadId = ThreadId.make("cleanup");
const projectId = ProjectId.make("cleanup-project");
const thread = (
  worktreePath: string,
  overrides: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell => ({
  id: threadId,
  projectId,
  title: "Task",
  branch: "task",
  worktreePath,
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
  runtimeMode: "full-access",
  interactionMode: "default",
  pullRequests: [],
  latestTurn: null,
  createdAt: OLD,
  updatedAt: OLD,
  archivedAt: null,
  settledAt: OLD,
  settledOverride: "settled",
  session: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  latestUserMessageAt: OLD,
  ...overrides,
});
const testLayer = GitVcsDriver.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-retention-test-" })),
  Layer.provideMerge(NodeServices.layer),
);
const harness = Effect.gen(function* () {
  yield* TestClock.setTime(Date.parse(NOW));
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const source = yield* fs.makeTempDirectoryScoped({ prefix: "t3-retention-repo-" });
  const runGit = (cwd: string, args: string[]) =>
    git
      .execute({ cwd, args, operation: "retention-test", timeoutMs: 20_000 })
      .pipe(Effect.map((result) => result.stdout.trim()));
  yield* runGit(source, ["init", "-b", "main"]);
  yield* runGit(source, ["config", "user.email", "test@example.com"]);
  yield* runGit(source, ["config", "user.name", "Test"]);
  yield* fs.writeFileString(path.join(source, "README"), "initial");
  yield* fs.writeFileString(path.join(source, ".gitignore"), "node_modules/\n");
  yield* runGit(source, ["add", "."]);
  yield* runGit(source, ["commit", "-m", "initial"]);
  const target = path.join(config.worktreesDir, "project", "task");
  yield* git.createWorktree({ cwd: source, refName: "main", newRefName: "task", path: target });
  let threads = [thread(target)];
  let archived: OrchestrationThreadShell[] = [];
  let sessions: ReadonlyArray<ProviderSession> = [];
  let terminalList: ReadonlyArray<TerminalSummary> = [];
  let onStatus = () => {};
  let roots: string[] = [];
  const removed: string[] = [];
  const project = () => ({
    id: projectId,
    title: "Project",
    workspaceRoot: source,
    workspaceRoots: roots.map((path) => ({ path })),
    defaultModelSelection: null,
    scripts: [],
    createdAt: OLD,
    updatedAt: OLD,
  });
  const snapshot = (entries: OrchestrationThreadShell[]) => ({
    snapshotSequence: 1,
    projects: [project()],
    threads: entries,
    updatedAt: NOW,
  });
  const service = yield* make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ProjectionSnapshotQuery)({
          getShellSnapshot: () => Effect.sync(() => snapshot(threads)),
          getArchivedShellSnapshot: () => Effect.sync(() => snapshot(archived)),
        }),
        Layer.mock(GitWorkflowService)({
          invalidateLocalStatus: () => Effect.void,
          localStatus: (input) => git.status(input).pipe(Effect.tap(() => Effect.sync(onStatus))),
          removeWorktree: (input) =>
            git
              .removeWorktree(input)
              .pipe(Effect.tap(() => Effect.sync(() => removed.push(input.path)))),
        }),
        Layer.mock(ProviderService)({
          listSessions: () => Effect.sync(() => sessions),
          stopSession: ({ threadId }) =>
            Effect.sync(() => {
              sessions = sessions.filter((session) => session.threadId !== threadId);
              threads = threads.map((entry) =>
                entry.id !== threadId
                  ? entry
                  : {
                      ...entry,
                      updatedAt: NOW,
                      session: {
                        threadId,
                        providerName: "codex",
                        providerInstanceId: ProviderInstanceId.make("codex"),
                        status: "stopped",
                        activeTurnId: null,
                        lastError: null,
                        runtimeMode: "full-access",
                        updatedAt: NOW,
                      },
                    },
              );
            }),
        }),
        Layer.mock(TerminalManager)({
          subscribeMetadata: (listener) =>
            listener({ type: "snapshot", terminals: terminalList }).pipe(Effect.as(() => {})),
          close: ({ terminalId }) =>
            Effect.sync(() => {
              terminalList = terminalList.filter((terminal) => terminal.terminalId !== terminalId);
            }),
        }),
      ),
    ),
  );
  return {
    ...service,
    fs,
    path,
    git,
    runGit,
    source,
    target,
    removed,
    setThreads: (value: OrchestrationThreadShell[]) => {
      threads = value;
    },
    setArchived: (value: OrchestrationThreadShell[]) => {
      archived = value;
    },
    setRoots: (value: string[]) => {
      roots = value;
    },
    setSessions: (value: ReadonlyArray<ProviderSession>) => {
      sessions = value;
    },
    setTerminals: (value: ReadonlyArray<TerminalSummary>) => {
      terminalList = value;
    },
    onStatus: (fn: () => void) => {
      onStatus = fn;
    },
  };
});

describe("settled worktree retention", () => {
  it("waits seven days after settlement or later activity, including backdated automatic settlement", () => {
    const now = Date.parse(NOW);
    expect(isSettledWorktreeExpired(thread("/managed/task"), now)).toBe(true);
    expect(isSettledWorktreeExpired(thread("/managed/task", { updatedAt: NOW }), now)).toBe(false);
    expect(
      isSettledWorktreeExpired(
        thread("/managed/task"),
        Date.parse(OLD) + SETTLED_WORKTREE_RETENTION_MS - 1,
      ),
    ).toBe(false);
    expect(
      isSettledWorktreeExpired(
        thread("/managed/task"),
        Date.parse(OLD) + SETTLED_WORKTREE_RETENTION_MS,
      ),
    ).toBe(true);
    expect(
      isSettledWorktreeExpired(thread("/managed/task", { settledOverride: "active" }), now),
    ).toBe(false);
    expect(
      isSettledWorktreeExpired(thread("/managed/task", { hasPendingApprovals: true }), now),
    ).toBe(false);
  });
  it.effect(
    "removes the checkout and ignored build files, keeps its branch, and allows recreation",
    () =>
      Effect.gen(function* () {
        const h = yield* harness;
        yield* h.fs.makeDirectory(h.path.join(h.target, "node_modules"));
        yield* h.fs.writeFileString(
          h.path.join(h.target, "node_modules", "build-cache"),
          "build data",
        );
        yield* h.sweep;
        expect(yield* h.fs.exists(h.target)).toBe(false);
        expect(yield* h.runGit(h.source, ["branch", "--list", "task"])).toContain("task");
        expect(yield* h.runGit(h.source, ["worktree", "list", "--porcelain"])).not.toContain(
          h.target,
        );
        yield* h.git.createWorktree({ cwd: h.source, refName: "task", path: h.target });
        expect(yield* h.fs.exists(h.path.join(h.target, "README"))).toBe(true);
      }).pipe(Effect.provide(testLayer)),
  );
  it.effect("keeps uncommitted and untracked files", () =>
    Effect.gen(function* () {
      const h = yield* harness;
      yield* h.fs.writeFileString(h.path.join(h.target, "untracked"), "user data");
      yield* h.sweep;
      expect(yield* h.fs.exists(h.target)).toBe(true);
      expect(h.removed).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );
  it.effect("protects a checkout shared with an active archived thread", () =>
    Effect.gen(function* () {
      const h = yield* harness;
      h.setArchived([
        thread(h.target, {
          id: ThreadId.make("other"),
          archivedAt: OLD,
          settledAt: null,
          settledOverride: null,
        }),
      ]);
      yield* h.sweep;
      expect(h.removed).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );
  it.effect("protects configured project directories and unrelated clones", () =>
    Effect.gen(function* () {
      const h = yield* harness;
      h.setRoots([h.target]);
      yield* h.sweep;
      expect(h.removed).toEqual([]);
      h.setRoots([]);
      h.setThreads([thread(h.source)]);
      yield* h.sweep;
      expect(yield* h.fs.exists(h.source)).toBe(true);
    }).pipe(Effect.provide(testLayer)),
  );
  it.effect("rechecks settlement after inspecting the repository", () =>
    Effect.gen(function* () {
      const h = yield* harness;
      h.onStatus(() =>
        h.setThreads([thread(h.target, { settledAt: null, settledOverride: null })]),
      );
      yield* h.sweep;
      expect(h.removed).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );
  it.effect("lets Git protect locked worktrees without forcing removal", () =>
    Effect.gen(function* () {
      const h = yield* harness;
      yield* h.runGit(h.source, ["worktree", "lock", h.target]);
      yield* h.sweep;
      expect(yield* h.fs.exists(h.target)).toBe(true);
      yield* h.runGit(h.source, ["worktree", "unlock", h.target]);
    }).pipe(Effect.provide(testLayer)),
  );
  it.effect(
    "protects running agents and terminal commands, then closes idle sessions before cleanup",
    () =>
      Effect.gen(function* () {
        const h = yield* harness;
        const session: ProviderSession = {
          threadId,
          provider: ProviderDriverKind.make("codex"),
          runtimeMode: "full-access",
          cwd: h.target,
          status: "running",
          createdAt: OLD,
          updatedAt: OLD,
        };
        h.setSessions([session]);
        yield* h.sweep;
        expect(h.removed).toEqual([]);
        h.setSessions([{ ...session, status: "ready" }]);
        const terminal: TerminalSummary = {
          threadId,
          terminalId: "terminal",
          cwd: h.target,
          worktreePath: h.target,
          status: "running",
          pid: 123,
          exitCode: null,
          exitSignal: null,
          hasRunningSubprocess: true,
          label: "build",
          updatedAt: OLD,
        };
        h.setTerminals([terminal]);
        yield* h.sweep;
        expect(h.removed).toEqual([]);
        h.setTerminals([{ ...terminal, hasRunningSubprocess: false, label: "shell" }]);
        yield* h.sweep;
        expect(yield* h.fs.exists(h.target)).toBe(false);
      }).pipe(Effect.provide(testLayer)),
  );
  it.effect("cleans an archived settled thread too", () =>
    Effect.gen(function* () {
      const h = yield* harness;
      h.setThreads([]);
      h.setArchived([thread(h.target, { archivedAt: OLD })]);
      yield* h.sweep;
      expect(yield* h.fs.exists(h.target)).toBe(false);
    }).pipe(Effect.provide(testLayer)),
  );
});
