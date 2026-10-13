/**
 * EnvironmentSync - copies a project and its threads to another environment,
 * and receives one.
 *
 * Two servers never talk to each other. A client that reaches both asks the
 * target what it already has, asks the source to export the difference, and
 * relays the bytes. Threads travel as their orchestration events, so a copy
 * replays into the same timeline. A thread only moves forward. The target
 * takes events when its own copy is a prefix of the source's.
 *
 * @module EnvironmentSync
 */
import {
  CommandId,
  ENVIRONMENT_SYNC_CHUNK_BYTES,
  ENVIRONMENT_SYNC_DEFAULT_DIRECTORY,
  ENVIRONMENT_SYNC_EVENT_ID_PREFIX,
  ENVIRONMENT_SYNC_FORMAT_VERSION,
  ENVIRONMENT_SYNC_ROUTE_PREFIX,
  EnvironmentSyncError,
  EventId,
  ORCHESTRATION_PROTOCOL_VERSION,
  OrchestrationV2DomainEventJson,
  ProjectId,
  ThreadId,
  isEnvironmentSyncEventId,
  type EnvironmentSyncAcceptInput,
  type EnvironmentSyncAcceptResult,
  type EnvironmentSyncExportInput,
  type EnvironmentSyncExportResult,
  type EnvironmentSyncImportResult,
  type EnvironmentSyncImportStage,
  type EnvironmentSyncManifest,
  type EnvironmentSyncPart,
  type EnvironmentSyncPrepareInput,
  type EnvironmentSyncPrepareResult,
  type EnvironmentSyncStatusResult,
  type EnvironmentSyncThreadAction,
  type EnvironmentSyncThreadExport,
  type EnvironmentSyncThreadPlan,
  type EnvironmentSyncUndoInput,
  type EnvironmentSyncUndoResult,
  type OrchestrationV2DomainEvent,
  type ThreadEnvironmentSync,
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
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import { resolveAttachmentPathById } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as LegacyV1ThreadImporter from "../orchestration-v2/legacy/LegacyV1ThreadImporter.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadCommandExecutor from "../orchestration-v2/ThreadCommandExecutor.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import { resolveWorktreesDirectory } from "../worktreesDirectory.ts";
import {
  appendFileChunk,
  openGzipLineWriter,
  readFileSlice,
  readGzipLines,
  sha256File,
} from "./EnvironmentSyncFiles.ts";
import * as EnvironmentSyncGit from "./EnvironmentSyncGit.ts";
import {
  environmentSyncMarkerEvent,
  transformImportedEvent,
  worktreeFolderNameForBranch,
  type SyncedPathMapping,
} from "./EnvironmentSyncTransform.ts";

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const EVENTS_PART_ID = "events";
const BUNDLE_PART_ID = "repository";
/**
 * A thread arrives in one transaction, so nothing sees a half-replayed run as
 * live work. One too large to hold in memory arrives in batches instead.
 */
const ATOMIC_THREAD_EVENTS = 20_000;
const IMPORT_BATCH_EVENTS = 500;
const IMPORT_BATCH_BYTES = 8 * 1024 * 1024;
const STALE_NATIVE_IDS_KEPT = 50;
const ACTIVE_RUN_STATUSES = ["queued", "preparing", "starting", "running", "waiting"] as const;
/** Imported events of these types mean the conversation itself moved. */
const CONVERSATION_EVENT_TYPES: ReadonlySet<OrchestrationV2DomainEvent["type"]> = new Set([
  "thread.created",
  "run.created",
  "run.updated",
  "message.updated",
  "turn-item.updated",
]);

const decodeEventJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2DomainEventJson),
);
const encodeEventJson = Schema.encodeEffect(Schema.fromJsonString(OrchestrationV2DomainEventJson));
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
  readonly input: EnvironmentSyncPrepareInput;
  readonly project: EnvironmentSyncPrepareResult["project"];
  readonly threadHeads: ReadonlyMap<ThreadId, EventId>;
  manifest: EnvironmentSyncManifest | null;
  plans: ReadonlyArray<EnvironmentSyncThreadPlan>;
  needed: Map<string, StoredPart & { received: number }>;
  status: EnvironmentSyncStatusResult;
  readonly finished: Deferred.Deferred<void>;
}

type Session = ExportSession | ImportSession;

interface ThreadRow {
  readonly threadId: ThreadId;
  readonly rootThreadId: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
}

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

