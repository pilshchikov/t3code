// @effect-diagnostics globalTimers:off globalFetch:off - The relay runs in the client, outside an Effect runtime.
import {
  ENVIRONMENT_SYNC_CHUNK_BYTES,
  WS_METHODS,
  repositoryGroupingKeyOf,
  type EnvironmentId,
  type EnvironmentSyncAcceptInput,
  type EnvironmentSyncAcceptResult,
  type EnvironmentSyncExportInput,
  type EnvironmentSyncExportResult,
  type EnvironmentSyncImportResult,
  type EnvironmentSyncImportStage,
  type EnvironmentSyncManifest,
  type EnvironmentSyncPeer,
  type EnvironmentSyncPrepareInput,
  type EnvironmentSyncPrepareResult,
  type EnvironmentSyncSessionInput,
  type EnvironmentSyncStatusResult,
  type ProjectId,
  type RepositoryIdentity,
  type ThreadId,
} from "@t3tools/contracts";
import type { Atom, AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "./runtime.ts";

const STATUS_POLL_MS = 600;

/**
 * RPC commands for copying a project between environments. Each client
 * instantiates it with its own connection runtime.
 */
export function createEnvironmentSyncAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    prepare: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:environment-sync:prepare",
      tag: WS_METHODS.environmentSyncPrepare,
    }),
    export: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:environment-sync:export",
      tag: WS_METHODS.environmentSyncExport,
    }),
    accept: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:environment-sync:accept",
      tag: WS_METHODS.environmentSyncAccept,
    }),
    commit: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:environment-sync:commit",
      tag: WS_METHODS.environmentSyncCommit,
    }),
    status: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:environment-sync:status",
      tag: WS_METHODS.environmentSyncStatus,
    }),
    release: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:environment-sync:release",
      tag: WS_METHODS.environmentSyncRelease,
    }),
    undo: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:environment-sync:undo",
      tag: WS_METHODS.environmentSyncUndo,
    }),
  };
}

interface SyncCommand<Input, Result> {
  readonly label: string;
  readonly run: (
    registry: AtomRegistry.AtomRegistry,
    value: { readonly environmentId: EnvironmentId; readonly input: Input },
  ) => Promise<AtomCommandResult<Result, unknown>>;
}

/** The commands a sync run sends, as `createEnvironmentSyncAtoms` provides them. */
export interface EnvironmentSyncCommands {
  readonly prepare: SyncCommand<EnvironmentSyncPrepareInput, EnvironmentSyncPrepareResult>;
  readonly export: SyncCommand<EnvironmentSyncExportInput, EnvironmentSyncExportResult>;
  readonly accept: SyncCommand<EnvironmentSyncAcceptInput, EnvironmentSyncAcceptResult>;
  readonly commit: SyncCommand<EnvironmentSyncSessionInput, unknown>;
  readonly status: SyncCommand<EnvironmentSyncSessionInput, EnvironmentSyncStatusResult>;
  readonly release: SyncCommand<EnvironmentSyncSessionInput, unknown>;
}

export type EnvironmentSyncProgress =
  | { readonly stage: "preparing" }
  | { readonly stage: "exporting" }
  | {
      readonly stage: "transferring";
      readonly transferredBytes: number;
      readonly totalBytes: number;
    }
  | {
      readonly stage: "importing";
      readonly step: EnvironmentSyncImportStage;
      readonly completed: number;
      readonly total: number;
    };

export type EnvironmentSyncOutcome =
  | {
      readonly status: "synced";
      readonly manifest: EnvironmentSyncManifest;
      readonly result: EnvironmentSyncImportResult;
    }
  | {
      readonly status: "failed";
      readonly step: "prepare" | "export" | "accept" | "transfer" | "import";
      readonly message: string;
    };

function failureMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim() !== "") return message;
  }
  return fallback;
}

function partUrl(prefix: string, partId: string, query: string): string {
  return `${prefix}/${encodeURIComponent(partId)}?${query}`;
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });

/**
 * Copies a project and the given threads from one environment to another.
 * Neither server can reach the other, so the bytes pass through this client:
 * the target says what it already has, the source exports the difference, and
 * the parts are relayed chunk by chunk.
 */
