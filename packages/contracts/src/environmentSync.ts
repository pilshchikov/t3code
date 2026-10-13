import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  EventId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";

/**
 * Environment sync copies a project and its threads from one environment to
 * another so work can continue on a different host. The client relays the
 * bytes because it is the only party that reaches both environments.
 */
export const ENVIRONMENT_SYNC_FORMAT_VERSION = 1;
export const ENVIRONMENT_SYNC_ROUTE_PREFIX = "/api/environment-sync";
export const ENVIRONMENT_SYNC_CHUNK_BYTES = 4 * 1024 * 1024;
/** Events the importing environment writes itself. They never leave it. */
export const ENVIRONMENT_SYNC_EVENT_ID_PREFIX = "env-sync:";
/** Folder under the user's home that receives synced projects when the setting is empty. */
export const ENVIRONMENT_SYNC_DEFAULT_DIRECTORY = "~/t3-sync";

export function isEnvironmentSyncEventId(eventId: string): boolean {
  return eventId.startsWith(ENVIRONMENT_SYNC_EVENT_ID_PREFIX);
}

export const EnvironmentSyncPeer = Schema.Struct({
  environmentId: EnvironmentId,
  label: TrimmedNonEmptyString,
});
export type EnvironmentSyncPeer = typeof EnvironmentSyncPeer.Type;

/**
 * Recorded on a thread by the environment that imported it. `afterRunOrdinal`
 * is the last run that happened elsewhere. The first provider turn after it
 * tells the agent the host changed. Native provider sessions named in
 * `staleNativeThreadIds` live on the origin and cannot be resumed here.
 */
export const ThreadEnvironmentSync = Schema.Struct({
  origin: EnvironmentSyncPeer,
  originWorkspacePath: TrimmedNonEmptyString,
  /** The importing environment, as it was named at import time. */
  host: EnvironmentSyncPeer,
  syncedAt: IsoDateTime,
  afterRunOrdinal: NonNegativeInt,
  staleNativeThreadIds: Schema.Array(TrimmedNonEmptyString),
  /** What the agent should know about its checkout, such as changes that were not applied. */
  notes: Schema.Array(Schema.String),
});
export type ThreadEnvironmentSync = typeof ThreadEnvironmentSync.Type;

export const EnvironmentSyncPartKind = Schema.Literals(["events", "git-bundle", "attachment"]);
export type EnvironmentSyncPartKind = typeof EnvironmentSyncPartKind.Type;

const EnvironmentSyncPartId = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[a-z0-9_.-]{1,200}$/i),
);

export const EnvironmentSyncPart = Schema.Struct({
  id: EnvironmentSyncPartId,
  kind: EnvironmentSyncPartKind,
  sizeBytes: NonNegativeInt,
  sha256: TrimmedNonEmptyString,
  /** For an attachment part, the file name inside the attachments directory. */
  fileName: Schema.optional(EnvironmentSyncPartId),
});
export type EnvironmentSyncPart = typeof EnvironmentSyncPart.Type;

/**
 * - `events`: the events part carries this thread's new events.
 * - `up_to_date`: the target already has everything.
 * - `unknown_target_head`: the target has events the source never saw. The
 *   target decides whether it is ahead or the copies diverged.
 * - `busy`: the thread has running or queued work and was left out.
 */
export const EnvironmentSyncThreadExportStatus = Schema.Literals([
  "events",
  "up_to_date",
  "unknown_target_head",
  "busy",
]);
export type EnvironmentSyncThreadExportStatus = typeof EnvironmentSyncThreadExportStatus.Type;

export const EnvironmentSyncThreadExport = Schema.Struct({
  threadId: ThreadId,
  rootThreadId: ThreadId,
  title: Schema.String,
  status: EnvironmentSyncThreadExportStatus,
  /** The source's newest event that it wrote itself or imported. */
  head: Schema.NullOr(EventId),
  eventCount: NonNegativeInt,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
});
export type EnvironmentSyncThreadExport = typeof EnvironmentSyncThreadExport.Type;

export const EnvironmentSyncGitRef = Schema.Struct({
  name: TrimmedNonEmptyString,
  sha: TrimmedNonEmptyString,
});
export type EnvironmentSyncGitRef = typeof EnvironmentSyncGitRef.Type;

export const EnvironmentSyncWorkspace = Schema.Struct({
  kind: Schema.Literals(["root", "worktree"]),
  sourcePath: TrimmedNonEmptyString,
  /** Exported threads that work in this checkout. */
  threadIds: Schema.Array(ThreadId),
  /** Null when the checkout is on a detached HEAD. */
  branch: Schema.NullOr(TrimmedNonEmptyString),
  head: TrimmedNonEmptyString,
  /** Ref holding a commit of the working tree, uncommitted and untracked files included. */
  snapshotRef: TrimmedNonEmptyString,
});
export type EnvironmentSyncWorkspace = typeof EnvironmentSyncWorkspace.Type;

