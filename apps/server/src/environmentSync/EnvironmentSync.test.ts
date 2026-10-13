import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ENVIRONMENT_SYNC_CHUNK_BYTES,
  CommandId,
  EnvironmentId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
  type EnvironmentSyncImportResult,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import type * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as GitManager from "../git/GitManager.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as LegacyV1ThreadImporter from "../orchestration-v2/legacy/LegacyV1ThreadImporter.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as ThreadCommandExecutor from "../orchestration-v2/ThreadCommandExecutor.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectEnrichmentService from "../project/ProjectEnrichmentService.ts";
import * as ProjectFaviconResolver from "../project/ProjectFaviconResolver.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as EnvironmentSync from "./EnvironmentSync.ts";
import * as EnvironmentSyncGit from "./EnvironmentSyncGit.ts";

const providerInstanceId = ProviderInstanceId.make("codex");
const driver = ProviderDriverKind.make("codex");
const modelSelection = {
  instanceId: providerInstanceId,
  model: "gpt-5.4",
} satisfies ModelSelection;
const projectId = ProjectId.make("project:sync");

const layerVcsRegistry = VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcess.layer));

const layerEnrichment = ProjectEnrichmentService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
        resolve: () => Effect.succeed(null),
      }),
      Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
        resolvePath: () => Effect.succeed(null),
      }),
    ),
  ),
);

/** One environment: its own database, data dir, and synced projects folder. */
const layerEnvironment = (input: { readonly baseDir: string; readonly label: string }) =>
  EnvironmentSync.layer.pipe(
    Layer.provide(EnvironmentSyncGit.layer),
    Layer.provideMerge(RuntimeLayer.layerProjectService),
    Layer.provideMerge(RuntimeLayer.layerEventSink),
    Layer.provideMerge(
      EventStore.layerFromOrchestrationEventStore.pipe(
        Layer.provide(RuntimeLayer.layerEventInfrastructure),
      ),
    ),
    Layer.provideMerge(ProjectionStore.layer),
    Layer.provideMerge(ThreadCommandExecutor.layer),
    Layer.provide(
      Layer.mock(LegacyV1ThreadImporter.LegacyV1ThreadImporter)({
        ensureTranscript: () => Effect.succeed({ importedThreadCount: 0, importedMessageCount: 0 }),
      }),
    ),
    Layer.provide(
      Layer.succeed(ServerEnvironment.ServerEnvironment, {
        getEnvironmentId: Effect.succeed(EnvironmentId.make(`environment:${input.label}`)),
        getDescriptor: Effect.succeed({
          environmentId: EnvironmentId.make(`environment:${input.label}`),
          label: input.label,
          platform: { os: "darwin" as const, arch: "arm64" as const },
          serverVersion: "0.0.0-test",
          capabilities: { repositoryIdentity: false },
        }),
      }),
    ),
    Layer.provideMerge(CheckpointStore.layer.pipe(Layer.provide(layerVcsRegistry))),
    Layer.provideMerge(layerEnrichment),
    Layer.provideMerge(WorkspacePaths.layer),
    Layer.provideMerge(
      GitWorkflow.layer.pipe(
        Layer.provide(layerVcsRegistry),
        Layer.provide(Layer.mock(GitManager.GitManager)({})),
      ),
    ),
    Layer.provideMerge(GitVcsDriver.layer.pipe(Layer.provide(VcsProcess.layer))),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provideMerge(ServerConfig.layerTest(input.baseDir, input.baseDir)),
    Layer.provideMerge(NodeServices.layer),
  );

type EnvironmentContext = Context.Context<Layer.Success<ReturnType<typeof layerEnvironment>>>;

const makeEnvironment = Effect.fn(function* (label: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: `t3-sync-${label}-` });
  // macOS temp folders are symlinks. Git reports resolved paths.
  const resolved = yield* fileSystem.realPath(baseDir);
  const context = yield* Layer.build(layerEnvironment({ baseDir: resolved, label }));
  return { label, baseDir: resolved, context };
});

