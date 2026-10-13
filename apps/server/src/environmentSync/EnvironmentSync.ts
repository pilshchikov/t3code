/**
 * EnvironmentSync - copies a project's repository to another environment, and
 * receives one, so a new thread can start on a different host with the same
 * files.
 *
 * Two servers never talk to each other. A client that reaches both asks the
 * target which commits it has, asks the source to export the difference, and
 * relays the bytes. Threads stay where they are.
 *
 * @module EnvironmentSync
 */
import {
  CommandId,
  ENVIRONMENT_SYNC_CHUNK_BYTES,
  ENVIRONMENT_SYNC_DEFAULT_DIRECTORY,
  ENVIRONMENT_SYNC_FORMAT_VERSION,
  ENVIRONMENT_SYNC_ROUTE_PREFIX,
  EnvironmentSyncError,
  ProjectId,
  type EnvironmentSyncAcceptInput,
  type EnvironmentSyncAcceptResult,
  type EnvironmentSyncExportInput,
  type EnvironmentSyncExportResult,
  type EnvironmentSyncImportResult,
  type EnvironmentSyncManifest,
  type EnvironmentSyncPart,
  type EnvironmentSyncPrepareInput,
  type EnvironmentSyncPrepareResult,
  type EnvironmentSyncStatusResult,
  type EnvironmentSyncUndoInput,
  type EnvironmentSyncUndoResult,
} from "@t3tools/contracts";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import { resolveWorktreesDirectory } from "../worktreesDirectory.ts";
import { appendFileChunk, readFileSlice, sha256File } from "./EnvironmentSyncFiles.ts";
import * as EnvironmentSyncGit from "./EnvironmentSyncGit.ts";

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const BUNDLE_PART_ID = "repository";
const ACTIVE_RUN_STATUSES = ["queued", "preparing", "starting", "running", "waiting"] as const;

const isEnvironmentSyncError = Schema.is(EnvironmentSyncError);

interface StoredPart {
  readonly part: EnvironmentSyncPart;
  readonly path: string;
}

interface ExportSession {
  readonly kind: "export";
  readonly id: string;
  readonly createdAt: number;
  readonly directory: string;
  readonly workspaceRoot: string;
  readonly parts: ReadonlyMap<string, StoredPart>;
}

interface ImportSession {
  readonly kind: "import";
  readonly id: string;
  readonly createdAt: number;
  readonly directory: string;
  readonly project: EnvironmentSyncPrepareResult["project"];
  manifest: EnvironmentSyncManifest | null;
  needed: Map<string, StoredPart & { received: number }>;
  status: EnvironmentSyncStatusResult;
  readonly finished: Deferred.Deferred<void>;
}

type Session = ExportSession | ImportSession;

export class EnvironmentSync extends Context.Service<
  EnvironmentSync,
  {
    readonly prepare: (
      input: EnvironmentSyncPrepareInput,
    ) => Effect.Effect<EnvironmentSyncPrepareResult, EnvironmentSyncError>;
    readonly export: (
      input: EnvironmentSyncExportInput,
    ) => Effect.Effect<EnvironmentSyncExportResult, EnvironmentSyncError>;
    readonly accept: (
      input: EnvironmentSyncAcceptInput,
    ) => Effect.Effect<EnvironmentSyncAcceptResult, EnvironmentSyncError>;
    /** Starts the import. It keeps running if the caller disconnects. */
    readonly commit: (sessionId: string) => Effect.Effect<void, EnvironmentSyncError>;
    readonly status: (
      sessionId: string,
    ) => Effect.Effect<EnvironmentSyncStatusResult, EnvironmentSyncError>;
    /** The status once a committed import has ended. */
    readonly awaitImport: (
      sessionId: string,
    ) => Effect.Effect<EnvironmentSyncStatusResult, EnvironmentSyncError>;
    readonly release: (sessionId: string) => Effect.Effect<boolean>;
    readonly undo: (
      input: EnvironmentSyncUndoInput,
    ) => Effect.Effect<EnvironmentSyncUndoResult, EnvironmentSyncError>;
    /** One slice of an exported part, at most a chunk long. Null when the session or part is gone. */
    readonly readPart: (input: {
      readonly sessionId: string;
      readonly partId: string;
      readonly offset: number;
      readonly length: number;
    }) => Effect.Effect<Uint8Array | null, EnvironmentSyncError>;
    /** Appends the next chunk of a part the import asked for. */
    readonly writePart: (input: {
      readonly sessionId: string;
      readonly partId: string;
      readonly offset: number;
      readonly chunk: Uint8Array;
    }) => Effect.Effect<"stored" | "not_found" | "out_of_order", EnvironmentSyncError>;
  }