export const EnvironmentSyncGitExport = Schema.Struct({
  remotes: Schema.Array(Schema.Struct({ name: TrimmedNonEmptyString, url: TrimmedNonEmptyString })),
  refs: Schema.Array(EnvironmentSyncGitRef),
  workspaces: Schema.Array(EnvironmentSyncWorkspace),
  /** Null when the target already has every object. */
  bundlePartId: Schema.NullOr(EnvironmentSyncPartId),
});
export type EnvironmentSyncGitExport = typeof EnvironmentSyncGitExport.Type;

export const EnvironmentSyncManifest = Schema.Struct({
  formatVersion: Schema.Int,
  exportId: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  source: Schema.Struct({
    ...EnvironmentSyncPeer.fields,
    serverVersion: TrimmedNonEmptyString,
    orchestrationProtocolVersion: Schema.Int,
  }),
  project: Schema.Struct({
    projectId: ProjectId,
    title: TrimmedNonEmptyString,
    workspaceRoot: TrimmedNonEmptyString,
  }),
  /** Null when the project is not a Git repository with a commit. Files are then not copied. */
  git: Schema.NullOr(EnvironmentSyncGitExport),
  threads: Schema.Array(EnvironmentSyncThreadExport),
  parts: Schema.Array(EnvironmentSyncPart),
});
export type EnvironmentSyncManifest = typeof EnvironmentSyncManifest.Type;

export const EnvironmentSyncThreadHead = Schema.Struct({
  threadId: ThreadId,
  head: EventId,
});
export type EnvironmentSyncThreadHead = typeof EnvironmentSyncThreadHead.Type;

export const EnvironmentSyncPrepareInput = Schema.Struct({
  source: EnvironmentSyncPeer,
  project: Schema.Struct({
    projectId: ProjectId,
    title: TrimmedNonEmptyString,
    /** Last path segment of the source workspace root, used to name a new folder. */
    folderName: TrimmedNonEmptyString,
  }),
  /** An existing project on the target that holds the same repository. */
  targetProjectId: Schema.optional(ProjectId),
  /** Where a new project is created. Defaults to the synced projects folder. */
  destinationPath: Schema.optional(TrimmedNonEmptyString),
  rootThreadIds: Schema.Array(ThreadId),
  /**
   * Bring the project folder's own checkout along even when no synced thread
   * works in it. Without this it only changes for a thread that does.
   */
  includeProjectCheckout: Schema.optional(Schema.Boolean),
});
export type EnvironmentSyncPrepareInput = typeof EnvironmentSyncPrepareInput.Type;

export const EnvironmentSyncPrepareResult = Schema.Struct({
  transferId: TrimmedNonEmptyString,
  project: Schema.Struct({
    projectId: ProjectId,
    workspaceRoot: TrimmedNonEmptyString,
    exists: Schema.Boolean,
  }),
  /** Commits the target already has, so the bundle carries only what is new. */
  gitHaves: Schema.Array(TrimmedNonEmptyString),
  threadHeads: Schema.Array(EnvironmentSyncThreadHead),
});
export type EnvironmentSyncPrepareResult = typeof EnvironmentSyncPrepareResult.Type;

export const EnvironmentSyncExportInput = Schema.Struct({
  projectId: ProjectId,
  rootThreadIds: Schema.Array(ThreadId),
  target: EnvironmentSyncPeer,
  gitHaves: Schema.Array(TrimmedNonEmptyString),
  threadHeads: Schema.Array(EnvironmentSyncThreadHead),
});
export type EnvironmentSyncExportInput = typeof EnvironmentSyncExportInput.Type;

export const EnvironmentSyncExportResult = Schema.Struct({
  manifest: EnvironmentSyncManifest,
  /** Relative URL prefix. A part is read at `<downloadPath>/<partId>?offset=&length=`. */
  downloadPath: TrimmedNonEmptyString,
});
export type EnvironmentSyncExportResult = typeof EnvironmentSyncExportResult.Type;

/**
 * - `import`: new events will be applied.
 * - `up_to_date`: nothing to do.
 * - `target_ahead`: the target copy is newer and is left alone.
 * - `diverged`: both copies have activity the other lacks. Neither is changed.
 * - `busy`: skipped because work is running on the source or the target.
 */
export const EnvironmentSyncThreadAction = Schema.Literals([
  "import",
  "up_to_date",
  "target_ahead",
  "diverged",
  "busy",
]);
export type EnvironmentSyncThreadAction = typeof EnvironmentSyncThreadAction.Type;

