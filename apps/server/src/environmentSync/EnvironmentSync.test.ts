import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ENVIRONMENT_SYNC_CHUNK_BYTES,
  CommandId,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type EnvironmentSyncImportResult,
} from "@t3tools/contracts";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as Scope from "effect/Scope";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as GitManager from "../git/GitManager.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import { pendingEnvironmentSyncNote } from "../orchestration-v2/EnvironmentSyncNote.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
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

type EnvironmentServices = Layer.Success<ReturnType<typeof layerEnvironment>>;

const makeEnvironment = Effect.fn(function* (label: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: `t3-sync-${label}-` });
  // macOS temp folders are symlinks. Git reports resolved paths.
  const resolved = yield* fileSystem.realPath(baseDir);
  const context: Context.Context<EnvironmentServices> = yield* Layer.build(
    layerEnvironment({ baseDir: resolved, label }),
  );
  return { label, baseDir: resolved, context };
});

type TestEnvironment = Effect.Success<ReturnType<typeof makeEnvironment>>;

const inEnvironment =
  (environment: TestEnvironment) =>
  <A, E>(effect: Effect.Effect<A, E, EnvironmentServices>) =>
    Effect.provide(effect, environment.context);

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  GitVcsDriver.GitVcsDriver.pipe(
    Effect.flatMap((driver) => driver.execute({ operation: "test", cwd, args })),
    Effect.map((result) => result.stdout.trim()),
  );

const commitAll = Effect.fn(function* (cwd: string, message: string) {
  yield* git(cwd, "config", "user.email", "test@example.com");
  yield* git(cwd, "config", "user.name", "Test");
  yield* git(cwd, "add", ".");
  yield* git(cwd, "commit", "--quiet", "-m", message);
  return yield* git(cwd, "rev-parse", "HEAD");
});

const seedProject = Effect.fn(function* (workspaceRoot: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projects = yield* ProjectService.ProjectService;
  yield* fileSystem.makeDirectory(workspaceRoot, { recursive: true });
  yield* git(workspaceRoot, "init", "--quiet", "--initial-branch=main");
  yield* fileSystem.writeFileString(path.join(workspaceRoot, "README.md"), "one\n");
  yield* fileSystem.writeFileString(path.join(workspaceRoot, ".gitignore"), "ignored.txt\n");
  yield* commitAll(workspaceRoot, "first");
  yield* projects.create({
    commandId: CommandId.make(`seed:${workspaceRoot}`),
    projectId,
    title: "Sync project",
    workspaceRoot,
  });
});