>()("t3/environmentSync/EnvironmentSync") {}

/** A folder name that is safe on every platform, from a project folder on another host. */
function syncedFolderName(name: string): string {
  const cleaned = [...name]
    .map((character) =>
      '<>:"/\\|?*'.includes(character) || character.charCodeAt(0) < 32 ? "-" : character,
    )
    .join("")
    .replace(/^\.+/, "")
    .trim();
  return cleaned === "" ? "project" : cleaned;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const config = yield* ServerConfig.ServerConfig;
  const settings = yield* ServerSettings.ServerSettingsService;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const projects = yield* ProjectService.ProjectService;
  const git = yield* EnvironmentSyncGit.EnvironmentSyncGit;
  const home = yield* HostProcess.HomeDirectory;

  const sessions = new Map<string, Session>();
  const sessionsDirectory = path.join(config.stateDir, "environment-sync", "sessions");
  // Imports outlive the request that started them but not the server.
  const importScope = yield* Scope.make("parallel");
  yield* Effect.addFinalizer(() => Scope.close(importScope, Exit.void));
  // Sessions live in memory, so files from an earlier process belong to no one.
  yield* fileSystem.remove(sessionsDirectory, { recursive: true, force: true }).pipe(Effect.ignore);

  const fail = (reason: EnvironmentSyncError["reason"], detail: string, cause?: unknown) =>
    new EnvironmentSyncError({ reason, detail, ...(cause === undefined ? {} : { cause }) });
  const storageError = (detail: string) => (cause: unknown) =>
    isEnvironmentSyncError(cause) ? cause : fail("storage_failed", detail, cause);

  const hostLabel = environment.getDescriptor.pipe(Effect.map((descriptor) => descriptor.label));

  const removeSession = (session: Session) =>
    Effect.gen(function* () {
      sessions.delete(session.id);
      yield* fileSystem.remove(session.directory, { recursive: true, force: true });
      if (session.kind === "export") {
        yield* git.releaseExport({ workspaceRoot: session.workspaceRoot, exportId: session.id });
      }
    }).pipe(Effect.ignore);

  const newSession = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    for (const session of sessions.values()) {
      const importing = session.kind === "import" && session.status.phase === "importing";
      if (!importing && now - session.createdAt > SESSION_TTL_MS) yield* removeSession(session);
    }
    const first = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
    const second = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
    const id = `${first}${second}`.replaceAll("-", "");
    const directory = path.join(sessionsDirectory, id);
    yield* fileSystem
      .makeDirectory(directory, { recursive: true })
      .pipe(Effect.mapError(storageError("Could not create a folder for the transfer.")));
    return { id, directory, createdAt: now };
  });

  const importSession = (sessionId: string) =>
    Effect.suspend(() => {
      const session = sessions.get(sessionId);
      return session?.kind === "import"
        ? Effect.succeed(session)
        : Effect.fail(fail("session_not_found", "This transfer expired. Run the sync again."));
    });

  const syncDirectory = settings.getSettings.pipe(
    Effect.map((current) => current.environmentSyncDirectory),
    Effect.orElseSucceed(() => ""),
    Effect.map((setting) =>
      path.resolve(
        expandHomePath(setting === "" ? ENVIRONMENT_SYNC_DEFAULT_DIRECTORY : setting, home),
      ),
    ),
  );

  const worktreesDirectory = settings.getSettings.pipe(
    Effect.map((current) => current.worktreesDirectory),
    Effect.orElseSucceed(() => ""),
    Effect.map(
      (setting) =>
        resolveWorktreesDirectory(setting, config.worktreesDir, path, home) ?? config.worktreesDir,
    ),
  );

  const resolveTargetProject = Effect.fn("EnvironmentSync.resolveTargetProject")(function* (
    input: EnvironmentSyncPrepareInput,
  ) {
    const lookup = (projectId: ProjectId, includeDeleted = false) =>
      projects
        .getById(projectId, { includeDeleted })
        .pipe(Effect.mapError(storageError("Could not read the projects on this machine.")));
    if (input.targetProjectId !== undefined) {
      const chosen = yield* lookup(input.targetProjectId);
      if (Option.isNone(chosen)) {
        return yield* fail("project_not_found", "The project no longer exists on this machine.");
      }
      return {
        projectId: chosen.value.id,
        workspaceRoot: chosen.value.workspaceRoot,
        exists: true,
      };
    }
    const sameId = yield* lookup(input.project.projectId);
    if (Option.isSome(sameId)) {
      return {
        projectId: sameId.value.id,
        workspaceRoot: sameId.value.workspaceRoot,
        exists: true,
      };
    }

    const requested =
      input.destinationPath ??
      path.join(yield* syncDirectory, syncedFolderName(input.project.folderName));
    const expanded = expandHomePath(requested, home);
    if (!path.isAbsolute(expanded)) {
      return yield* fail(
        "destination_unavailable",
        `"${requested}" is not an absolute folder on this machine.`,
      );
    }
    const workspaceRoot = path.resolve(expanded);
    // The lookup only accepts a folder that exists, and no project owns one that does not.
    const owner = (yield* fileSystem.exists(workspaceRoot).pipe(Effect.orElseSucceed(() => false)))
      ? yield* projects
          .getByWorkspaceRoot(workspaceRoot)
          .pipe(Effect.mapError(storageError("Could not read the projects on this machine.")))
      : Option.none();
    if (Option.isSome(owner)) {
      return { projectId: owner.value.id, workspaceRoot: owner.value.workspaceRoot, exists: true };
    }
    // A deleted project keeps its id, so a new one cannot take it.
    const taken = Option.isSome(yield* lookup(input.project.projectId, true));
    return {
      projectId: taken
        ? ProjectId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie))
        : input.project.projectId,
      workspaceRoot,
      exists: false,
    };
  });

  const prepare: EnvironmentSync["Service"]["prepare"] = Effect.fn("EnvironmentSync.prepare")(
    function* (input) {
      const project = yield* resolveTargetProject(input);
      const gitHaves = yield* git.listHaves(project.workspaceRoot);
      const created = yield* newSession;
      sessions.set(created.id, {
        kind: "import",
        ...created,
        project,
        manifest: null,
        needed: new Map(),
        status: { phase: "receiving" },
        finished: yield* Deferred.make<void>(),
      });
      return { transferId: created.id, project, gitHaves };
    },
  );

  const exportProject: EnvironmentSync["Service"]["export"] = Effect.fn("EnvironmentSync.export")(
    function* (input) {
      const project = yield* projects.getById(input.projectId).pipe(
        Effect.mapError(storageError("Could not read the project.")),
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(fail("project_not_found", "The project no longer exists.")),
            onSome: Effect.succeed,
          }),
        ),
      );
      const session = yield* newSession;
      const parts = new Map<string, StoredPart>();
      const stored: ExportSession = {
        kind: "export",
        ...session,
        workspaceRoot: project.workspaceRoot,
        parts,
      };

      const manifest = yield* Effect.gen(function* () {
        const bundlePath = path.join(session.directory, `${BUNDLE_PART_ID}.bundle`);
        const repository = yield* git.exportRepository({
          workspaceRoot: project.workspaceRoot,
          haves: input.gitHaves,
          bundlePath,
          exportId: session.id,
        });
        if (repository.bundleCreated) {
          const info = yield* fileSystem.stat(bundlePath);
          parts.set(BUNDLE_PART_ID, {
            path: bundlePath,
            part: {
              id: BUNDLE_PART_ID,
              sizeBytes: Number(info.size),
              sha256: yield* sha256File(bundlePath),
            },
          });
        }
        return {
          formatVersion: ENVIRONMENT_SYNC_FORMAT_VERSION,
          exportId: session.id,
          createdAt: DateTime.formatIso(yield* DateTime.now),
          source: { environmentId: yield* environment.getEnvironmentId, label: yield* hostLabel },
          project: {
            projectId: project.id,
            title: project.title,
            workspaceRoot: project.workspaceRoot,
          },
          git: {
            ...repository.git,
            bundlePartId: repository.bundleCreated ? BUNDLE_PART_ID : null,
          },
          parts: [...parts.values()].map((entry) => entry.part),
        } satisfies EnvironmentSyncManifest;
      }).pipe(
        Effect.mapError(storageError("Could not export the project.")),
        Effect.onExit((exit) =>
          Exit.isSuccess(exit)
            ? Effect.sync(() => {
                sessions.set(session.id, stored);
              })
            : removeSession(stored),
        ),
      );
      return { manifest, downloadPath: `${ENVIRONMENT_SYNC_ROUTE_PREFIX}/${session.id}` };
    },
  );

  const accept: EnvironmentSync["Service"]["accept"] = Effect.fn("EnvironmentSync.accept")(
    function* (input) {
      const session = yield* importSession(input.transferId);
      if (input.manifest.formatVersion !== ENVIRONMENT_SYNC_FORMAT_VERSION) {
        return yield* fail(
          "incompatible",
          `${input.manifest.source.label} runs a different T3 Code version. Update both machines to the same version.`,
        );
      }
      const needed = new Map<string, StoredPart & { received: number }>();
      for (const part of input.manifest.parts) {
        needed.set(part.id, {
          part,
          path: path.join(session.directory, `${part.id}.part`),
          received: 0,
        });
      }
      session.manifest = input.manifest;
      session.needed = needed;
      return {
        neededPartIds: [...needed.keys()],
        uploadPath: `${ENVIRONMENT_SYNC_ROUTE_PREFIX}/${session.id}`,
      };
    },
  );

  const readPart: EnvironmentSync["Service"]["readPart"] = (input) =>
    Effect.suspend(() => {
      const session = sessions.get(input.sessionId);
      const stored = session?.kind === "export" ? session.parts.get(input.partId) : undefined;
      if (stored === undefined) return Effect.succeed(null);
      const length = Math.min(
        Math.max(0, input.length),
        ENVIRONMENT_SYNC_CHUNK_BYTES,
        Math.max(0, stored.part.sizeBytes - input.offset),
      );
      return readFileSlice(stored.path, input.offset, length).pipe(
        Effect.mapError(storageError("Could not read the exported data.")),
      );
    });

  const writePart: EnvironmentSync["Service"]["writePart"] = (input) =>
    Effect.suspend(() => {
      const session = sessions.get(input.sessionId);
      const stored = session?.kind === "import" ? session.needed.get(input.partId) : undefined;
      if (session?.kind !== "import" || stored === undefined) {
        return Effect.succeed("not_found" as const);
      }
      if (
        session.status.phase !== "receiving" ||
        input.offset !== stored.received ||
        stored.received + input.chunk.byteLength > stored.part.sizeBytes
      ) {
        return Effect.succeed("out_of_order" as const);
      }
      // Claimed before the write so two requests cannot append the same range.
      stored.received += input.chunk.byteLength;
      return appendFileChunk(stored.path, input.chunk).pipe(
        Effect.as("stored" as const),
        Effect.mapError(storageError("Could not store the received data.")),
      );
    });

  const runImport = Effect.fn("EnvironmentSync.runImport")(function* (
    session: ImportSession,
    manifest: EnvironmentSyncManifest,
  ) {
    const host = yield* hostLabel;
    const root = session.project.workspaceRoot;
    const planned = yield* git.planCheckouts({
      workspaceRoot: root,
      worktreesDirectory: yield* worktreesDirectory,
      workspaces: manifest.git.workspaces,
    });
    // A turn in progress keeps its files. The rest of the project still syncs.
    const activeHere = yield* sql<{ readonly worktree_path: string | null }>`
      SELECT DISTINCT json_extract(thread.payload_json, '$.worktreePath') AS worktree_path
      FROM orchestration_v2_projection_runs AS run
      JOIN orchestration_v2_projection_threads AS thread ON thread.thread_id = run.thread_id
      WHERE thread.project_id = ${session.project.projectId}
        AND thread.deleted_at IS NULL
        AND run.status IN ${sql.in(ACTIVE_RUN_STATUSES)}
    `;
    const busyPaths = new Set(activeHere.map((row) => row.worktree_path ?? root));
    const bundle =
      manifest.git.bundlePartId === null
        ? undefined
        : session.needed.get(manifest.git.bundlePartId);
    const applied = yield* git.applyRepository({
      projectId: session.project.projectId,
      workspaceRoot: root,
      sourceWorkspaceRoot: manifest.project.workspaceRoot,
      sourceLabel: manifest.source.label,
      hostLabel: host,
      git: manifest.git,
      bundlePath: bundle?.path ?? null,
      exportId: manifest.exportId,
      checkouts: planned.map((plan) =>
        plan.skip === null && busyPaths.has(plan.targetPath)
          ? {
              ...plan,
              skip: `A turn is running in ${plan.targetPath} on ${host}, so that checkout was left as it is.`,
            }
          : plan,
      ),
    });

    if (!session.project.exists) {
      yield* projects.create({
        commandId: CommandId.make(`environment-sync-create:${session.id}`),
        projectId: session.project.projectId,
        title: manifest.project.title,
        workspaceRoot: root,
        createWorkspaceRootIfMissing: true,
      });
    }

    return {
      projectId: session.project.projectId,
      workspaceRoot: root,
      projectCreated: !session.project.exists,
      syncedCheckouts: applied.syncedCheckouts,
      warnings: applied.warnings,
      restorePointId: applied.restorePointId,
    } satisfies EnvironmentSyncImportResult;
  });

  const commit: EnvironmentSync["Service"]["commit"] = Effect.fn("EnvironmentSync.commit")(
    function* (sessionId) {
      const session = yield* importSession(sessionId);
      if (session.status.phase !== "receiving") return;
      const manifest = session.manifest;
      if (manifest === null) {
        return yield* fail("incomplete_transfer", "The transfer was not accepted first.");
      }
      for (const stored of session.needed.values()) {
        const complete =
          stored.received === stored.part.sizeBytes &&
          (yield* sha256File(stored.path).pipe(Effect.orElseSucceed(() => ""))) ===
            stored.part.sha256;
        if (!complete) {
          return yield* fail(
            "incomplete_transfer",
            "The data did not arrive completely. Run the sync again.",
          );
        }
      }
      session.status = { phase: "importing" };
      yield* runImport(session, manifest).pipe(
        Effect.mapError(storageError("Could not import the project.")),
        Effect.matchCauseEffect({
          onSuccess: (result) =>
            Effect.sync(() => {
              session.status = { phase: "done", result };
            }),
          onFailure: (cause) =>
            Effect.logError("environment sync import failed", { cause }).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  session.status = {
                    phase: "failed",
                    message: Option.match(Cause.findErrorOption(cause), {
                      onNone: () => "The import stopped unexpectedly.",
                      onSome: (error) => error.detail,
                    }),
                  };
                }),
              ),
            ),
        }),
        Effect.ensuring(
          fileSystem
            .remove(session.directory, { recursive: true, force: true })
            .pipe(Effect.ignore),
        ),
        Effect.ensuring(Deferred.succeed(session.finished, undefined)),
        Effect.forkIn(importScope),
      );
    },
  );

  const status: EnvironmentSync["Service"]["status"] = (sessionId) =>
    importSession(sessionId).pipe(Effect.map((session) => session.status));

  const awaitImport: EnvironmentSync["Service"]["awaitImport"] = (sessionId) =>
    importSession(sessionId).pipe(
      Effect.flatMap((session) =>
        Deferred.await(session.finished).pipe(Effect.map(() => session.status)),
      ),
    );

  const release: EnvironmentSync["Service"]["release"] = (sessionId) =>
    Effect.suspend(() => {
      const session = sessions.get(sessionId);
      if (session === undefined) return Effect.succeed(false);
      // A running import owns its files and removes them itself.
      if (session.kind === "import" && session.status.phase === "importing") {
        return Effect.succeed(false);
      }
      return removeSession(session).pipe(Effect.as(true));
    });

  return EnvironmentSync.of({
    prepare,
    export: exportProject,
    accept,
    commit,
    status,
    awaitImport,
    release,
    undo: (input) => git.undo(input),
    readPart,
    writePart,
  });
});

export const layer = Layer.effect(EnvironmentSync, make);