type TestEnvironment = Effect.Success<ReturnType<typeof makeEnvironment>>;

const inEnvironment =
  (environment: TestEnvironment) =>
  <A, E>(effect: Effect.Effect<A, E, Layer.Success<ReturnType<typeof layerEnvironment>>>) =>
    Effect.provide(effect, environment.context as EnvironmentContext);

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  GitVcsDriver.GitVcsDriver.pipe(
    Effect.flatMap((driver_) => driver_.execute({ operation: "test", cwd, args })),
    Effect.map((result) => result.stdout.trim()),
  );

function makeThread(input: {
  readonly threadId: ThreadId;
  readonly now: DateTime.Utc;
  readonly branch?: string | null;
  readonly worktreePath?: string | null;
}): OrchestrationV2AppThread {
  return {
    createdBy: "user",
    creationSource: "web",
    id: input.threadId,
    projectId,
    title: `Thread ${input.threadId}`,
    providerInstanceId,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: input.branch ?? null,
    worktreePath: input.worktreePath ?? null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: input.threadId },
    forkedFrom: null,
    createdAt: input.now,
    updatedAt: input.now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

/** One completed run with a user message and an assistant reply. */
function runEvents(input: {
  readonly prefix: string;
  readonly threadId: ThreadId;
  readonly ordinal: number;
  readonly now: DateTime.Utc;
  readonly nativeThreadId: string;
  readonly text: string;
}): ReadonlyArray<OrchestrationV2DomainEvent> {
  const key = `${input.prefix}:${input.threadId}:${input.ordinal}`;
  const runId = RunId.make(`run:${key}`);
  const providerThreadId = ProviderThreadId.make(`provider-thread:${input.threadId}`);
  const userMessageId = MessageId.make(`message:${key}:user`);
  const assistantMessageId = MessageId.make(`message:${key}:assistant`);
  const base = { threadId: input.threadId, occurredAt: input.now };
  const item = {
    threadId: input.threadId,
    runId,
    nodeId: null,
    providerThreadId,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    status: "completed" as const,
    title: null,
    startedAt: input.now,
    completedAt: input.now,
    updatedAt: input.now,
  };
  const message = {
    threadId: input.threadId,
    runId,
    nodeId: null,
    attachments: [],
    streaming: false,
    createdAt: input.now,
    updatedAt: input.now,
  };
  return [
    {
      ...base,
      id: EventId.make(`event:${key}:run`),
      type: "run.created",
      payload: {
        id: runId,
        threadId: input.threadId,
        ordinal: input.ordinal,
        providerInstanceId,
        modelSelection,
        providerThreadId,
        userMessageId,
        rootNodeId: null,
        activeAttemptId: null,
        status: "completed",
        requestedAt: input.now,
        startedAt: input.now,
        completedAt: input.now,
        checkpointId: null,
        contextHandoffId: null,
      },
    },
    {
      ...base,
      id: EventId.make(`event:${key}:provider-thread`),
      type: "provider-thread.updated",
      payload: {
        id: providerThreadId,
        driver,
        providerInstanceId,
        providerSessionId: null,
        appThreadId: input.threadId,
        ownerNodeId: null,
        nativeThreadRef: { driver, nativeId: input.nativeThreadId, strength: "strong" },
        nativeConversationHeadRef: null,
        status: "idle",
        firstRunOrdinal: 1,
        lastRunOrdinal: input.ordinal,
        handoffIds: [],
        forkedFrom: null,
        pendingBackgroundTasks: [],
        contextUsage: null,
        nativeMetadata: null,
        goal: null,
        createdAt: input.now,
        updatedAt: input.now,
      },
    },
    {
      ...base,
      id: EventId.make(`event:${key}:user-message`),
      type: "message.updated",
      payload: {
        ...message,
        createdBy: "user",
        creationSource: "web",
        id: userMessageId,
        role: "user",
        text: input.text,
      },
    },
    {
      ...base,
      id: EventId.make(`event:${key}:user-item`),
      type: "turn-item.updated",
      payload: {
        ...item,
        id: TurnItemId.make(`item:${key}:user`),
        ordinal: input.ordinal * 1_000_000 + 1,
        createdBy: "user",
        creationSource: "web",
        type: "user_message",
        messageId: userMessageId,
        inputIntent: "turn_start",
        text: input.text,
        attachments: [],
      },
    },
    {
      ...base,
      id: EventId.make(`event:${key}:assistant-message`),
      type: "message.updated",
      payload: {
        ...message,
        createdBy: "agent",
        creationSource: "provider",
        id: assistantMessageId,
        role: "assistant",
        text: `Reply to ${input.text}`,
      },
    },
    {
      ...base,
      id: EventId.make(`event:${key}:assistant-item`),
      type: "turn-item.updated",
      payload: {
        ...item,
        id: TurnItemId.make(`item:${key}:assistant`),
        ordinal: input.ordinal * 1_000_000 + 2,
        type: "assistant_message",
        messageId: assistantMessageId,
        text: `Reply to ${input.text}`,
        streaming: false,
      },
    },
  ];
}

const seedProject = Effect.fn(function* (workspaceRoot: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projects = yield* ProjectService.ProjectService;
  yield* fileSystem.makeDirectory(workspaceRoot, { recursive: true });
  yield* git(workspaceRoot, "init", "--quiet", "--initial-branch=main");
  yield* git(workspaceRoot, "config", "user.email", "test@example.com");
  yield* git(workspaceRoot, "config", "user.name", "Test");
  yield* fileSystem.writeFileString(path.join(workspaceRoot, "README.md"), "one\n");
  yield* fileSystem.writeFileString(path.join(workspaceRoot, ".gitignore"), "ignored.txt\n");
  yield* git(workspaceRoot, "add", ".");
  yield* git(workspaceRoot, "commit", "--quiet", "-m", "first");
  yield* projects.create({
    commandId: CommandId.make(`seed:${workspaceRoot}`),
    projectId,
    title: "Sync project",
    workspaceRoot,
  });
});

const seedThread = Effect.fn(function* (input: {
  readonly threadId: ThreadId;
  readonly branch?: string | null;
  readonly worktreePath?: string | null;
}) {
  const eventSink = yield* EventSink.EventSinkV2;
  const now = yield* DateTime.now;
  const thread = makeThread({ ...input, now });
  yield* eventSink.write({
    events: [
      {
        id: EventId.make(`event:${input.threadId}:created`),
        type: "thread.created",
        threadId: input.threadId,
        providerInstanceId,
        occurredAt: now,
        payload: thread,
      },
      ...runEvents({
        prefix: "seed",
        threadId: input.threadId,
        ordinal: 1,
        now,
        nativeThreadId: `native:${input.threadId}:origin`,
        text: "first prompt",
      }),
    ],
  });
});

/** What a client does: ask the target, export from the source, relay the parts, import. */
const sync = Effect.fn(function* (input: {
  readonly source: TestEnvironment;
  readonly target: TestEnvironment;
  readonly rootThreadIds: ReadonlyArray<ThreadId>;
  readonly destinationPath?: string;
  readonly sourceProjectId?: ProjectId;
}) {
  const onSource = inEnvironment(input.source);
  const onTarget = inEnvironment(input.target);
  const service = EnvironmentSync.EnvironmentSync;
  const prepared = yield* onTarget(
    Effect.flatMap(service, (target) =>
      target.prepare({
        source: {
          environmentId: EnvironmentId.make(`environment:${input.source.label}`),
          label: input.source.label,
        },
        project: {
          projectId: input.sourceProjectId ?? projectId,
          title: "Sync project",
          folderName: "sync-project",
        },
        ...(input.destinationPath === undefined ? {} : { destinationPath: input.destinationPath }),
        rootThreadIds: input.rootThreadIds,
      }),
    ),
  );
  const exported = yield* onSource(
    Effect.flatMap(service, (source) =>
      source.export({
        projectId: input.sourceProjectId ?? projectId,
        rootThreadIds: input.rootThreadIds,
        target: {
          environmentId: EnvironmentId.make(`environment:${input.target.label}`),
          label: input.target.label,
        },
        gitHaves: prepared.gitHaves,
        threadHeads: prepared.threadHeads,
      }),
    ),
  );
  const accepted = yield* onTarget(
    Effect.flatMap(service, (target) =>
      target.accept({ transferId: prepared.transferId, manifest: exported.manifest }),
    ),
  );
  for (const partId of accepted.neededPartIds) {
    const part = exported.manifest.parts.find((candidate) => candidate.id === partId)!;
    for (let offset = 0; offset < part.sizeBytes; offset += ENVIRONMENT_SYNC_CHUNK_BYTES) {
      const chunk = yield* onSource(
        Effect.flatMap(service, (source) =>
          source.readPart({
            sessionId: exported.manifest.exportId,
            partId,
            offset,
            length: ENVIRONMENT_SYNC_CHUNK_BYTES,
          }),
        ),
      );
      assert.isNotNull(chunk);
      const stored = yield* onTarget(
        Effect.flatMap(service, (target) =>
          target.writePart({ sessionId: prepared.transferId, partId, offset, chunk: chunk! }),
        ),
      );
      assert.equal(stored, "stored");
    }
  }
  const status = yield* onTarget(
    Effect.flatMap(service, (target) =>
      target
        .commit(prepared.transferId)
        .pipe(Effect.andThen(target.awaitImport(prepared.transferId))),
    ),
  );
  yield* onSource(Effect.flatMap(service, (source) => source.release(exported.manifest.exportId)));
  return { manifest: exported.manifest, plans: accepted.threads, status };
});

const importResult = (status: {
  readonly phase: string;
  readonly result?: EnvironmentSyncImportResult;
  readonly message?: string;
}): EnvironmentSyncImportResult => {
  assert.equal(status.phase, "done", status.message);
  return status.result!;
};

const messageTexts = (threadId: ThreadId) =>
  ProjectionStore.ProjectionStoreV2.pipe(
    Effect.flatMap((store) => store.getThreadProjection(threadId)),
    Effect.map((projection) => projection.messages.map((message) => message.text)),
  );

const withTwoEnvironments = <A, E>(
  body: (input: {
    readonly laptop: TestEnvironment;
    readonly mini: TestEnvironment;
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | import("effect/Scope").Scope>,
) =>
  Effect.gen(function* () {
    const laptop = yield* makeEnvironment("laptop");
    const mini = yield* makeEnvironment("mini");
    return yield* body({ laptop, mini });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

it.effect("copies a project with its threads, branches, and uncommitted work to a new host", () =>
  withTwoEnvironments(({ laptop, mini }) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sourceRoot = path.join(laptop.baseDir, "code", "sync-project");
      const sourceWorktree = path.join(laptop.baseDir, "worktrees", "sync-project", "feature-x");
      const destination = path.join(mini.baseDir, "synced", "sync-project");
      const rootThread = ThreadId.make("thread:root");
      const worktreeThread = ThreadId.make("thread:worktree");

      yield* inEnvironment(laptop)(
        Effect.gen(function* () {
          yield* seedProject(sourceRoot);
          yield* git(sourceRoot, "worktree", "add", "-b", "feature/x", sourceWorktree, "main");
          yield* fileSystem.writeFileString(path.join(sourceWorktree, "feature.txt"), "wip\n");
          yield* fileSystem.writeFileString(path.join(sourceRoot, "README.md"), "one\ntwo\n");
          yield* fileSystem.writeFileString(path.join(sourceRoot, "untracked.txt"), "new\n");
          yield* fileSystem.writeFileString(path.join(sourceRoot, "ignored.txt"), "secret\n");
          yield* seedThread({ threadId: rootThread, branch: "main" });
          yield* seedThread({
            threadId: worktreeThread,
            branch: "feature/x",
            worktreePath: sourceWorktree,
          });
        }),
      );

      const first = yield* sync({
        source: laptop,
        target: mini,
        rootThreadIds: [rootThread, worktreeThread],
        destinationPath: destination,
      });
      const result = importResult(first.status);
      assert.isTrue(result.projectCreated);
      assert.equal(result.workspaceRoot, destination);
      assert.deepEqual(
        result.threads.map((thread) => thread.action),
        ["import", "import"],
      );

      const targetWorktree = path.join(mini.baseDir, "worktrees", "sync-project", "feature-x");
      assert.equal(
        yield* fileSystem.readFileString(path.join(destination, "README.md")),
        "one\ntwo\n",
      );
      assert.equal(
        yield* fileSystem.readFileString(path.join(destination, "untracked.txt")),
        "new\n",
      );
      assert.isFalse(yield* fileSystem.exists(path.join(destination, "ignored.txt")));
      assert.equal(
        yield* fileSystem.readFileString(path.join(targetWorktree, "feature.txt")),
        "wip\n",
      );

      yield* inEnvironment(mini)(
        Effect.gen(function* () {
          assert.equal(yield* git(destination, "symbolic-ref", "--short", "HEAD"), "main");
          // Uncommitted work arrives uncommitted.
          assert.include(yield* git(destination, "status", "--porcelain"), "README.md");
          assert.equal(yield* git(targetWorktree, "symbolic-ref", "--short", "HEAD"), "feature/x");

          const store = yield* ProjectionStore.ProjectionStoreV2;
          const root = yield* store.getThread(rootThread);
          assert.equal(root.projectId, result.projectId);
          assert.equal(root.environmentSync?.origin.label, "laptop");
          assert.equal(root.environmentSync?.host.label, "mini");
          assert.equal(root.environmentSync?.originWorkspacePath, sourceRoot);
          assert.equal(root.environmentSync?.afterRunOrdinal, 1);
          assert.deepEqual(root.environmentSync?.staleNativeThreadIds, [
            `native:${rootThread}:origin`,
          ]);
          assert.equal((yield* store.getThread(worktreeThread)).worktreePath, targetWorktree);
          assert.deepEqual(yield* messageTexts(rootThread), [
            "first prompt",
            "Reply to first prompt",
          ]);
        }),
      );

      // Nothing changed, so a second sync moves nothing.
      const second = yield* sync({
        source: laptop,
        target: mini,
        rootThreadIds: [rootThread, worktreeThread],
      });
      assert.deepEqual(
        importResult(second.status).threads.map((thread) => [
          thread.action,
          thread.importedEventCount,
        ]),
        [
          ["up_to_date", 0],
          ["up_to_date", 0],
        ],
      );
      const repeated = importResult(second.status);
      assert.deepEqual(repeated.warnings, []);
      assert.isNull(repeated.restorePointId);
    }),
  ),
);

it.effect("sends new turns back and can undo what the sync replaced", () =>
  withTwoEnvironments(({ laptop, mini }) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sourceRoot = path.join(laptop.baseDir, "code", "sync-project");
      const destination = path.join(mini.baseDir, "synced", "sync-project");
      const threadId = ThreadId.make("thread:round-trip");

      yield* inEnvironment(laptop)(
        Effect.gen(function* () {
          yield* seedProject(sourceRoot);
          yield* seedThread({ threadId, branch: "main" });
        }),
      );
      importResult(
        (yield* sync({
          source: laptop,
          target: mini,
          rootThreadIds: [threadId],
          destinationPath: destination,
        })).status,
      );

      // Work continues on the second host: a new turn and a new commit.
      const targetProjectId = yield* inEnvironment(mini)(
        Effect.gen(function* () {
          const eventSink = yield* EventSink.EventSinkV2;
          yield* eventSink.write({
            events: runEvents({
              prefix: "mini",
              threadId,
              ordinal: 2,
              now: yield* DateTime.now,
              nativeThreadId: `native:${threadId}:mini`,
              text: "second prompt",
            }),
          });
          yield* git(destination, "config", "user.email", "test@example.com");
          yield* git(destination, "config", "user.name", "Test");
          yield* fileSystem.writeFileString(path.join(destination, "second.txt"), "from mini\n");
          yield* git(destination, "add", ".");
          yield* git(destination, "commit", "--quiet", "-m", "second");
          return (yield* (yield* ProjectionStore.ProjectionStoreV2).getThread(threadId)).projectId;
        }),
      );
      // Meanwhile the first host has an uncommitted edit that the sync will replace.
      yield* fileSystem.writeFileString(path.join(sourceRoot, "local-note.txt"), "keep me\n");

      const back = yield* sync({
        source: mini,
        target: laptop,
        rootThreadIds: [threadId],
        sourceProjectId: targetProjectId,
      });
      const result = importResult(back.status);
      assert.deepEqual(
        result.threads.map((thread) => thread.action),
        ["import"],
      );
      assert.isNotNull(result.restorePointId);
      assert.isTrue(result.warnings.some((warning) => warning.includes("since the last sync")));
      assert.equal(
        yield* fileSystem.readFileString(path.join(sourceRoot, "second.txt")),
        "from mini\n",
      );
      assert.isFalse(yield* fileSystem.exists(path.join(sourceRoot, "local-note.txt")));

      yield* inEnvironment(laptop)(
        Effect.gen(function* () {
          assert.deepEqual(yield* messageTexts(threadId), [
            "first prompt",
            "Reply to first prompt",
            "second prompt",
            "Reply to second prompt",
          ]);
          const thread = yield* (yield* ProjectionStore.ProjectionStoreV2).getThread(threadId);
          assert.equal(thread.projectId, projectId);
          assert.equal(thread.environmentSync?.origin.label, "mini");
          assert.equal(thread.environmentSync?.afterRunOrdinal, 2);
          // Only the session created on the other host is stale here.
          assert.deepEqual(thread.environmentSync?.staleNativeThreadIds, [
            `native:${threadId}:mini`,
          ]);

          const undone = yield* (yield* EnvironmentSync.EnvironmentSync).undo({ projectId });
          assert.deepEqual(undone.restoredCheckouts, [sourceRoot]);
        }),
      );
      assert.equal(
        yield* fileSystem.readFileString(path.join(sourceRoot, "local-note.txt")),
        "keep me\n",
      );
      assert.isFalse(yield* fileSystem.exists(path.join(sourceRoot, "second.txt")));
    }),
  ),
);

it.effect("leaves both copies alone when a thread changed on both hosts", () =>
  withTwoEnvironments(({ laptop, mini }) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sourceRoot = path.join(laptop.baseDir, "code", "sync-project");
      const destination = path.join(mini.baseDir, "synced", "sync-project");
      const threadId = ThreadId.make("thread:diverged");

      yield* inEnvironment(laptop)(
        Effect.gen(function* () {
          yield* seedProject(sourceRoot);
          yield* seedThread({ threadId, branch: "main" });
        }),
      );
      importResult(
        (yield* sync({
          source: laptop,
          target: mini,
          rootThreadIds: [threadId],
          destinationPath: destination,
        })).status,
      );

      for (const environment of [laptop, mini]) {
        yield* inEnvironment(environment)(
          Effect.gen(function* () {
            const eventSink = yield* EventSink.EventSinkV2;
            yield* eventSink.write({
              events: runEvents({
                prefix: environment.label,
                threadId,
                ordinal: 2,
                now: yield* DateTime.now,
                nativeThreadId: `native:${threadId}:${environment.label}`,
                text: `prompt on ${environment.label}`,
              }),
            });
          }),
        );
      }
      yield* fileSystem.writeFileString(path.join(destination, "mini-only.txt"), "mini\n");

      const again = yield* sync({ source: laptop, target: mini, rootThreadIds: [threadId] });
      const result = importResult(again.status);
      assert.deepEqual(
        result.threads.map((thread) => [thread.action, thread.importedEventCount]),
        [["diverged", 0]],
      );
      // The checkout the diverged thread works in is not replaced either.
      assert.equal(
        yield* fileSystem.readFileString(path.join(destination, "mini-only.txt")),
        "mini\n",
      );
      assert.deepEqual(yield* inEnvironment(mini)(messageTexts(threadId)), [
        "first prompt",
        "Reply to first prompt",
        "prompt on mini",
        "Reply to prompt on mini",
      ]);
    }),
  ),
);

