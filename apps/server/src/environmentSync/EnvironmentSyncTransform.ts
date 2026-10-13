import type {
  EventId,
  OrchestrationV2AppThread,
  OrchestrationV2DomainEvent,
  ProjectId,
  ThreadEnvironmentSync,
  ThreadId,
} from "@t3tools/contracts";
import type * as DateTime from "effect/DateTime";

/** A workspace directory on the source and where it lives on this environment. */
export interface SyncedPathMapping {
  readonly from: string;
  readonly to: string;
}

function isPathPrefix(prefix: string, value: string): boolean {
  if (value === prefix) return true;
  const separator = prefix.includes("\\") && !prefix.includes("/") ? "\\" : "/";
  return value.startsWith(prefix.endsWith(separator) ? prefix : `${prefix}${separator}`);
}

/** Rewrites `value` when it lies inside a synced workspace. The longest source path wins. */
export function mapSyncedPath(
  value: string,
  mappings: ReadonlyArray<SyncedPathMapping>,
): string | null {
  let best: SyncedPathMapping | null = null;
  for (const mapping of mappings) {
    if (
      isPathPrefix(mapping.from, value) &&
      (best === null || mapping.from.length > best.from.length)
    ) {
      best = mapping;
    }
  }
  return best === null ? null : `${best.to}${value.slice(best.from.length)}`;
}

/** Folder name `git worktree add` uses for a branch here, matching GitVcsDriver.createWorktree. */
export function worktreeFolderNameForBranch(branch: string): string {
  return branch.replace(/\//g, "-");
}

export interface ImportTransform {
  readonly projectId: ProjectId;
  readonly mappings: ReadonlyArray<SyncedPathMapping>;
  /** Where a thread's worktree goes when the source did not export that checkout. */
  readonly fallbackWorktreePath: (branch: string) => string;
  /** This environment's own import record for a thread, which the source's events must not erase. */
  readonly localEnvironmentSync: (threadId: ThreadId) => ThreadEnvironmentSync | undefined;
}

function importedThread(
  thread: OrchestrationV2AppThread,
  transform: ImportTransform,
): OrchestrationV2AppThread {
  const {
    workspaceSelections: _workspaceSelections,
    environmentSync: _environmentSync,
    ...rest
  } = thread;
  const worktreePath =
    thread.worktreePath === null
      ? null
      : (transform.mappings.find((mapping) => mapping.from === thread.worktreePath)?.to ??
        (thread.branch === null ? null : transform.fallbackWorktreePath(thread.branch)));
  const environmentSync = transform.localEnvironmentSync(thread.id);
  return {
    ...rest,
    ...(environmentSync === undefined ? {} : { environmentSync }),
    projectId: transform.projectId,
    worktreePath,
    // A watch polls the pull request and wakes the agent. Only the environment
    // where the user set it up may do that, or both copies would run the turn.
    ...(thread.pullRequests === undefined
      ? {}
      : { pullRequests: thread.pullRequests.map(({ watch: _watch, ...link }) => link) }),
  };
}

/**
 * Adapts an event recorded on another environment to this one. Events stay
 * what they were, except for the fields that name a place or a process on the
 * source host: the project, workspace paths, and live provider sessions.
 */
export function transformImportedEvent(
  event: OrchestrationV2DomainEvent,
  transform: ImportTransform,
): OrchestrationV2DomainEvent {
  switch (event.type) {
    case "thread.created":
    case "thread.archived":
    case "thread.unarchived":
    case "thread.deleted":
    case "thread.settled":
    case "thread.unsettled":
    case "thread.snoozed":
    case "thread.unsnoozed":
    case "thread.pinned":
    case "thread.auto-settle-set":
    case "thread.unpinned":
    case "thread.pin-reordered":
    case "thread.active-reordered":
    case "thread.visited":
    case "thread.marked-unread":
    case "thread.metadata-updated":
    case "thread.pull-request-synced":
    case "thread.runtime-mode-updated":
    case "thread.interaction-mode-updated":
    case "thread.model-selection-updated":
    case "thread.provider-switched":
      return { ...event, payload: importedThread(event.payload, transform) };
    case "provider-session.attached":
    case "provider-session.updated":
      return {
        ...event,
        payload: {
          ...event.payload,
          // The process belongs to the source host. Here it never existed.
          status: event.payload.status === "error" ? "error" : "stopped",
          cwd: mapSyncedPath(event.payload.cwd, transform.mappings) ?? event.payload.cwd,
        },
      };
    case "checkpoint-scope.created":
      return {
        ...event,
        payload: {
          ...event.payload,
          cwd: mapSyncedPath(event.payload.cwd, transform.mappings) ?? event.payload.cwd,
        },
      };
    default:
      return event;
  }
}

/**
 * The event that closes an import. It holds the thread as this environment now
 * has it, marked with where it came from.
 */
export function environmentSyncMarkerEvent(input: {
  readonly eventId: EventId;
  readonly occurredAt: DateTime.Utc;
  readonly thread: OrchestrationV2AppThread;
  readonly environmentSync: ThreadEnvironmentSync;
}): OrchestrationV2DomainEvent {
  return {
    id: input.eventId,
    type: "thread.metadata-updated",
    threadId: input.thread.id,
    providerInstanceId: input.thread.providerInstanceId,
    occurredAt: input.occurredAt,
    payload: { ...input.thread, environmentSync: input.environmentSync },
  };
}