export async function runEnvironmentSync(input: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly commands: EnvironmentSyncCommands;
  readonly source: EnvironmentSyncPeer;
  readonly target: EnvironmentSyncPeer;
  readonly sourceProjectId: ProjectId;
  readonly prepare: Omit<EnvironmentSyncPrepareInput, "source">;
  /** Absolute URL on an environment for a relative path it returned. Null when disconnected. */
  readonly resolveUrl: (environmentId: EnvironmentId, relativePath: string) => string | null;
  readonly fetch?: typeof globalThis.fetch;
  readonly onProgress?: (progress: EnvironmentSyncProgress) => void;
  readonly statusPollMs?: number;
}): Promise<EnvironmentSyncOutcome> {
  const { registry, commands, source, target } = input;
  const fetchBytes = input.fetch ?? globalThis.fetch.bind(globalThis);
  const quiet = { reportFailure: false, reportDefect: false } as const;
  const failed = (
    step: Extract<EnvironmentSyncOutcome, { status: "failed" }>["step"],
    message: string,
  ): EnvironmentSyncOutcome => ({ status: "failed", step, message });
  const release = (environmentId: EnvironmentId, sessionId: string) =>
    void runAtomCommand(registry, commands.release, { environmentId, input: { sessionId } }, quiet);

  input.onProgress?.({ stage: "preparing" });
  const prepared = await runAtomCommand(
    registry,
    commands.prepare,
    { environmentId: target.environmentId, input: { ...input.prepare, source } },
    quiet,
  );
  if (prepared._tag !== "Success") {
    return failed(
      "prepare",
      failureMessage(squashAtomCommandFailure(prepared), `${target.label} could not prepare.`),
    );
  }
  const transferId = prepared.value.transferId;

  input.onProgress?.({ stage: "exporting" });
  const exported = await runAtomCommand(
    registry,
    commands.export,
    {
      environmentId: source.environmentId,
      input: {
        projectId: input.sourceProjectId,
        rootThreadIds: input.prepare.rootThreadIds,
        target,
        gitHaves: prepared.value.gitHaves,
        threadHeads: prepared.value.threadHeads,
      },
    },
    quiet,
  );
  if (exported._tag !== "Success") {
    release(target.environmentId, transferId);
    return failed(
      "export",
      failureMessage(squashAtomCommandFailure(exported), `${source.label} could not export.`),
    );
  }
  const { manifest, downloadPath } = exported.value;
  const releaseBoth = () => {
    release(source.environmentId, manifest.exportId);
    release(target.environmentId, transferId);
  };

  const accepted = await runAtomCommand(
    registry,
    commands.accept,
    { environmentId: target.environmentId, input: { transferId, manifest } },
    quiet,
  );
  if (accepted._tag !== "Success") {
    releaseBoth();
    return failed(
      "accept",
      failureMessage(squashAtomCommandFailure(accepted), `${target.label} refused the transfer.`),
    );
  }

  const needed = manifest.parts.filter((part) => accepted.value.neededPartIds.includes(part.id));
  const totalBytes = needed.reduce((sum, part) => sum + part.sizeBytes, 0);
  let transferredBytes = 0;
  input.onProgress?.({ stage: "transferring", transferredBytes, totalBytes });
  try {
    for (const part of needed) {
      for (let offset = 0; offset < part.sizeBytes; offset += ENVIRONMENT_SYNC_CHUNK_BYTES) {
        const length = Math.min(ENVIRONMENT_SYNC_CHUNK_BYTES, part.sizeBytes - offset);
        const readUrl = input.resolveUrl(
          source.environmentId,
          partUrl(downloadPath, part.id, `offset=${offset}&length=${length}`),
        );
        const writeUrl = input.resolveUrl(
          target.environmentId,
          partUrl(accepted.value.uploadPath, part.id, `offset=${offset}`),
        );
        if (readUrl === null || writeUrl === null) {
          throw new Error("An environment disconnected during the transfer.");
        }
        const download = await fetchBytes(readUrl);
        if (!download.ok) throw new Error(`${source.label} stopped serving the transfer.`);
        const chunk = await download.arrayBuffer();
        if (chunk.byteLength !== length) throw new Error("A chunk arrived incomplete.");
        const upload = await fetchBytes(writeUrl, {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: chunk,
        });
        if (!upload.ok) throw new Error(`${target.label} did not accept the transfer.`);
        transferredBytes += length;
        input.onProgress?.({ stage: "transferring", transferredBytes, totalBytes });
      }
    }
  } catch (error) {
    releaseBoth();
    return failed("transfer", failureMessage(error, "The transfer was interrupted."));
  }

  const committed = await runAtomCommand(
    registry,
    commands.commit,
    { environmentId: target.environmentId, input: { sessionId: transferId } },
    quiet,
  );
  release(source.environmentId, manifest.exportId);
  if (committed._tag !== "Success") {
    release(target.environmentId, transferId);
    return failed(
      "import",
      failureMessage(squashAtomCommandFailure(committed), `${target.label} could not import.`),
    );
  }

  // The import runs on the target after `commit` returns and survives a dropped connection.
  let consecutiveFailures = 0;
  for (;;) {
    const status = await runAtomCommand(
      registry,
      commands.status,
      { environmentId: target.environmentId, input: { sessionId: transferId } },
      quiet,
    );
    if (status._tag !== "Success") {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 20) {
        return failed(
          "import",
          failureMessage(squashAtomCommandFailure(status), `Lost contact with ${target.label}.`),
        );
      }
    } else {
      consecutiveFailures = 0;
      const value = status.value;
      if (value.phase === "done") {
        release(target.environmentId, transferId);
        return { status: "synced", manifest, result: value.result };
      }
      if (value.phase === "failed") {
        release(target.environmentId, transferId);
        return failed("import", value.message);
      }
      if (value.phase === "importing") {
        input.onProgress?.({
          stage: "importing",
          step: value.stage,
          completed: value.completed,
          total: value.total,
        });
      }
    }
    await wait(input.statusPollMs ?? STATUS_POLL_MS);
  }
}