it.effect("never rewinds a branch the target has moved ahead", () =>
  withTwoEnvironments(({ laptop, mini }) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sourceRoot = path.join(laptop.baseDir, "code", "sync-project");
      const destination = path.join(mini.baseDir, "synced", "sync-project");
      const threadId = ThreadId.make("thread:ahead");

      yield* inEnvironment(laptop)(
        Effect.gen(function* () {
          yield* seedProject(sourceRoot);
          yield* seedThread({ threadId, branch: "main" });
        }),
      );
      importResult(
        (yield* sync({
          source: laptop,
          target: mini,
          rootThreadIds: [threadId],
          destinationPath: destination,
        })).status,
      );

      const ahead = yield* inEnvironment(mini)(
        Effect.gen(function* () {
          yield* git(destination, "config", "user.email", "test@example.com");
          yield* git(destination, "config", "user.name", "Test");
          yield* fileSystem.writeFileString(path.join(destination, "pulled.txt"), "newer\n");
          yield* git(destination, "add", ".");
          yield* git(destination, "commit", "--quiet", "-m", "pulled");
          return yield* git(destination, "rev-parse", "main");
        }),
      );
      // A new turn on the first host, so the thread itself still moves forward.
      yield* inEnvironment(laptop)(
        Effect.gen(function* () {
          const eventSink = yield* EventSink.EventSinkV2;
          yield* eventSink.write({
            events: runEvents({
              prefix: "laptop",
              threadId,
              ordinal: 2,
              now: yield* DateTime.now,
              nativeThreadId: `native:${threadId}:origin`,
              text: "second prompt",
            }),
          });
        }),
      );
      yield* fileSystem.writeFileString(path.join(sourceRoot, "README.md"), "edited on laptop\n");

      const again = yield* sync({ source: laptop, target: mini, rootThreadIds: [threadId] });
      const result = importResult(again.status);
      assert.deepEqual(
        result.threads.map((thread) => thread.action),
        ["import"],
      );
      assert.isTrue(result.warnings.some((warning) => warning.includes("is ahead of laptop")));
      yield* inEnvironment(mini)(
        Effect.gen(function* () {
          assert.equal(yield* git(destination, "rev-parse", "main"), ahead);
          const thread = yield* (yield* ProjectionStore.ProjectionStoreV2).getThread(threadId);
          assert.isTrue(
            thread.environmentSync?.notes.some((note) => note.includes("were not applied")),
          );
        }),
      );
      assert.equal(
        yield* fileSystem.readFileString(path.join(destination, "pulled.txt")),
        "newer\n",
      );
      assert.equal(yield* fileSystem.readFileString(path.join(destination, "README.md")), "one\n");
    }),
  ),
);