export const EnvironmentSyncThreadPlan = Schema.Struct({
  threadId: ThreadId,
  rootThreadId: ThreadId,
  action: EnvironmentSyncThreadAction,
});
export type EnvironmentSyncThreadPlan = typeof EnvironmentSyncThreadPlan.Type;

export const EnvironmentSyncAcceptInput = Schema.Struct({
  transferId: TrimmedNonEmptyString,
  manifest: EnvironmentSyncManifest,
});
export type EnvironmentSyncAcceptInput = typeof EnvironmentSyncAcceptInput.Type;

export const EnvironmentSyncAcceptResult = Schema.Struct({
  neededPartIds: Schema.Array(EnvironmentSyncPartId),
  /** Relative URL prefix. A part is written at `<uploadPath>/<partId>?offset=`. */
  uploadPath: TrimmedNonEmptyString,
  threads: Schema.Array(EnvironmentSyncThreadPlan),
});
export type EnvironmentSyncAcceptResult = typeof EnvironmentSyncAcceptResult.Type;

export const EnvironmentSyncSessionInput = Schema.Struct({
  sessionId: TrimmedNonEmptyString,
});
export type EnvironmentSyncSessionInput = typeof EnvironmentSyncSessionInput.Type;

export const EnvironmentSyncImportResult = Schema.Struct({
  projectId: ProjectId,
  workspaceRoot: TrimmedNonEmptyString,
  projectCreated: Schema.Boolean,
  threads: Schema.Array(
    Schema.Struct({
      ...EnvironmentSyncThreadPlan.fields,
      importedEventCount: NonNegativeInt,
    }),
  ),
  /** Things the user should know, such as local work on the target that was set aside. */
  warnings: Schema.Array(Schema.String),
  /** Set when the import changed a checkout or a branch. `undo` puts those back. */
  restorePointId: Schema.NullOr(TrimmedNonEmptyString),
});
export type EnvironmentSyncImportResult = typeof EnvironmentSyncImportResult.Type;

export const EnvironmentSyncImportStage = Schema.Literals([
  "waiting",
  "repository",
  "workspaces",
  "attachments",
  "threads",
]);
export type EnvironmentSyncImportStage = typeof EnvironmentSyncImportStage.Type;

/** The import runs on the server after `commit` returns, so clients poll this. */
export const EnvironmentSyncStatusResult = Schema.Union([
  Schema.Struct({
    phase: Schema.Literal("receiving"),
  }),
  Schema.Struct({
    phase: Schema.Literal("importing"),
    stage: EnvironmentSyncImportStage,
    completed: NonNegativeInt,
    total: NonNegativeInt,
  }),
  Schema.Struct({
    phase: Schema.Literal("done"),
    result: EnvironmentSyncImportResult,
  }),
  Schema.Struct({
    phase: Schema.Literal("failed"),
    message: Schema.String,
  }),
]);
export type EnvironmentSyncStatusResult = typeof EnvironmentSyncStatusResult.Type;

export const EnvironmentSyncCommitResult = Schema.Struct({
  started: Schema.Boolean,
});
export type EnvironmentSyncCommitResult = typeof EnvironmentSyncCommitResult.Type;

export const EnvironmentSyncReleaseResult = Schema.Struct({
  released: Schema.Boolean,
});
export type EnvironmentSyncReleaseResult = typeof EnvironmentSyncReleaseResult.Type;

export const EnvironmentSyncUndoInput = Schema.Struct({
  projectId: ProjectId,
  /** Defaults to the newest restore point of the project. */
  restorePointId: Schema.optional(TrimmedNonEmptyString),
});
export type EnvironmentSyncUndoInput = typeof EnvironmentSyncUndoInput.Type;

export const EnvironmentSyncUndoResult = Schema.Struct({
  restorePointId: TrimmedNonEmptyString,
  /** The restore point taken before undoing, so the undo can itself be reverted. */
  newRestorePointId: Schema.NullOr(TrimmedNonEmptyString),
  restoredCheckouts: Schema.Array(TrimmedNonEmptyString),
  warnings: Schema.Array(Schema.String),
});
export type EnvironmentSyncUndoResult = typeof EnvironmentSyncUndoResult.Type;

export const EnvironmentSyncErrorReason = Schema.Literals([
  "project_not_found",
  "destination_unavailable",
  "target_busy",
  "session_not_found",
  "restore_point_not_found",
  "incomplete_transfer",
  "incompatible",
  "repository_failed",
  "threads_failed",
  "storage_failed",
]);
export type EnvironmentSyncErrorReason = typeof EnvironmentSyncErrorReason.Type;

export class EnvironmentSyncError extends Schema.TaggedError<EnvironmentSyncError>()(
  "EnvironmentSyncError",
  {
    reason: EnvironmentSyncErrorReason,
    detail: TrimmedString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}
