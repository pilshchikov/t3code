import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";

/**
 * Environment sync copies a project's repository from one environment to
 * another, with every checkout as it stands, so a new thread can start on a
 * different host. The client relays the bytes because it is the only party
 * that reaches both environments. Threads are not copied.
 */
export const ENVIRONMENT_SYNC_FORMAT_VERSION = 2;
export const ENVIRONMENT_SYNC_ROUTE_PREFIX = "/api/environment-sync";
export const ENVIRONMENT_SYNC_CHUNK_BYTES = 4 * 1024 * 1024;
/** Folder under the user's home that receives synced projects when the setting is empty. */
export const ENVIRONMENT_SYNC_DEFAULT_DIRECTORY = "~/t3-sync";

export const EnvironmentSyncPeer = Schema.Struct({
  environmentId: EnvironmentId,
  label: TrimmedNonEmptyString,
});
export type EnvironmentSyncPeer = typeof EnvironmentSyncPeer.Type;

const EnvironmentSyncPartId = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[a-z0-9_.-]{1,200}$/i),
);

export const EnvironmentSyncPart = Schema.Struct({
  id: EnvironmentSyncPartId,
  sizeBytes: NonNegativeInt,
  sha256: TrimmedNonEmptyString,
});
export type EnvironmentSyncPart = typeof EnvironmentSyncPart.Type;

export const EnvironmentSyncGitRef = Schema.Struct({
  name: TrimmedNonEmptyString,
  sha: TrimmedNonEmptyString,
});
export type EnvironmentSyncGitRef = typeof EnvironmentSyncGitRef.Type;

export const EnvironmentSyncWorkspace = Schema.Struct({
  kind: Schema.Literals(["root", "worktree"]),
  sourcePath: TrimmedNonEmptyString,
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
  source: EnvironmentSyncPeer,
  project: Schema.Struct({
    projectId: ProjectId,
    title: TrimmedNonEmptyString,
    workspaceRoot: TrimmedNonEmptyString,
  }),
  git: EnvironmentSyncGitExport,
  parts: Schema.Array(EnvironmentSyncPart),
});
export type EnvironmentSyncManifest = typeof EnvironmentSyncManifest.Type;

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
});
export type EnvironmentSyncPrepareResult = typeof EnvironmentSyncPrepareResult.Type;

export const EnvironmentSyncExportInput = Schema.Struct({
  projectId: ProjectId,
  target: EnvironmentSyncPeer,
  gitHaves: Schema.Array(TrimmedNonEmptyString),
});
export type EnvironmentSyncExportInput = typeof EnvironmentSyncExportInput.Type;

export const EnvironmentSyncExportResult = Schema.Struct({
  manifest: EnvironmentSyncManifest,
  /** Relative URL prefix. A part is read at `<downloadPath>/<partId>?offset=&length=`. */
  downloadPath: TrimmedNonEmptyString,
});
export type EnvironmentSyncExportResult = typeof EnvironmentSyncExportResult.Type;

export const EnvironmentSyncAcceptInput = Schema.Struct({
  transferId: TrimmedNonEmptyString,
  manifest: EnvironmentSyncManifest,
});
export type EnvironmentSyncAcceptInput = typeof EnvironmentSyncAcceptInput.Type;

export const EnvironmentSyncAcceptResult = Schema.Struct({
  neededPartIds: Schema.Array(EnvironmentSyncPartId),
  /** Relative URL prefix. A part is written at `<uploadPath>/<partId>?offset=`. */
  uploadPath: TrimmedNonEmptyString,
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
  /** Checkouts that now match the source. */
  syncedCheckouts: NonNegativeInt,
  /** Things the user should know, such as a checkout that was left alone. */
  warnings: Schema.Array(Schema.String),
  /** Set when the import changed a checkout or a branch. `undo` puts those back. */
  restorePointId: Schema.NullOr(TrimmedNonEmptyString),
});
export type EnvironmentSyncImportResult = typeof EnvironmentSyncImportResult.Type;

/** The import runs on the server after `commit` returns, so clients poll this. */
export const EnvironmentSyncStatusResult = Schema.Union([
  Schema.Struct({
    phase: Schema.Literal("receiving"),
  }),
  Schema.Struct({
    phase: Schema.Literal("importing"),
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
  "session_not_found",
  "restore_point_not_found",
  "incomplete_transfer",
  "incompatible",
  "repository_failed",
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