/** What a client does: ask the target, export from the source, relay the parts, import. */
const sync = Effect.fn(function* (input: {
  readonly source: TestEnvironment;
  readonly target: TestEnvironment;
  readonly destinationPath?: string;
  readonly sourceProjectId?: ProjectId;
}) {
  const onSource = inEnvironment(input.source);
  const onTarget = inEnvironment(input.target);
  const service = EnvironmentSync.EnvironmentSync;
  const peer = (environment: TestEnvironment) => ({
    environmentId: EnvironmentId.make(`environment:${environment.label}`),
    label: environment.label,
  });
  const prepared = yield* onTarget(
    Effect.flatMap(service, (target) =>
      target.prepare({
        source: peer(input.source),
        project: {
          projectId: input.sourceProjectId ?? projectId,
          title: "Sync project",
          folderName: "sync-project",
        },
        ...(input.destinationPath === undefined ? {} : { destinationPath: input.destinationPath }),
      }),
    ),
  );
  const exported = yield* onSource(
    Effect.flatMap(service, (source) =>
      source.export({
        projectId: input.sourceProjectId ?? projectId,
        target: peer(input.target),
        gitHaves: prepared.gitHaves,
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
  return status;
});

const importResult = (status: {
  readonly phase: string;
  readonly result?: EnvironmentSyncImportResult;
  readonly message?: string;
}): EnvironmentSyncImportResult => {
  assert.equal(status.phase, "done", status.message);
  return status.result!;
};

const withTwoEnvironments = <A, E>(
  body: (input: {
    readonly laptop: TestEnvironment;
    readonly mini: TestEnvironment;
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>,
) =>
  Effect.gen(function* () {
    const laptop = yield* makeEnvironment("laptop");
    const mini = yield* makeEnvironment("mini");
    return yield* body({ laptop, mini });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

it.effect("copies the project folder and every worktree as they stand", () =>
  withTwoEnvironments(({ laptop, mini }) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sourceRoot = path.join(laptop.baseDir, "code", "sync-project");
      const sourceWorktree = path.join(laptop.baseDir, "elsewhere", "feature-x");
      const destination = path.join(mini.baseDir, "synced", "sync-project");
      const targetWorktree = path.join(mini.baseDir, "worktrees", "sync-project", "feature-x");

      yield* inEnvironment(laptop)(
        Effect.gen(function* () {
          yield* seedProject(sourceRoot);
          yield* git(sourceRoot, "worktree", "add", "-b", "feature/x", sourceWorktree, "main");
          yield* fileSystem.writeFileString(path.join(sourceWorktree, "feature.txt"), "wip\n");
          yield* fileSystem.writeFileString(path.join(sourceRoot, "README.md"), "one\ntwo\n");
          yield* fileSystem.writeFileString(path.join(sourceRoot, "untracked.txt"), "new\n");
          yield* fileSystem.writeFileString(path.join(sourceRoot, "ignored.txt"), "secret\n");
        }),
      );

      const result = importResult(
        yield* sync({ source: laptop, target: mini, destinationPath: destination }),
      );
      assert.isTrue(result.projectCreated);
      assert.equal(result.workspaceRoot, destination);
      assert.equal(result.syncedCheckouts, 2);
      assert.deepEqual(result.warnings, []);

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
          const projects = yield* ProjectService.ProjectService;
          assert.equal(
            Option.getOrThrow(yield* projects.getById(result.projectId)).workspaceRoot,
            destination,
          );
          // The first thread to run here is told where the files came from. A second is not.
          const ask = (threadId: string, cwd: string) =>
            pendingEnvironmentSyncNote({
              fileSystem,
              projects,
              projectId: result.projectId,
              threadId: ThreadId.make(threadId),
              providerTurns: [],
              carriesText: true,
              cwd,
            });
          const note = yield* ask("thread:first", targetWorktree);
          assert.include(note, 'from another machine, "laptop"');
          assert.include(note, sourceWorktree);
          assert.equal(yield* ask("thread:second", destination), "");
        }),
      );

      // Nothing changed, so a second sync replaces nothing.
      const repeated = importResult(yield* sync({ source: laptop, target: mini }));
      assert.isFalse(repeated.projectCreated);
      assert.equal(repeated.syncedCheckouts, 2);
      assert.deepEqual(repeated.warnings, []);
      assert.isNull(repeated.restorePointId);
    }),
  ),
);

it.effect("brings new commits back and can undo what the sync replaced", () =>
  withTwoEnvironments(({ laptop, mini }) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sourceRoot = path.join(laptop.baseDir, "code", "sync-project");
      const destination = path.join(mini.baseDir, "synced", "sync-project");

      yield* inEnvironment(laptop)(seedProject(sourceRoot));
      const first = importResult(
        yield* sync({ source: laptop, target: mini, destinationPath: destination }),
      );

      // Work continues on the second host.
      yield* inEnvironment(mini)(
        Effect.gen(function* () {
          yield* fileSystem.writeFileString(path.join(destination, "second.txt"), "from mini\n");
          yield* commitAll(destination, "second");
        }),
      );
      // Meanwhile the first host has an uncommitted edit that the sync will replace.
      yield* fileSystem.writeFileString(path.join(sourceRoot, "local-note.txt"), "keep me\n");

      const back = importResult(
        yield* sync({ source: mini, target: laptop, sourceProjectId: first.projectId }),
      );
      assert.isNotNull(back.restorePointId);
      assert.isTrue(back.warnings.some((warning) => warning.includes("since the last sync")));
      assert.equal(
        yield* fileSystem.readFileString(path.join(sourceRoot, "second.txt")),
        "from mini\n",
      );
      assert.isFalse(yield* fileSystem.exists(path.join(sourceRoot, "local-note.txt")));

      const undone = yield* inEnvironment(laptop)(
        Effect.flatMap(EnvironmentSync.EnvironmentSync, (service) => service.undo({ projectId })),
      );
      assert.deepEqual(undone.restoredCheckouts, [sourceRoot]);
      assert.equal(
        yield* fileSystem.readFileString(path.join(sourceRoot, "local-note.txt")),
        "keep me\n",
      );
      assert.isFalse(yield* fileSystem.exists(path.join(sourceRoot, "second.txt")));
    }),
  ),
);

it.effect("never rewinds a branch the target moved ahead or took elsewhere", () =>
  withTwoEnvironments(({ laptop, mini }) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sourceRoot = path.join(laptop.baseDir, "code", "sync-project");
      const destination = path.join(mini.baseDir, "synced", "sync-project");

      yield* inEnvironment(laptop)(seedProject(sourceRoot));
      importResult(yield* sync({ source: laptop, target: mini, destinationPath: destination }));

      const ahead = yield* inEnvironment(mini)(
        Effect.gen(function* () {
          yield* fileSystem.writeFileString(path.join(destination, "pulled.txt"), "newer\n");
          return yield* commitAll(destination, "pulled");
        }),
      );
      yield* fileSystem.writeFileString(path.join(sourceRoot, "README.md"), "edited on laptop\n");

      const behind = importResult(yield* sync({ source: laptop, target: mini }));
      assert.equal(behind.syncedCheckouts, 0);
      assert.isTrue(behind.warnings.some((warning) => warning.includes("is ahead of laptop")));
      assert.equal(yield* inEnvironment(mini)(git(destination, "rev-parse", "main")), ahead);
      assert.equal(yield* fileSystem.readFileString(path.join(destination, "README.md")), "one\n");

      // Now both sides have a commit the other lacks.
      const diverged = yield* inEnvironment(laptop)(commitAll(sourceRoot, "laptop work"));
      const split = importResult(yield* sync({ source: laptop, target: mini }));
      assert.equal(split.syncedCheckouts, 0);
      assert.isTrue(split.warnings.some((warning) => warning.includes("different commits")));
      yield* inEnvironment(mini)(
        Effect.gen(function* () {
          assert.equal(yield* git(destination, "rev-parse", "main"), ahead);
          assert.equal(yield* git(destination, "rev-parse", "t3-sync/laptop/main"), diverged);
        }),
      );
    }),
  ),
);