function chunked<A>(items: ReadonlyArray<A>, size: number): ReadonlyArray<ReadonlyArray<A>> {
  const chunks: Array<ReadonlyArray<A>> = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

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
  const eventSink = yield* EventSink.EventSinkV2;
  const eventStore = yield* EventStore.EventStoreV2;
  const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
  const threadDispatch = yield* ThreadCommandExecutor.ThreadCommandExecutor;
  const legacyImporter = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
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
    fail("storage_failed", detail, cause);
  const threadsError = (detail: string) => (cause: unknown) =>
    isEnvironmentSyncError(cause) ? cause : fail("threads_failed", detail, cause);

  const self = environment.getDescriptor.pipe(
    Effect.map((descriptor) => ({
      environmentId: descriptor.environmentId,
      label: descriptor.label,
      serverVersion: descriptor.serverVersion,
    })),
  );

  const removeSession = (session: Session) =>
    Effect.gen(function* () {
      sessions.delete(session.id);
      yield* fileSystem.remove(session.directory, { recursive: true, force: true });
      if (session.kind === "export") {
        yield* git.releaseExport({ workspaceRoot: session.workspaceRoot, exportId: session.id });
      }
    }).pipe(Effect.ignore);

  const sweepSessions = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    for (const session of sessions.values()) {
      const importing = session.kind === "import" && session.status.phase === "importing";
      if (!importing && now - session.createdAt > SESSION_TTL_MS) yield* removeSession(session);
    }
  });

  const newSession = Effect.gen(function* () {
    yield* sweepSessions;
    const first = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
    const second = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
    const id = `${first}${second}`.replaceAll("-", "");
    const directory = path.join(sessionsDirectory, id);
    yield* fileSystem
      .makeDirectory(directory, { recursive: true })
      .pipe(Effect.mapError(storageError("Could not create a folder for the transfer.")));
    return { id, directory, createdAt: yield* Clock.currentTimeMillis };
  });

  const importSession = (sessionId: string) =>
    Effect.suspend(() => {
      const session = sessions.get(sessionId);
      return session?.kind === "import"
        ? Effect.succeed(session)
        : Effect.fail(fail("session_not_found", "This transfer expired. Run the sync again."));
    });

  // ---------------------------------------------------------------------
  // Thread queries
  // ---------------------------------------------------------------------

  const threadFamilies = Effect.fn("EnvironmentSync.threadFamilies")(function* (
    rootThreadIds: ReadonlyArray<ThreadId>,
  ) {
    const rows: Array<ThreadRow> = [];
    for (const batch of chunked([...new Set(rootThreadIds)], 200)) {
      const found = yield* sql<{
        readonly thread_id: string;
        readonly project_id: string;
        readonly title: string;
        readonly root_thread_id: string | null;
        readonly branch: string | null;
        readonly worktree_path: string | null;
      }>`
        SELECT
          thread_id,
          project_id,
          title,
          json_extract(payload_json, '$.lineage.rootThreadId') AS root_thread_id,
          json_extract(payload_json, '$.branch') AS branch,
          json_extract(payload_json, '$.worktreePath') AS worktree_path
        FROM orchestration_v2_projection_threads
        WHERE deleted_at IS NULL
          AND (
            thread_id IN ${sql.in(batch)}
            OR json_extract(payload_json, '$.lineage.rootThreadId') IN ${sql.in(batch)}
          )
        ORDER BY created_at ASC, thread_id ASC
      `;
      for (const row of found) {
        const threadId = ThreadId.make(row.thread_id);
        const rootThreadId = ThreadId.make(row.root_thread_id ?? row.thread_id);
        // A requested thread that is itself a child travels with its own descendants only.
        rows.push({
          threadId,
          rootThreadId: batch.includes(threadId) ? threadId : rootThreadId,
          projectId: ProjectId.make(row.project_id),
          title: row.title,
          branch: row.branch,
          worktreePath: row.worktree_path,
        });
      }
    }
    return rows;
  });

  const busyThreadIds = Effect.fn("EnvironmentSync.busyThreadIds")(function* (
    threadIds: ReadonlyArray<ThreadId>,
  ) {
    const busy = new Set<ThreadId>();
    for (const batch of chunked(threadIds, 400)) {
      const rows = yield* sql<{ readonly thread_id: string }>`
        SELECT DISTINCT thread_id
        FROM orchestration_v2_projection_runs
        WHERE thread_id IN ${sql.in(batch)}
          AND status IN ${sql.in(ACTIVE_RUN_STATUSES)}
        UNION
        SELECT DISTINCT thread_id
        FROM orchestration_v2_projection_runtime_requests
        WHERE thread_id IN ${sql.in(batch)}
          AND status = 'pending'
      `;
      for (const row of rows) busy.add(ThreadId.make(row.thread_id));
    }
    return busy;
  });

  /** The newest event a thread did not get from an import marker. */
  const threadHead = (threadId: ThreadId) =>
    sql<{ readonly event_id: string }>`
      SELECT event_id
      FROM orchestration_events
      WHERE application_event_version = 2
        AND aggregate_kind = 'thread'
        AND stream_id = ${threadId}
        AND event_id NOT LIKE ${`${ENVIRONMENT_SYNC_EVENT_ID_PREFIX}%`}
      ORDER BY sequence DESC
      LIMIT 1
    `.pipe(Effect.map((rows) => (rows[0] === undefined ? null : EventId.make(rows[0].event_id))));

  const eventSequence = (threadId: ThreadId, eventId: EventId) =>
    sql<{ readonly sequence: number }>`
      SELECT sequence
      FROM orchestration_events
      WHERE event_id = ${eventId}
        AND aggregate_kind = 'thread'
        AND stream_id = ${threadId}
      LIMIT 1
    `.pipe(Effect.map((rows) => rows[0]?.sequence ?? null));

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

  // ---------------------------------------------------------------------
  // Target: prepare
  // ---------------------------------------------------------------------

  const resolveTargetProject = Effect.fn("EnvironmentSync.resolveTargetProject")(function* (
    input: EnvironmentSyncPrepareInput,
  ) {
    const lookup = (projectId: ProjectId, includeDeleted = false) =>
      projects
        .getById(projectId, { includeDeleted })
        .pipe(Effect.mapError(threadsError("Could not read the projects on this machine.")));
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
          .pipe(Effect.mapError(threadsError("Could not read the projects on this machine.")))
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
      const families = yield* threadFamilies(input.rootThreadIds).pipe(
        Effect.mapError(threadsError("Could not read the threads on this machine.")),
      );
      const threadHeads = new Map<ThreadId, EventId>();
      for (const row of families) {
        const head = yield* threadHead(row.threadId).pipe(
          Effect.mapError(threadsError("Could not read the threads on this machine.")),
        );
        if (head !== null) threadHeads.set(row.threadId, head);
      }
      const gitHaves = yield* git.listHaves(project.workspaceRoot);
      const created = yield* newSession;
      sessions.set(created.id, {
        kind: "import",
        ...created,
        input,
        project,
        threadHeads,
        manifest: null,
        plans: [],
        needed: new Map(),
        status: { phase: "receiving" },
        finished: yield* Deferred.make<void>(),
      });
      return {
        transferId: created.id,
        project,
        gitHaves,
        threadHeads: [...threadHeads].map(([threadId, head]) => ({ threadId, head })),
      };
    },
  );

  // ---------------------------------------------------------------------
  // Source: export
  // ---------------------------------------------------------------------

  const exportProject: EnvironmentSync["Service"]["export"] = Effect.fn("EnvironmentSync.export")(
    function* (input) {
      const project = yield* projects.getById(input.projectId).pipe(
        Effect.mapError(threadsError("Could not read the project.")),
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(fail("project_not_found", "The project no longer exists.")),
            onSome: Effect.succeed,
          }),
        ),
      );
      const descriptor = yield* self;
      const session = yield* newSession;
      const parts = new Map<string, StoredPart>();
      const stored: ExportSession = {
        kind: "export",
        ...session,
        workspaceRoot: project.workspaceRoot,
        parts,
      };

      const body = Effect.gen(function* () {
        const families = (yield* threadFamilies(input.rootThreadIds)).filter(
          (row) => row.projectId === project.id,
        );
        for (const row of families) {
          yield* legacyImporter.ensureTranscript(row.threadId).pipe(Effect.ignore);
        }
        const busy = yield* busyThreadIds(families.map((row) => row.threadId));
        const busyRoots = new Set(
          families.filter((row) => busy.has(row.threadId)).map((row) => row.rootThreadId),
        );
        const targetHeads = new Map(input.threadHeads.map((entry) => [entry.threadId, entry.head]));

        const eventsPath = path.join(session.directory, `${EVENTS_PART_ID}.ndjson.gz`);
        const checkpointRefs = new Set<string>();
        const threads: Array<EnvironmentSyncThreadExport> = [];
        yield* Effect.scoped(
          Effect.gen(function* () {
            const writer = yield* openGzipLineWriter(eventsPath);
            for (const row of families) {
              const base = {
                threadId: row.threadId,
                rootThreadId: row.rootThreadId,
                title: row.title,
                branch: row.branch,
                worktreePath: row.worktreePath,
              };
              const head = yield* threadHead(row.threadId);
              if (busyRoots.has(row.rootThreadId)) {
                threads.push({ ...base, status: "busy", head, eventCount: 0 });
                continue;
              }
              const targetHead = targetHeads.get(row.threadId);
              const afterSequence =
                targetHead === undefined ? 0 : yield* eventSequence(row.threadId, targetHead);
              if (afterSequence === null) {
                threads.push({ ...base, status: "unknown_target_head", head, eventCount: 0 });
                continue;
              }
              let eventCount = 0;
              yield* Stream.runForEach(
                eventStore.read({ threadId: row.threadId, afterSequence }),
                (stored) =>
                  Effect.gen(function* () {
                    if (isEnvironmentSyncEventId(stored.event.id)) return;
                    if (stored.event.type === "checkpoint.captured") {
                      checkpointRefs.add(stored.event.payload.ref);
                    }
                    yield* writer.write(yield* encodeEventJson(stored.event));
                    eventCount += 1;
                  }),
              );
              threads.push({
                ...base,
                status: eventCount > 0 ? "events" : "up_to_date",
                head,
                eventCount,
              });
            }
            yield* writer.finish;
          }),
        );

        const register = Effect.fn(function* (
          id: string,
          kind: EnvironmentSyncPart["kind"],
          filePath: string,
          fileName?: string,
        ) {
          const info = yield* fileSystem.stat(filePath);
          parts.set(id, {
            path: filePath,
            part: {
              id,
              kind,
              sizeBytes: Number(info.size),
              sha256: yield* sha256File(filePath),
              ...(fileName === undefined ? {} : { fileName }),
            },
          });
        });

        if (threads.some((thread) => thread.status === "events")) {
          yield* register(EVENTS_PART_ID, "events", eventsPath);
        }

        // A thread whose target copy is newer keeps the target's checkout, so its files stay home.
        const movable = threads.filter(
          (thread) => thread.threadId === thread.rootThreadId && thread.status !== "busy",
        );
        const worktrees = new Map<string, Array<ThreadId>>();
        for (const thread of movable) {
          if (thread.worktreePath === null) continue;
          worktrees.set(thread.worktreePath, [
            ...(worktrees.get(thread.worktreePath) ?? []),
            thread.threadId,
          ]);
        }
        const bundlePath = path.join(session.directory, `${BUNDLE_PART_ID}.bundle`);
        const repository = yield* git.exportRepository({
          workspaceRoot: project.workspaceRoot,
          checkouts: [
            {
              kind: "root",
              path: project.workspaceRoot,
              threadIds: movable
                .filter((thread) => thread.worktreePath === null)
                .map((thread) => thread.threadId),
            },
            ...[...worktrees].map(([worktreePath, threadIds]) => ({
              kind: "worktree" as const,
              path: worktreePath,
              threadIds,
            })),
          ],
          haves: input.gitHaves,
          checkpointRefs,
          bundlePath,
          exportId: session.id,
        });
        if (repository.bundleCreated) yield* register(BUNDLE_PART_ID, "git-bundle", bundlePath);

        for (const thread of threads) {
          if (thread.status !== "events") continue;
          for (const attachmentId of yield* projectionStore.getThreadAttachmentIds(
            thread.threadId,
          )) {
            const attachmentPath = resolveAttachmentPathById({
              attachmentsDir: config.attachmentsDir,
              attachmentId,
            });
            const id = `attachment.${attachmentId}`;
            if (attachmentPath === null || parts.has(id)) continue;
            yield* register(id, "attachment", attachmentPath, path.basename(attachmentPath)).pipe(
              Effect.ignore,
            );
          }
        }

        const manifest: EnvironmentSyncManifest = {
          formatVersion: ENVIRONMENT_SYNC_FORMAT_VERSION,
          exportId: session.id,
          createdAt: DateTime.formatIso(yield* DateTime.now),
          source: {
            environmentId: descriptor.environmentId,
            label: descriptor.label,
            serverVersion: descriptor.serverVersion,
            orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
          },
          project: {
            projectId: project.id,
            title: project.title,
            workspaceRoot: project.workspaceRoot,
          },
          git:
            repository.git === null
              ? null
              : {
                  ...repository.git,
                  bundlePartId: repository.bundleCreated ? BUNDLE_PART_ID : null,
                },
          threads,
          parts: [...parts.values()].map((stored) => stored.part),
        };
        return manifest;
      });

      const manifest = yield* body.pipe(
        Effect.mapError(threadsError("Could not export the project.")),
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

  // ---------------------------------------------------------------------
  // Target: accept
  // ---------------------------------------------------------------------

  const accept: EnvironmentSync["Service"]["accept"] = Effect.fn("EnvironmentSync.accept")(
    function* (input) {
      const session = yield* importSession(input.transferId);
      const manifest = input.manifest;
      if (
        manifest.formatVersion !== ENVIRONMENT_SYNC_FORMAT_VERSION ||
        manifest.source.orchestrationProtocolVersion !== ORCHESTRATION_PROTOCOL_VERSION
      ) {
        return yield* fail(
          "incompatible",
          `${manifest.source.label} runs a different T3 Code version. Update both machines to the same version.`,
        );
      }

      const busy = yield* busyThreadIds(manifest.threads.map((thread) => thread.threadId)).pipe(
        Effect.mapError(threadsError("Could not read the threads on this machine.")),
      );
      const actions = new Map<ThreadId, EnvironmentSyncThreadAction>();
      for (const thread of manifest.threads) {
        if (thread.status === "busy" || busy.has(thread.threadId)) {
          actions.set(thread.threadId, "busy");
        } else if (thread.status === "up_to_date") {
          actions.set(thread.threadId, "up_to_date");
        } else if (thread.status === "events") {
          actions.set(thread.threadId, "import");
        } else {
          const known =
            thread.head === null
              ? null
              : yield* eventSequence(thread.threadId, thread.head).pipe(
                  Effect.mapError(threadsError("Could not read the threads on this machine.")),
                );
          actions.set(thread.threadId, known === null ? "diverged" : "target_ahead");
        }
      }
      // A family moves together or not at all.
      const severity: ReadonlyArray<EnvironmentSyncThreadAction> = [
        "diverged",
        "target_ahead",
        "busy",
      ];
      const familyAction = new Map<ThreadId, EnvironmentSyncThreadAction>();
      for (const thread of manifest.threads) {
        const action = actions.get(thread.threadId)!;
        const current = familyAction.get(thread.rootThreadId);
        const rank = severity.indexOf(action);
        if (rank !== -1 && (current === undefined || rank < severity.indexOf(current))) {
          familyAction.set(thread.rootThreadId, action);
        }
      }
      const plans = manifest.threads.map((thread): EnvironmentSyncThreadPlan => ({
        threadId: thread.threadId,
        rootThreadId: thread.rootThreadId,
        action: familyAction.get(thread.rootThreadId) ?? actions.get(thread.threadId)!,
      }));

      const needed = new Map<string, StoredPart & { received: number }>();
      for (const part of manifest.parts) {
        if (part.kind === "attachment") {
          const fileName = part.fileName;
          if (fileName === undefined || path.basename(fileName) !== fileName) continue;
          const present = yield* fileSystem
            .exists(path.join(config.attachmentsDir, fileName))
            .pipe(Effect.orElseSucceed(() => false));
          if (present) continue;
        }
        if (part.kind === "events" && !plans.some((plan) => plan.action === "import")) continue;
        needed.set(part.id, {
          part,
          path: path.join(session.directory, `${part.id}.part`),
          received: 0,
        });
      }
      session.manifest = manifest;
      session.plans = plans;
      session.needed = needed;
      return {
        neededPartIds: [...needed.keys()],
        uploadPath: `${ENVIRONMENT_SYNC_ROUTE_PREFIX}/${session.id}`,
        threads: plans,
      };
    },
  );

  // ---------------------------------------------------------------------
  // Part transfer
  // ---------------------------------------------------------------------

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

  // ---------------------------------------------------------------------
  // Target: import
  // ---------------------------------------------------------------------

  const setStage = (
    session: ImportSession,
    stage: EnvironmentSyncImportStage,
    completed = 0,
    total = 0,
  ) =>
    Effect.sync(() => {
      session.status = { phase: "importing", stage, completed, total };
    });

  /** Appends the events this environment does not have yet. The caller holds the thread lock. */
  const writeFresh = Effect.fn("EnvironmentSync.writeFresh")(function* (
    events: ReadonlyArray<OrchestrationV2DomainEvent>,
  ) {
    const known = new Set<string>();
    for (const batch of chunked(events, 400)) {
      const rows = yield* sql<{ readonly event_id: string }>`
        SELECT event_id
        FROM orchestration_events
        WHERE event_id IN ${sql.in(batch.map((event) => event.id))}
      `;
      for (const row of rows) known.add(row.event_id);
    }
    const fresh = events.filter((event) => !known.has(event.id));
    if (fresh.length === 0) return fresh;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        // The source already placed these items. Keeping its ordinals keeps its order.
        for (const event of fresh) {
          if (event.type !== "turn-item.updated") continue;
          yield* sql`
            INSERT INTO orchestration_v2_turn_item_positions (thread_id, turn_item_id, ordinal)
            VALUES (${event.threadId}, ${event.payload.id}, ${event.payload.ordinal})
            ON CONFLICT(thread_id, turn_item_id) DO NOTHING
          `;
        }
        yield* eventSink.write({ events: fresh });
      }),
    );
    return fresh;
  });

  /** Marks the thread as arrived from another host. The caller holds the thread lock. */
  const writeMarker = Effect.fn("EnvironmentSync.writeMarker")(function* (input: {
    readonly session: ImportSession;
    readonly manifest: EnvironmentSyncManifest;
    readonly thread: EnvironmentSyncThreadExport;
    readonly importedNativeIds: ReadonlySet<string>;
    readonly knownNativeIds: ReadonlySet<string>;
    readonly notes: ReadonlyArray<string>;
  }) {
    const host = yield* self;
    const thread = yield* projectionStore.getThread(input.thread.threadId);
    const runs = yield* sql<{ readonly ordinal: number | null }>`
      SELECT MAX(ordinal) AS ordinal
      FROM orchestration_v2_projection_runs
      WHERE thread_id = ${input.thread.threadId}
    `;
    const stale = [
      ...(thread.environmentSync?.staleNativeThreadIds ?? []),
      ...[...input.importedNativeIds].filter((id) => !input.knownNativeIds.has(id)),
    ];
    const environmentSync: ThreadEnvironmentSync = {
      origin: {
        environmentId: input.manifest.source.environmentId,
        label: input.manifest.source.label,
      },
      originWorkspacePath: input.thread.worktreePath ?? input.manifest.project.workspaceRoot,
      host: { environmentId: host.environmentId, label: host.label },
      syncedAt: DateTime.formatIso(yield* DateTime.now),
      afterRunOrdinal: runs[0]?.ordinal ?? 0,
      staleNativeThreadIds: [...new Set(stale)].slice(-STALE_NATIVE_IDS_KEPT),
      notes: input.notes,
    };
    yield* eventSink.write({
      events: [
        environmentSyncMarkerEvent({
          eventId: EventId.make(
            `${ENVIRONMENT_SYNC_EVENT_ID_PREFIX}${input.session.id}:${input.thread.threadId}`,
          ),
          occurredAt: yield* DateTime.now,
          thread,
          environmentSync,
        }),
      ],
    });
  });

  const nativeThreadIds = (threadId: ThreadId) =>
    sql<{ readonly native_id: string | null }>`
      SELECT json_extract(payload_json, '$.nativeThreadRef.nativeId') AS native_id
      FROM orchestration_v2_projection_provider_threads
      WHERE thread_id = ${threadId}
    `.pipe(
      Effect.map((rows) => new Set(rows.flatMap((row) => (row.native_id ? [row.native_id] : [])))),
    );

  const runImport = Effect.fn("EnvironmentSync.runImport")(function* (session: ImportSession) {
    const manifest = session.manifest;
    if (manifest === null) {
      return yield* fail("incomplete_transfer", "The transfer was not accepted first.");
    }
    const host = yield* self;
    const root = session.project.workspaceRoot;
    const warnings: Array<string> = [];
    const actionOf = new Map(session.plans.map((plan) => [plan.threadId, plan.action]));
    const moves = (threadId: ThreadId) => {
      const action = actionOf.get(threadId);
      return action === "import" || action === "up_to_date";
    };

    // Repository and checkouts.
    yield* setStage(session, "repository");
    let notes: ReadonlyMap<string, ReadonlyArray<string>> = new Map();
    let restorePointId: string | null = null;
    const mappings: Array<SyncedPathMapping> = [{ from: manifest.project.workspaceRoot, to: root }];
    const worktreeParent = yield* worktreesDirectory;
    if (manifest.git === null) {
      yield* fileSystem
        .makeDirectory(root, { recursive: true })
        .pipe(Effect.mapError(storageError(`Could not create ${root}.`)));
      warnings.push(
        `${manifest.project.title} is not a Git repository on ${manifest.source.label}, so its files were not copied.`,
      );
    } else {
      const planned = yield* git.planCheckouts({
        workspaceRoot: root,
        worktreesDirectory: worktreeParent,
        workspaces: manifest.git.workspaces,
      });
      for (const plan of planned) {
        if (plan.workspace.kind === "worktree") {
          mappings.push({ from: plan.workspace.sourcePath, to: plan.targetPath });
        }
      }
      const activeHere = yield* sql<{ readonly worktree_path: string | null }>`
        SELECT DISTINCT json_extract(thread.payload_json, '$.worktreePath') AS worktree_path
        FROM orchestration_v2_projection_runs AS run
        JOIN orchestration_v2_projection_threads AS thread ON thread.thread_id = run.thread_id
        WHERE thread.project_id = ${session.project.projectId}
          AND thread.deleted_at IS NULL
          AND run.status IN ${sql.in(ACTIVE_RUN_STATUSES)}
      `.pipe(Effect.mapError(threadsError("Could not read the threads on this machine.")));
      const busyPaths = new Set(activeHere.map((row) => row.worktree_path ?? root));
      const checkouts: Array<EnvironmentSyncGit.PlannedCheckout> = [];
      for (const plan of planned) {
        const users = plan.workspace.threadIds;
        const heldBack = users.some((threadId) => {
          const action = actionOf.get(threadId);
          return action === "target_ahead" || action === "diverged";
        });
        // The project folder only changes when a thread that works in it moves, or when it is new.
        const wanted =
          users.some(moves) ||
          (plan.workspace.kind === "root" &&
            (!session.project.exists || session.input.includeProjectCheckout === true));
        if (!wanted || heldBack) continue;
        checkouts.push(
          busyPaths.has(plan.targetPath)
            ? {
                ...plan,
                skip: `A turn is running in ${plan.targetPath} on ${host.label}, so that checkout was left as it is.`,
              }
            : plan,
        );
      }
      yield* setStage(session, "workspaces", 0, checkouts.length);
      const bundle =
        manifest.git.bundlePartId === null
          ? undefined
          : session.needed.get(manifest.git.bundlePartId);
      const applied = yield* git.applyRepository({
        projectId: session.project.projectId,
        workspaceRoot: root,
        sourceLabel: manifest.source.label,
        hostLabel: host.label,
        git: manifest.git,
        bundlePath: bundle?.path ?? null,
        exportId: manifest.exportId,
        checkouts,
      });
      warnings.push(...applied.warnings);
      notes = applied.notes;
      restorePointId = applied.restorePointId;
    }

    if (!session.project.exists) {
      yield* projects
        .create({
          commandId: CommandId.make(`environment-sync-create:${session.id}`),
          projectId: session.project.projectId,
          title: manifest.project.title,
          workspaceRoot: root,
          createWorkspaceRootIfMissing: true,
        })
        .pipe(Effect.mapError(threadsError("Could not create the project.")));
    }

    // Attachments keep their ids, so message references stay valid.
    const attachments = [...session.needed.values()].filter(
      (stored) => stored.part.kind === "attachment" && stored.part.fileName !== undefined,
    );
    yield* setStage(session, "attachments", 0, attachments.length);
    yield* fileSystem
      .makeDirectory(config.attachmentsDir, { recursive: true })
      .pipe(Effect.mapError(storageError("Could not store attachments.")));
    for (const stored of attachments) {
      const destination = path.join(config.attachmentsDir, stored.part.fileName!);
      const present = yield* fileSystem.exists(destination).pipe(Effect.orElseSucceed(() => false));
      if (present) continue;
      yield* fileSystem
        .copyFile(stored.path, destination)
        .pipe(Effect.mapError(storageError("Could not store attachments.")));
    }

    // Threads.
    const fallbackWorktreePath = (branch: string) =>
      path.join(worktreeParent, path.basename(root), worktreeFolderNameForBranch(branch));
    const localSync = new Map<ThreadId, ThreadEnvironmentSync | undefined>();
    const transform = {
      projectId: session.project.projectId,
      mappings,
      fallbackWorktreePath,
      localEnvironmentSync: (threadId: ThreadId) => localSync.get(threadId),
    };
    const threadsById = new Map(manifest.threads.map((thread) => [thread.threadId, thread]));
    const importedCounts = new Map<ThreadId, number>();
    const importedNativeIds = new Map<ThreadId, Set<string>>();
    const knownNativeIds = new Map<ThreadId, ReadonlySet<string>>();
    const conversationMoved = new Set<ThreadId>();
    const skipped = new Set<ThreadId>();
    const importing = manifest.threads.filter(
      (thread) => actionOf.get(thread.threadId) === "import",
    );
    const totalEvents = importing.reduce((sum, thread) => sum + thread.eventCount, 0);
    let completedEvents = 0;
    yield* setStage(session, "threads", 0, totalEvents);

    // One critical section per batch. Nothing else writes the thread while its history lands,
    // and the marker goes in with the last of it.
    const flush = Effect.fn(function* (
      threadId: ThreadId,
      events: ReadonlyArray<OrchestrationV2DomainEvent>,
      final: boolean,
    ) {
      completedEvents += events.length;
      if (skipped.has(threadId) || actionOf.get(threadId) !== "import") return;
      yield* threadDispatch.withLock(
        threadId,
        Effect.gen(function* () {
          if (!knownNativeIds.has(threadId)) {
            // A thread that gained events here since `prepare` is no longer a prefix of the source.
            const expected = session.threadHeads.get(threadId) ?? null;
            if ((yield* threadHead(threadId)) !== expected) {
              skipped.add(threadId);
              return;
            }
            knownNativeIds.set(threadId, yield* nativeThreadIds(threadId));
            localSync.set(
              threadId,
              yield* projectionStore.getThread(threadId).pipe(
                Effect.map((thread) => thread.environmentSync),
                Effect.orElseSucceed(() => undefined),
              ),
            );
          }
          const fresh = yield* writeFresh(
            events.map((event) => transformImportedEvent(event, transform)),
          );
          importedCounts.set(threadId, (importedCounts.get(threadId) ?? 0) + fresh.length);
          for (const event of fresh) {
            if (CONVERSATION_EVENT_TYPES.has(event.type)) conversationMoved.add(threadId);
            if (event.type === "provider-thread.updated") {
              const nativeId = event.payload.nativeThreadRef?.nativeId;
              if (nativeId) {
                importedNativeIds.set(
                  threadId,
                  (importedNativeIds.get(threadId) ?? new Set()).add(nativeId),
                );
              }
            }
          }
          const thread = threadsById.get(threadId);
          if (!final || thread === undefined || !conversationMoved.has(threadId)) return;
          const cwd =
            thread.worktreePath === null
              ? root
              : (mappings.find((mapping) => mapping.from === thread.worktreePath)?.to ?? root);
          yield* writeMarker({
            session,
            manifest,
            thread,
            importedNativeIds: importedNativeIds.get(threadId) ?? new Set(),
            knownNativeIds: knownNativeIds.get(threadId) ?? new Set(),
            notes: notes.get(cwd) ?? [],
          });
        }),
      );
      yield* setStage(session, "threads", completedEvents, totalEvents);
      yield* Effect.yieldNow;
    });

    const eventsPart = session.needed.get(EVENTS_PART_ID);
    if (eventsPart !== undefined && importing.length > 0) {
      let currentThread: ThreadId | null = null;
      let buffer: Array<OrchestrationV2DomainEvent> = [];
      let bufferBytes = 0;
      yield* Stream.runForEach(readGzipLines(eventsPart.path), (line) =>
        Effect.gen(function* () {
          if (line === "") return;
          const event = yield* decodeEventJson(line);
          if (currentThread !== null && event.threadId !== currentThread) {
            yield* flush(currentThread, buffer, true);
            buffer = [];
            bufferBytes = 0;
          }
          currentThread = event.threadId;
          if (actionOf.get(event.threadId) !== "import") return;
          buffer.push(event);
          bufferBytes += line.length;
          const batched = (threadsById.get(event.threadId)?.eventCount ?? 0) > ATOMIC_THREAD_EVENTS;
          if (
            batched &&
            (buffer.length >= IMPORT_BATCH_EVENTS || bufferBytes >= IMPORT_BATCH_BYTES)
          ) {
            yield* flush(currentThread, buffer, false);
            buffer = [];
            bufferBytes = 0;
          }
        }),
      );
      if (currentThread !== null) yield* flush(currentThread, buffer, true);
    }

    const result: EnvironmentSyncImportResult = {
      projectId: session.project.projectId,
      workspaceRoot: root,
      projectCreated: !session.project.exists,
      threads: session.plans.map((plan) => ({
        ...plan,
        action: skipped.has(plan.threadId) ? ("diverged" as const) : plan.action,
        importedEventCount: importedCounts.get(plan.threadId) ?? 0,
      })),
      warnings,
      restorePointId,
    };
    return result;
  });

  const commit: EnvironmentSync["Service"]["commit"] = Effect.fn("EnvironmentSync.commit")(
    function* (sessionId) {
      const session = yield* importSession(sessionId);
      if (session.status.phase !== "receiving") return;
      if (session.manifest === null) {
        return yield* fail("incomplete_transfer", "The transfer was not accepted first.");
      }
      for (const stored of session.needed.values()) {
        const complete =
          stored.received === stored.part.sizeBytes &&
          (stored.part.sizeBytes === 0 ||
            (yield* sha256File(stored.path).pipe(Effect.orElseSucceed(() => ""))) ===
              stored.part.sha256);
        if (!complete) {
          return yield* fail(
            "incomplete_transfer",
            "The data did not arrive completely. Run the sync again.",
          );
        }
      }
      yield* setStage(session, "waiting");
      yield* runImport(session).pipe(
        Effect.mapError(threadsError("Could not import the project.")),
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
        Deferred.await(session.finished).pipe(
          Effect.as(session),
          Effect.map(() => session.status),
        ),
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