/**
 * The project on `targetEnvironmentId` that a sync should land in. That is one
 * a previous sync created under the same id, otherwise a checkout of the same
 * repository.
 */
export function findEnvironmentSyncTargetProject<
  Project extends {
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
    readonly repositoryIdentity?: RepositoryIdentity | null | undefined;
  },
>(input: {
  readonly sourceProject: Project;
  readonly targetEnvironmentId: EnvironmentId;
  readonly projects: ReadonlyArray<Project>;
}): Project | null {
  const candidates = input.projects.filter(
    (project) => project.environmentId === input.targetEnvironmentId,
  );
  const sameId = candidates.find((project) => project.id === input.sourceProject.id);
  if (sameId !== undefined) return sameId;
  const identity = input.sourceProject.repositoryIdentity;
  if (identity === null || identity === undefined) return null;
  const key = repositoryGroupingKeyOf(identity);
  return (
    candidates.find(
      (project) =>
        project.repositoryIdentity != null &&
        repositoryGroupingKeyOf(project.repositoryIdentity) === key,
    ) ?? null
  );
}

/**
 * Threads a project sync carries: the one in view, and every other thread
 * still in play. Finished threads stay where they are until someone opens one
 * and syncs it. Child threads travel with their root.
 */
export function selectEnvironmentSyncThreadIds<
  Thread extends {
    readonly id: ThreadId;
    readonly projectId: ProjectId;
    readonly archivedAt: string | null;
    readonly deletedAt: string | null;
    readonly settledAt: string | null;
    readonly settledOverride: "settled" | "active" | null;
    readonly lineage: { readonly parentThreadId: ThreadId | null };
  },
>(input: {
  readonly projectId: ProjectId;
  readonly threads: ReadonlyArray<Thread>;
  readonly currentThreadId: ThreadId | null;
}): ReadonlyArray<ThreadId> {
  const selected = new Set<ThreadId>();
  if (input.currentThreadId !== null) selected.add(input.currentThreadId);
  for (const thread of input.threads) {
    const settled =
      thread.settledOverride === "settled" ||
      (thread.settledAt !== null && thread.settledOverride !== "active");
    if (
      thread.projectId === input.projectId &&
      thread.lineage.parentThreadId === null &&
      thread.archivedAt === null &&
      thread.deletedAt === null &&
      !settled
    ) {
      selected.add(thread.id);
    }
  }
  return [...selected];
}
