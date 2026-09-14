import type { OrchestrationThreadShell, TerminalSummary } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import { ServerConfig } from "../config.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { TerminalManager } from "../terminal/Manager.ts";
import { forkParked } from "../serverActivation.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import { threadHasQueuedTurnStart } from "./ThreadSettlementPolicy.ts";

export const SETTLED_WORKTREE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export function isSettledWorktreeExpired(thread: OrchestrationThreadShell, now: number): boolean {
  if (
    thread.settledAt === null ||
    thread.settledOverride === "active" ||
    !thread.worktreePath ||
    !thread.branch ||
    thread.backgroundLiveness != null ||
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.session?.status === "running" ||
    thread.session?.status === "starting" ||
    threadHasQueuedTurnStart(thread, DateTime.formatIso(DateTime.makeUnsafe(now)))
  )
    return false;
  // Automatic settlement backdates settledAt to the last activity. updatedAt
  // records when settlement actually happened and prevents immediate deletion.
  const timestamps = [
    thread.settledAt,
    thread.updatedAt,
    thread.latestUserMessageAt,
    thread.latestTurn?.requestedAt,
    thread.latestTurn?.startedAt,
    thread.latestTurn?.completedAt,
  ]
    .filter((value): value is string => value != null)
    .map(Date.parse);
  return (
    timestamps.every(Number.isFinite) &&
    Math.max(...timestamps) <= now - SETTLED_WORKTREE_RETENTION_MS
  );
}

export class SettledWorktreeCleanup extends Context.Service<
  SettledWorktreeCleanup,
  {
    readonly sweep: Effect.Effect<void>;
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/orchestration/SettledWorktreeCleanup") {}

export const make = Effect.gen(function* () {
  const snapshots = yield* ProjectionSnapshotQuery;
  const git = yield* GitWorkflowService;
  const providers = yield* ProviderService;
  const terminals = yield* TerminalManager;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const readSnapshot = Effect.gen(function* () {
    const visible = yield* snapshots.getShellSnapshot();
    const archived = yield* snapshots.getArchivedShellSnapshot();
    return {
      projects: [...visible.projects, ...archived.projects],
      threads: [...visible.threads, ...archived.threads],
    };
  });
  const within = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return (
      relative === "" ||
      (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
    );
  };
  const terminalSnapshot = Effect.gen(function* () {
    const entries = new Map<string, TerminalSummary>();
    yield* Effect.acquireRelease(
      terminals.subscribeMetadata((event) =>
        Effect.sync(() => {
          const key = (entry: Pick<TerminalSummary, "threadId" | "terminalId">) =>
            JSON.stringify([entry.threadId, entry.terminalId]);
          if (event.type === "snapshot") {
            entries.clear();
            for (const terminal of event.terminals) entries.set(key(terminal), terminal);
          } else if (event.type === "upsert") entries.set(key(event.terminal), event.terminal);
          else entries.delete(key(event));
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    return [...entries.values()];
  }).pipe(Effect.scoped);
  const canonical = (value: string) =>
    fs.realPath(value).pipe(Effect.orElseSucceed(() => path.resolve(value)));
  const sweep = Effect.gen(function* () {
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    const initial = yield* readSnapshot;
    const candidates = initial.threads.filter((thread) => isSettledWorktreeExpired(thread, now));
    if (candidates.length === 0 || !(yield* fs.exists(config.worktreesDir))) return;
    const managedRoot = yield* fs.realPath(config.worktreesDir);
    const visited = new Set<string>();
    for (const candidate of candidates) {
      yield* Effect.gen(function* () {
        const worktreePath = candidate.worktreePath!;
        if (!(yield* fs.exists(worktreePath))) return;
        const target = yield* fs.realPath(worktreePath);
        if (visited.has(target)) return;
        visited.add(target);
        if (target === managedRoot || !within(managedRoot, target)) return;
        // A linked Git worktree has a .git file. Never recursively delete a
        // project root, clone, or arbitrary directory based on its name.
        if ((yield* fs.stat(path.join(target, ".git"))).type !== "File") return;

        const stoppedOwners = new Map<string, OrchestrationThreadShell>();
        const validate = Effect.gen(function* () {
          const snapshot = yield* readSnapshot;
          const checkNow = DateTime.toEpochMillis(yield* DateTime.now);
          const owners: Array<OrchestrationThreadShell> = [];
          for (const project of snapshot.projects) {
            for (const root of [
              project.workspaceRoot,
              ...(project.workspaceRoots ?? []).map((root) => root.path),
            ]) {
              if (within(target, yield* canonical(root))) return null;
            }
          }
          for (const thread of snapshot.threads) {
            if (!thread.worktreePath) continue;
            const root = yield* canonical(thread.worktreePath);
            if (root === target) {
              const beforeStop = stoppedOwners.get(thread.id);
              // Closing our own idle session stamps updatedAt. Do not restart
              // the retention clock for that maintenance-only change.
              const expiryThread =
                beforeStop &&
                thread.session?.status === "stopped" &&
                thread.updatedAt === thread.session.updatedAt &&
                thread.settledAt === beforeStop.settledAt &&
                thread.branch === beforeStop.branch &&
                thread.latestUserMessageAt === beforeStop.latestUserMessageAt
                  ? { ...thread, updatedAt: beforeStop.updatedAt }
                  : thread;
              if (!isSettledWorktreeExpired(expiryThread, checkNow)) return null;
              owners.push(thread);
            } else if (within(target, root)) return null;
          }
          if (!owners.some((thread) => thread.id === candidate.id)) return null;
          const ids = new Set<string>(owners.map((thread) => thread.id));
          const sessions = [];
          for (const session of yield* providers.listSessions()) {
            if (!session.cwd || !within(target, yield* canonical(session.cwd))) continue;
            if (
              !ids.has(session.threadId) ||
              session.status === "running" ||
              session.status === "connecting"
            )
              return null;
            sessions.push(session);
          }
          const idleTerminals = [];
          for (const terminal of yield* terminalSnapshot) {
            if (!within(target, yield* canonical(terminal.cwd))) continue;
            if (
              !ids.has(terminal.threadId) ||
              terminal.hasRunningSubprocess ||
              terminal.status === "starting"
            )
              return null;
            idleTerminals.push(terminal);
          }
          const project = snapshot.projects.find((project) => project.id === candidate.projectId);
          return project ? { project, owners, sessions, idleTerminals } : null;
        });
        const active = yield* validate;
        if (!active) return;
        yield* git.invalidateLocalStatus(target);
        const status = yield* git.localStatus({ cwd: target });
        if (
          !status.isRepo ||
          status.hasWorkingTreeChanges ||
          !status.refName ||
          active.owners.some((thread) => thread.branch !== status.refName)
        )
          return;
        const ready = yield* validate;
        if (!ready) return;
        for (const session of ready.sessions) {
          const owner = active.owners.find((thread) => thread.id === session.threadId);
          if (owner) stoppedOwners.set(owner.id, owner);
          yield* providers.stopSession({ threadId: session.threadId });
        }
        for (const terminal of ready.idleTerminals)
          yield* terminals.close({ threadId: terminal.threadId, terminalId: terminal.terminalId });
        if (!(yield* validate)) return;
        // No force: Git refuses dirty, locked, or otherwise unsafe worktrees.
        // Keep branch and thread metadata so resuming recreates this checkout.
        yield* git.removeWorktree({ cwd: active.project.workspaceRoot, path: target });
        yield* Effect.logInfo("removed expired settled-thread worktree", {
          path: target,
          threadIds: active.owners.map((thread) => thread.id),
        });
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause as Cause.Cause<never>)
            : Effect.logWarning("settled worktree cleanup skipped", {
                threadId: candidate.id,
                cause: Cause.pretty(cause),
              }),
        ),
      );
    }
  }).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause as Cause.Cause<never>)
        : Effect.logWarning("settled worktree cleanup failed", { cause: Cause.pretty(cause) }),
    ),
  );
  const worker = yield* makeDrainableWorker(() => sweep);
  const start = () =>
    forkParked(
      Effect.gen(function* () {
        yield* worker.enqueue(undefined);
        yield* worker.drain;
      }).pipe(Effect.repeat(Schedule.spaced("1 hour")), Effect.asVoid),
    );
  return { sweep, start, drain: worker.drain };
});

export const layer = Layer.effect(SettledWorktreeCleanup, make);
