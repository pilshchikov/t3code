/**
 * EnvironmentSyncGit - moves a repository between two hosts for environment
 * sync, and keeps the receiving side recoverable.
 *
 * The receiving side never rewinds or rewrites a branch. Branches are created
 * or fast-forwarded, and a checkout is only replaced after its current state
 * is saved to a restore point that `undo` can put back.
 *
 * @module EnvironmentSyncGit
 */
import {
  CheckpointRef,
  EnvironmentSyncError,
  type EnvironmentSyncGitExport,
  type EnvironmentSyncGitRef,
  type EnvironmentSyncWorkspace,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { worktreeFolderNameForBranch } from "./EnvironmentSyncTransform.ts";

const GIT_TIMEOUT_MS = 60_000;
const GIT_TRANSFER_TIMEOUT_MS = 30 * 60_000;
const GIT_OUTPUT_MAX_BYTES = 32 * 1024 * 1024;
const MAX_HAVES = 20_000;
const RESTORE_POINTS_KEPT = 10;
const EXPORT_REF_PREFIX = "refs/t3-sync/export";
const RESTORE_REF_PREFIX = "refs/t3-sync/restore";
/**
 * The snapshot each checkout last sent or received. It tells new local work
 * apart from what a sync put there, and it keeps those objects reachable so
 * the other side does not send untracked files again.
 */
const SYNCED_REF_PREFIX = "refs/t3-sync/synced";
const CHECKPOINT_REF_PREFIX = "refs/t3/orchestration-v2/checkpoints";
/** Branches an import creates for a source branch that diverged from the target's. */
const DIVERGED_BRANCH_PREFIX = "t3-sync/";

const RestorePoint = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  kind: Schema.Literals(["sync", "undo"]),
  workspaceRoot: Schema.String,
  sourceLabel: Schema.String,
  checkouts: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      branch: Schema.NullOr(Schema.String),
      head: Schema.String,
      snapshotRef: Schema.String,
    }),
  ),
  branches: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      previousSha: Schema.String,
      syncedSha: Schema.String,
    }),
  ),
});
type RestorePoint = typeof RestorePoint.Type;
type MutableRestorePoint = {
  -readonly [K in keyof RestorePoint]: RestorePoint[K] extends ReadonlyArray<infer Item>
    ? Array<Item>
    : RestorePoint[K];
};

const decodeRestorePoint = Schema.decodeUnknownEffect(Schema.fromJsonString(RestorePoint));
const encodeRestorePoint = Schema.encodeEffect(Schema.fromJsonString(RestorePoint));

export interface ExportCheckout {
  readonly kind: "root" | "worktree";
  readonly path: string;
  readonly threadIds: ReadonlyArray<ThreadId>;
}

export interface PlannedCheckout {
  readonly workspace: EnvironmentSyncWorkspace;
  readonly targetPath: string;
  /** Why this checkout is left as it is, when it is. */
  readonly skip: string | null;
}

export interface ApplyRepositoryResult {
  readonly warnings: ReadonlyArray<string>;
  /** Agent-facing notes per target checkout path. */
  readonly notes: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly restorePointId: string | null;
}

export interface UndoResult {
  readonly restorePointId: string;
  readonly newRestorePointId: string | null;
  readonly restoredCheckouts: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}

export class EnvironmentSyncGit extends Context.Service<
  EnvironmentSyncGit,
  {
    /** Commits this repository already has. Empty when the folder is not a repository. */
    readonly listHaves: (
      workspaceRoot: string,
    ) => Effect.Effect<ReadonlyArray<string>, EnvironmentSyncError>;
    /**
     * Snapshots every checkout and writes a bundle of what the target lacks.
     * `git` is null when the folder is not the root of a repository with a commit.
     */
    readonly exportRepository: (input: {
      readonly workspaceRoot: string;
      readonly checkouts: ReadonlyArray<ExportCheckout>;
      readonly haves: ReadonlyArray<string>;
      readonly checkpointRefs: ReadonlySet<string>;
      readonly bundlePath: string;
      readonly exportId: string;
    }) => Effect.Effect<
      {
        readonly git: EnvironmentSyncGitExport | null;
        readonly bundleCreated: boolean;
        readonly warnings: ReadonlyArray<string>;
      },
      EnvironmentSyncError
    >;
    readonly releaseExport: (input: {
      readonly workspaceRoot: string;
      readonly exportId: string;
    }) => Effect.Effect<void>;
    /** Where each exported checkout lives on this host. */
    readonly planCheckouts: (input: {
      readonly workspaceRoot: string;
      readonly worktreesDirectory: string;
      readonly workspaces: ReadonlyArray<EnvironmentSyncWorkspace>;
    }) => Effect.Effect<ReadonlyArray<PlannedCheckout>, EnvironmentSyncError>;
    readonly applyRepository: (input: {
      readonly projectId: ProjectId;
      readonly workspaceRoot: string;
      readonly sourceLabel: string;
      readonly hostLabel: string;
      readonly git: EnvironmentSyncGitExport;
      readonly bundlePath: string | null;
      readonly exportId: string;
      readonly checkouts: ReadonlyArray<PlannedCheckout>;
    }) => Effect.Effect<ApplyRepositoryResult, EnvironmentSyncError>;
    readonly undo: (input: {
      readonly projectId: ProjectId;
      readonly restorePointId?: string | undefined;
    }) => Effect.Effect<UndoResult, EnvironmentSyncError>;
  }
>()("t3/environmentSync/EnvironmentSyncGit") {}

function firstLine(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 300 ? `${line.slice(0, 299)}…` : line;
}

/** A ref-safe name for a checkout path. */
function checkoutKey(checkoutPath: string): string {
  let first = 0x811c9dc5;
  let second = 5381;
  for (let index = 0; index < checkoutPath.length; index += 1) {
    const code = checkoutPath.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = (Math.imul(second, 33) + code) | 0;
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function branchSlug(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "other" : slug;
}

const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const checkpoints = yield* CheckpointStore.CheckpointStore;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;

  const repositoryError = (detail: string, cause?: unknown) =>
    new EnvironmentSyncError({
      reason: "repository_failed",
      detail,
      ...(cause === undefined ? {} : { cause }),
    });

  const run = (
    cwd: string,
    args: ReadonlyArray<string>,
    options?: { readonly stdin?: string; readonly timeoutMs?: number },
  ) =>
    git
      .execute({
        operation: "EnvironmentSyncGit",
        cwd,
        args,
        allowNonZeroExit: true,
        timeoutMs: options?.timeoutMs ?? GIT_TIMEOUT_MS,
        maxOutputBytes: GIT_OUTPUT_MAX_BYTES,
        appendTruncationMarker: true,
        ...(options?.stdin === undefined ? {} : { stdin: options.stdin }),
      })
      .pipe(Effect.mapError((cause) => repositoryError(`git ${args[0]} could not run.`, cause)));

  const ok = (
    cwd: string,
    args: ReadonlyArray<string>,
    options?: { readonly stdin?: string; readonly timeoutMs?: number },
  ) =>
    run(cwd, args, options).pipe(
      Effect.flatMap((result) =>
        result.exitCode === 0
          ? Effect.succeed(result.stdout)
          : Effect.fail(
              repositoryError(
                `git ${args[0]} failed: ${firstLine(result.stderr) || `exit code ${result.exitCode}`}`,
              ),
            ),
      ),
    );

  const exists = (target: string) =>
    fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false));

  const realPath = (target: string) =>
    fileSystem.realPath(target).pipe(Effect.orElseSucceed(() => path.resolve(target)));

  const isRepository = (cwd: string) =>
    exists(cwd).pipe(
      Effect.flatMap((present) =>
        present
          ? run(cwd, ["rev-parse", "--is-inside-work-tree"]).pipe(
              Effect.map((result) => result.exitCode === 0 && result.stdout.trim() === "true"),
            )
          : Effect.succeed(false),
      ),
    );

  const resolveSha = (cwd: string, revision: string) =>
    run(cwd, ["rev-parse", "--verify", "--quiet", revision]).pipe(
      Effect.map((result) => (result.exitCode === 0 ? result.stdout.trim() || null : null)),
    );

  const inspect = Effect.fn("EnvironmentSyncGit.inspect")(function* (cwd: string) {
    const head = yield* resolveSha(cwd, "HEAD");
    const branch = yield* run(cwd, ["symbolic-ref", "--short", "--quiet", "HEAD"]);
    return {
      head,
      branch: branch.exitCode === 0 && branch.stdout.trim() !== "" ? branch.stdout.trim() : null,
    };
  });

  const isDirty = (cwd: string) =>
    ok(cwd, ["status", "--porcelain"]).pipe(Effect.map((stdout) => stdout.trim() !== ""));

  const isAncestor = (cwd: string, ancestor: string, descendant: string) =>
    run(cwd, ["merge-base", "--is-ancestor", ancestor, descendant]).pipe(
      Effect.map((result) => result.exitCode === 0),
    );

  const readRefs = Effect.fn("EnvironmentSyncGit.readRefs")(function* (
    cwd: string,
    patterns: ReadonlyArray<string>,
  ) {
    const stdout = yield* ok(cwd, [
      "for-each-ref",
      "--format=%(objectname) %(refname)",
      ...patterns,
    ]);
    const refs = new Map<string, string>();
    for (const line of stdout.split("\n")) {
      const separator = line.indexOf(" ");
      if (separator <= 0) continue;
      refs.set(line.slice(separator + 1).trim(), line.slice(0, separator));
    }
    return refs;
  });

  const updateRefs = (cwd: string, commands: ReadonlyArray<string>) =>
    commands.length === 0
      ? Effect.void
      : ok(cwd, ["update-ref", "--stdin"], { stdin: `${commands.join("\n")}\n` }).pipe(
          Effect.asVoid,
        );

  const deleteRefsUnder = (cwd: string, prefix: string) =>
    readRefs(cwd, [prefix]).pipe(
      Effect.flatMap((refs) =>
        updateRefs(
          cwd,
          [...refs.keys()].map((name) => `delete ${name}`),
        ),
      ),
    );

  const existingObjects = Effect.fn("EnvironmentSyncGit.existingObjects")(function* (
    cwd: string,
    shas: ReadonlyArray<string>,
  ) {
    const candidates = [...new Set(shas.filter((sha) => /^[0-9a-f]{40,64}$/i.test(sha)))];
    const present = new Map<string, string>();
    if (candidates.length === 0) return present;
    const stdout = yield* ok(cwd, ["cat-file", "--batch-check"], {
      stdin: `${candidates.join("\n")}\n`,
    });
    for (const line of stdout.split("\n")) {
      const [sha, type] = line.trim().split(" ");
      if (sha !== undefined && type !== undefined && type !== "missing") present.set(sha, type);
    }
    return present;
  });

  const listWorktrees = Effect.fn("EnvironmentSyncGit.listWorktrees")(function* (cwd: string) {
    const stdout = yield* ok(cwd, ["worktree", "list", "--porcelain"]);
    const worktrees: Array<{ path: string; branch: string | null }> = [];
    let current: { path: string; branch: string | null } | null = null;
    for (const line of stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        current = { path: line.slice("worktree ".length), branch: null };
        worktrees.push(current);
      } else if (line.startsWith("branch refs/heads/") && current !== null) {
        current.branch = line.slice("branch refs/heads/".length);
      }
    }
    return worktrees;
  });

  const capture = (cwd: string, ref: string) =>
    checkpoints
      .captureCheckpoint({ cwd, checkpointRef: CheckpointRef.make(ref) })
      .pipe(
        Effect.mapError((cause) =>
          repositoryError(`Could not save the working tree of ${cwd}.`, cause),
        ),
      );

  const restore = (cwd: string, ref: string) =>
    checkpoints
      .restoreCheckpoint({ cwd, checkpointRef: CheckpointRef.make(ref) })
      .pipe(
        Effect.mapError((cause) =>
          repositoryError(`Could not write the working tree of ${cwd}.`, cause),
        ),
      );

  const checkout = (cwd: string, branch: string | null, sha: string) =>
    ok(
      cwd,
      branch === null
        ? ["checkout", "--force", "--detach", sha]
        : ["checkout", "--force", "-B", branch, sha],
      { timeoutMs: GIT_TRANSFER_TIMEOUT_MS },
    );

  const restorePointsDir = (projectId: ProjectId) =>
    path.join(config.stateDir, "environment-sync", "restore-points", encodeURIComponent(projectId));

  const syncedRef = (checkoutPath: string) => `${SYNCED_REF_PREFIX}/${checkoutKey(checkoutPath)}`;

  /** A snapshot commit holds the working tree and has the checkout's HEAD as its parent. */
  const readSynced = Effect.fn("EnvironmentSyncGit.readSynced")(function* (
    root: string,
    checkoutPath: string,
  ) {
    const ref = syncedRef(checkoutPath);
    const tree = yield* resolveSha(root, `${ref}^{tree}`);
    return tree === null ? null : { tree, head: yield* resolveSha(root, `${ref}^`) };
  });

  const recordSynced = (root: string, checkoutPath: string, snapshot: string) =>
    resolveSha(root, snapshot).pipe(
      Effect.flatMap((sha) =>
        sha === null ? Effect.void : updateRefs(root, [`update ${syncedRef(checkoutPath)} ${sha}`]),
      ),
      Effect.ignore,
    );

  const emptyRestorePoint = (input: {
    readonly id: string;
    readonly kind: RestorePoint["kind"];
    readonly workspaceRoot: string;
    readonly sourceLabel: string;
  }) =>
    Effect.map(DateTime.now, (now): MutableRestorePoint => ({
      ...input,
      createdAt: DateTime.formatIso(now),
      checkouts: [],
      branches: [],
    }));

  // Ids sort by a sequence number, so the newest is last even within one clock tick.
  const newRestorePointId = (projectId: ProjectId) =>
    Effect.gen(function* () {
      const latest = (yield* listRestorePointIds(projectId)).at(-1);
      const sequence = latest === undefined ? 1 : Number.parseInt(latest.slice(0, 8), 10) + 1;
      const stamp = DateTime.formatIso(yield* DateTime.now)
        .replace(/[^0-9]/g, "")
        .slice(0, 14);
      return `${String(Number.isNaN(sequence) ? 1 : sequence).padStart(8, "0")}-${stamp}`;
    });

  const listRestorePointIds = (projectId: ProjectId) =>
    fileSystem.readDirectory(restorePointsDir(projectId)).pipe(
      Effect.map((entries) =>
        entries
          .filter((entry) => entry.endsWith(".json"))
          .map((entry) => entry.slice(0, -".json".length))
          .toSorted(),
      ),
      Effect.orElseSucceed((): ReadonlyArray<string> => []),
    );

  const saveRestorePoint = Effect.fn("EnvironmentSyncGit.saveRestorePoint")(
    function* (projectId: ProjectId, point: RestorePoint) {
      const directory = restorePointsDir(projectId);
      yield* fileSystem.makeDirectory(directory, { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(directory, `${point.id}.json`),
        yield* encodeRestorePoint(point),
      );
      const stale = (yield* listRestorePointIds(projectId)).slice(0, -RESTORE_POINTS_KEPT);
      for (const id of stale) {
        yield* fileSystem.remove(path.join(directory, `${id}.json`), { force: true });
        yield* deleteRefsUnder(point.workspaceRoot, `${RESTORE_REF_PREFIX}/${id}`).pipe(
          Effect.ignore,
        );
      }
    },
    Effect.mapError(
      (cause) =>
        new EnvironmentSyncError({
          reason: "storage_failed",
          detail: "Could not record the restore point.",
          cause,
        }),
    ),
  );

  const loadRestorePoint = Effect.fn("EnvironmentSyncGit.loadRestorePoint")(function* (
    projectId: ProjectId,
    restorePointId: string | undefined,
  ) {
    const ids = yield* listRestorePointIds(projectId);
    const id = restorePointId ?? ids.at(-1);
    const notFound = new EnvironmentSyncError({
      reason: "restore_point_not_found",
      detail: "There is no sync to undo for this project on this machine.",
    });
    if (id === undefined || !ids.includes(id)) return yield* notFound;
    return yield* fileSystem
      .readFileString(path.join(restorePointsDir(projectId), `${id}.json`))
      .pipe(
        Effect.flatMap(decodeRestorePoint),
        Effect.mapError(() => notFound),
      );
  });

  const listHaves: EnvironmentSyncGit["Service"]["listHaves"] = Effect.fn(
    "EnvironmentSyncGit.listHaves",
  )(function* (workspaceRoot) {
    if (!(yield* isRepository(workspaceRoot))) return [];
    const stdout = yield* ok(workspaceRoot, ["for-each-ref", "--format=%(objectname)"]);
    return [...new Set(stdout.split("\n").filter((line) => line.trim() !== ""))].slice(
      0,
      MAX_HAVES,
    );
  });

  const exportRepository: EnvironmentSyncGit["Service"]["exportRepository"] = Effect.fn(
    "EnvironmentSyncGit.exportRepository",
  )(function* (input) {
    const notExported = (warning: string) => ({
      git: null,
      bundleCreated: false,
      warnings: [warning],
    });
    const root = input.workspaceRoot;
    if (!(yield* isRepository(root))) {
      return notExported("This project is not a Git repository, so its files were not copied.");
    }
    const toplevel = (yield* ok(root, ["rev-parse", "--show-toplevel"])).trim();
    if ((yield* realPath(toplevel)) !== (yield* realPath(root))) {
      return notExported(
        "This project is a folder inside a larger Git repository, so its files were not copied.",
      );
    }
    if ((yield* resolveSha(root, "HEAD")) === null) {
      return notExported("This repository has no commits yet, so its files were not copied.");
    }

    const workspaces: Array<EnvironmentSyncWorkspace> = [];
    const warnings: Array<string> = [];
    for (const [index, entry] of input.checkouts.entries()) {
      if (!(yield* isRepository(entry.path))) continue;
      const state = yield* inspect(entry.path);
      if (state.head === null) continue;
      const snapshotRef = `${EXPORT_REF_PREFIX}/${input.exportId}/${index}`;
      yield* capture(entry.path, snapshotRef);
      workspaces.push({
        kind: entry.kind,
        sourcePath: entry.path,
        threadIds: entry.threadIds,
        branch: state.branch,
        head: state.head,
        snapshotRef,
      });
    }

    const refs: Array<EnvironmentSyncGitRef> = [];
    for (const [name, sha] of yield* readRefs(root, [
      "refs/heads",
      "refs/tags",
      `${EXPORT_REF_PREFIX}/${input.exportId}`,
    ])) {
      if (name.startsWith(`refs/heads/${DIVERGED_BRANCH_PREFIX}`)) continue;
      refs.push({ name, sha });
    }
    if (input.checkpointRefs.size > 0) {
      for (const [name, sha] of yield* readRefs(root, [CHECKPOINT_REF_PREFIX])) {
        if (input.checkpointRefs.has(name)) refs.push({ name, sha });
      }
    }

    const remotes = new Map<string, string>();
    for (const line of (yield* ok(root, ["remote", "-v"])).split("\n")) {
      const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim());
      if (match?.[1] !== undefined && match[2] !== undefined) remotes.set(match[1], match[2]);
    }

    // Excluding a commit only excludes what its history reaches. A snapshot is a
    // sibling of the one sent last time, so its tree is excluded by name too, or
    // every untracked file would travel again.
    const haves = [...(yield* existingObjects(root, input.haves))].flatMap(([sha, type]) =>
      type === "commit" || type === "tag" ? [`^${sha}`, `^${sha}^{tree}`] : [`^${sha}`],
    );
    const bundle = yield* run(root, ["bundle", "create", input.bundlePath, "--stdin"], {
      stdin: `${[...refs.map((ref) => ref.name), ...haves].join("\n")}\n`,
      timeoutMs: GIT_TRANSFER_TIMEOUT_MS,
    });
    const empty = bundle.exitCode !== 0 && /Refusing to create empty bundle/i.test(bundle.stderr);
    if (bundle.exitCode !== 0 && !empty) {
      return yield* repositoryError(`git bundle failed: ${firstLine(bundle.stderr)}`);
    }
    for (const workspace of workspaces) {
      yield* recordSynced(root, workspace.sourcePath, workspace.snapshotRef);
    }

    return {
      git: {
        remotes: [...remotes].map(([name, url]) => ({ name, url })),
        refs,
        workspaces,
        bundlePartId: null,
      },
      bundleCreated: !empty,
      warnings,
    };
  });

  const releaseExport: EnvironmentSyncGit["Service"]["releaseExport"] = (input) =>
    deleteRefsUnder(input.workspaceRoot, `${EXPORT_REF_PREFIX}/${input.exportId}`).pipe(
      Effect.ignore,
    );

  const planCheckouts: EnvironmentSyncGit["Service"]["planCheckouts"] = Effect.fn(
    "EnvironmentSyncGit.planCheckouts",
  )(function* (input) {
    const root = input.workspaceRoot;
    const worktrees = (yield* isRepository(root)) ? yield* listWorktrees(root) : [];
    const realRoot = yield* realPath(root);
    const plans: Array<PlannedCheckout> = [];
    for (const workspace of input.workspaces) {
      if (workspace.kind === "root") {
        plans.push({ workspace, targetPath: root, skip: null });
        continue;
      }
      const folder =
        workspace.branch === null
          ? `detached-${workspace.head.slice(0, 8)}`
          : worktreeFolderNameForBranch(workspace.branch);
      const standardPath = path.join(input.worktreesDirectory, path.basename(root), folder);
      const holder =
        workspace.branch === null
          ? undefined
          : worktrees.find((worktree) => worktree.branch === workspace.branch);
      if (holder === undefined) {
        plans.push({ workspace, targetPath: standardPath, skip: null });
      } else if ((yield* realPath(holder.path)) === realRoot) {
        plans.push({
          workspace,
          targetPath: standardPath,
          skip: `Branch ${workspace.branch} is checked out in the project folder here, so its worktree was not created.`,
        });
      } else {
        plans.push({ workspace, targetPath: holder.path, skip: null });
      }
    }
    return plans;
  });

  const ensureRepository = Effect.fn("EnvironmentSyncGit.ensureRepository")(function* (
    root: string,
    remotes: EnvironmentSyncGitExport["remotes"],
  ) {
    yield* fileSystem.makeDirectory(root, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new EnvironmentSyncError({
            reason: "destination_unavailable",
            detail: `Could not create ${root}.`,
            cause,
          }),
      ),
    );
    if (!(yield* isRepository(root))) {
      const entries = yield* fileSystem
        .readDirectory(root)
        .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
      if (entries.length > 0) {
        return yield* new EnvironmentSyncError({
          reason: "destination_unavailable",
          detail: `${root} already has files and is not a Git repository.`,
        });
      }
      yield* ok(root, ["init", "--quiet"]);
    }
    const existing = new Set((yield* ok(root, ["remote"])).split("\n").map((line) => line.trim()));
    for (const remote of remotes) {
      if (!existing.has(remote.name)) {
        yield* ok(root, ["remote", "add", remote.name, remote.url]);
      }
    }
  });

  const applyRepository: EnvironmentSyncGit["Service"]["applyRepository"] = Effect.fn(
    "EnvironmentSyncGit.applyRepository",
  )(function* (input) {
    const root = input.workspaceRoot;
    yield* ensureRepository(root, input.git.remotes);
    if (input.bundlePath !== null) {
      yield* ok(root, ["bundle", "unbundle", input.bundlePath], {
        timeoutMs: GIT_TRANSFER_TIMEOUT_MS,
      });
    }
    const wanted = input.git.refs.map((ref) => ref.sha);
    const present = yield* existingObjects(root, wanted);
    if (wanted.some((sha) => !present.has(sha))) {
      return yield* new EnvironmentSyncError({
        reason: "incomplete_transfer",
        detail: "The repository data did not arrive completely. Run the sync again.",
      });
    }

    const warnings: Array<string> = [];
    const notes = new Map<string, Array<string>>();
    const addNote = (targetPath: string, note: string) =>
      notes.set(targetPath, [...(notes.get(targetPath) ?? []), note]);
    const point = yield* emptyRestorePoint({
      id: yield* newRestorePointId(input.projectId),
      kind: "sync",
      workspaceRoot: root,
      sourceLabel: input.sourceLabel,
    });
    let restoreRefsWritten = false;

    const local = yield* readRefs(root, ["refs/heads", "refs/tags"]);
    yield* updateRefs(
      root,
      input.git.refs.flatMap((ref) =>
        ref.name.startsWith("refs/tags/")
          ? local.has(ref.name)
            ? []
            : [`create ${ref.name} ${ref.sha}`]
          : ref.name.startsWith("refs/heads/")
            ? []
            : [`update ${ref.name} ${ref.sha}`],
      ),
    );

    const worktrees = yield* listWorktrees(root);
    const checkedOut = new Map(
      worktrees.flatMap((worktree) =>
        worktree.branch === null ? [] : [[worktree.branch, worktree.path] as const],
      ),
    );
    const syncedBranches = new Set(
      input.checkouts.flatMap((plan) =>
        plan.skip === null && plan.workspace.branch !== null ? [plan.workspace.branch] : [],
      ),
    );
    // Other branches only move forward. One checked out here stays put, because
    // moving it under a checkout would make that checkout look modified.
    const branchCommands: Array<string> = [];
    for (const ref of input.git.refs) {
      if (!ref.name.startsWith("refs/heads/")) continue;
      const branch = ref.name.slice("refs/heads/".length);
      if (syncedBranches.has(branch)) continue;
      const current = local.get(ref.name);
      if (current === undefined) {
        branchCommands.push(`create ${ref.name} ${ref.sha}`);
      } else if (
        current !== ref.sha &&
        !checkedOut.has(branch) &&
        (yield* isAncestor(root, current, ref.sha))
      ) {
        branchCommands.push(`update ${ref.name} ${ref.sha} ${current}`);
        point.branches.push({ name: branch, previousSha: current, syncedSha: ref.sha });
      }
    }
    yield* updateRefs(root, branchCommands);

    const keepIncoming = Effect.fn(function* (index: number, workspace: EnvironmentSyncWorkspace) {
      const ref = `${RESTORE_REF_PREFIX}/${point.id}/incoming/${index}`;
      const sha = yield* resolveSha(root, workspace.snapshotRef);
      if (sha !== null) {
        yield* updateRefs(root, [`update ${ref} ${sha}`]);
        restoreRefsWritten = true;
      }
      return ref;
    });

    for (const [index, plan] of input.checkouts.entries()) {
      const { workspace, targetPath } = plan;
      if (plan.skip !== null) {
        yield* keepIncoming(index, workspace);
        warnings.push(plan.skip);
        continue;
      }
      const branchRef = workspace.branch === null ? null : `refs/heads/${workspace.branch}`;
      const branchTip = branchRef === null ? null : yield* resolveSha(root, branchRef);
      if (branchTip !== null && branchTip !== workspace.head) {
        const targetAhead = yield* isAncestor(root, workspace.head, branchTip);
        if (targetAhead || !(yield* isAncestor(root, branchTip, workspace.head))) {
          const incoming = yield* keepIncoming(index, workspace);
          if (targetAhead) {
            const message = `Branch ${workspace.branch} on ${input.hostLabel} is ahead of ${input.sourceLabel}, so its checkout was left as it is.`;
            warnings.push(message);
            addNote(
              targetPath,
              `${message} Uncommitted changes from ${input.sourceLabel} were not applied. They are saved as ${incoming}.`,
            );
          } else {
            const copy = `${DIVERGED_BRANCH_PREFIX}${branchSlug(input.sourceLabel)}/${workspace.branch}`;
            yield* updateRefs(root, [`update refs/heads/${copy} ${workspace.head}`]);
            const message = `Branch ${workspace.branch} has different commits on ${input.hostLabel} and ${input.sourceLabel}. The checkout here was left as it is, and the other version is on branch ${copy}.`;
            warnings.push(message);
            addNote(
              targetPath,
              `${message} Uncommitted changes from ${input.sourceLabel} are saved as ${incoming}.`,
            );
          }
          continue;
        }
      }

      const incomingTree = yield* resolveSha(root, `${workspace.snapshotRef}^{tree}`);
      if (!(yield* exists(targetPath))) {
        yield* fileSystem
          .makeDirectory(path.dirname(targetPath), { recursive: true })
          .pipe(
            Effect.mapError((cause) =>
              repositoryError(`Could not create ${path.dirname(targetPath)}.`, cause),
            ),
          );
        if (branchRef !== null && workspace.branch !== null) {
          if (branchTip !== workspace.head) {
            yield* updateRefs(root, [`update ${branchRef} ${workspace.head}`]);
            if (branchTip !== null) {
              point.branches.push({
                name: workspace.branch,
                previousSha: branchTip,
                syncedSha: workspace.head,
              });
            }
          }
          yield* git
            .createWorktree({ cwd: root, refName: workspace.branch, path: targetPath })
            .pipe(
              Effect.mapError((cause) =>
                repositoryError(`Could not create the worktree ${targetPath}.`, cause),
              ),
            );
        } else {
          yield* ok(root, ["worktree", "add", "--detach", targetPath, workspace.head], {
            timeoutMs: GIT_TRANSFER_TIMEOUT_MS,
          });
        }
        yield* restore(targetPath, workspace.snapshotRef);
        yield* recordSynced(root, targetPath, workspace.snapshotRef);
        continue;
      }

      const holder = workspace.branch === null ? undefined : checkedOut.get(workspace.branch);
      if (holder !== undefined && (yield* realPath(holder)) !== (yield* realPath(targetPath))) {
        yield* keepIncoming(index, workspace);
        warnings.push(
          `Branch ${workspace.branch} is checked out in ${holder} on ${input.hostLabel}, so ${targetPath} was left as it is.`,
        );
        continue;
      }

      const state = yield* inspect(targetPath);
      if (state.head !== null) {
        const snapshotRef = `${RESTORE_REF_PREFIX}/${point.id}/checkout/${index}`;
        yield* capture(targetPath, snapshotRef);
        const tree = yield* resolveSha(root, `${snapshotRef}^{tree}`);
        if (
          state.head === workspace.head &&
          state.branch === workspace.branch &&
          tree === incomingTree
        ) {
          yield* updateRefs(root, [`delete ${snapshotRef}`]);
          yield* recordSynced(root, targetPath, workspace.snapshotRef);
          continue;
        }
        restoreRefsWritten = true;
        point.checkouts.push({
          path: targetPath,
          branch: state.branch,
          head: state.head,
          snapshotRef,
        });
        // Work done here since the last sync is what the user did not expect to lose.
        const known = yield* readSynced(root, targetPath);
        const changedHere =
          known === null
            ? yield* isDirty(targetPath)
            : known.head !== state.head || known.tree !== tree;
        if (changedHere) {
          warnings.push(
            `${targetPath} had changes made on ${input.hostLabel} since the last sync. They were saved before the checkout was replaced, and Undo sync brings them back.`,
          );
        }
      }
      if (
        workspace.branch !== null &&
        branchTip !== null &&
        branchTip !== workspace.head &&
        state.branch !== workspace.branch
      ) {
        point.branches.push({
          name: workspace.branch,
          previousSha: branchTip,
          syncedSha: workspace.head,
        });
      }
      yield* checkout(targetPath, workspace.branch, workspace.head);
      yield* restore(targetPath, workspace.snapshotRef);
      yield* recordSynced(root, targetPath, workspace.snapshotRef);
    }

    yield* deleteRefsUnder(root, `${EXPORT_REF_PREFIX}/${input.exportId}`).pipe(Effect.ignore);
    const recorded = point.checkouts.length > 0 || point.branches.length > 0 || restoreRefsWritten;
    if (recorded) yield* saveRestorePoint(input.projectId, point);
    return {
      warnings,
      notes,
      restorePointId: point.checkouts.length > 0 || point.branches.length > 0 ? point.id : null,
    };
  });

  const undo: EnvironmentSyncGit["Service"]["undo"] = Effect.fn("EnvironmentSyncGit.undo")(
    function* (input) {
      const point = yield* loadRestorePoint(input.projectId, input.restorePointId);
      const root = point.workspaceRoot;
      const warnings: Array<string> = [];
      const restoredCheckouts: Array<string> = [];
      const next = yield* emptyRestorePoint({
        id: yield* newRestorePointId(input.projectId),
        kind: "undo",
        workspaceRoot: root,
        sourceLabel: point.sourceLabel,
      });

      for (const [index, entry] of point.checkouts.entries()) {
        if (!(yield* isRepository(entry.path))) {
          warnings.push(`${entry.path} no longer exists, so it was not restored.`);
          continue;
        }
        const state = yield* inspect(entry.path);
        if (state.head !== null) {
          const snapshotRef = `${RESTORE_REF_PREFIX}/${next.id}/checkout/${index}`;
          yield* capture(entry.path, snapshotRef);
          next.checkouts.push({
            path: entry.path,
            branch: state.branch,
            head: state.head,
            snapshotRef,
          });
        }
        yield* checkout(entry.path, entry.branch, entry.head);
        if (!(yield* restore(entry.path, entry.snapshotRef))) {
          warnings.push(`The saved working tree for ${entry.path} is gone.`);
          continue;
        }
        restoredCheckouts.push(entry.path);
      }

      const checkedOut = new Set(
        (yield* listWorktrees(root)).flatMap((worktree) =>
          worktree.branch === null ? [] : [worktree.branch],
        ),
      );
      for (const branch of point.branches) {
        const current = yield* resolveSha(root, `refs/heads/${branch.name}`);
        if (current === branch.previousSha) continue;
        if (current !== branch.syncedSha || checkedOut.has(branch.name)) {
          warnings.push(`Branch ${branch.name} changed after the sync, so it was left as it is.`);
          continue;
        }
        yield* updateRefs(root, [
          `update refs/heads/${branch.name} ${branch.previousSha} ${branch.syncedSha}`,
        ]);
        next.branches.push({
          name: branch.name,
          previousSha: branch.syncedSha,
          syncedSha: branch.previousSha,
        });
      }

      const recorded = next.checkouts.length > 0 || next.branches.length > 0;
      if (recorded) yield* saveRestorePoint(input.projectId, next);
      return {
        restorePointId: point.id,
        newRestorePointId: recorded ? next.id : null,
        restoredCheckouts,
        warnings,
      };
    },
  );

  return EnvironmentSyncGit.of({
    listHaves,
    exportRepository,
    releaseExport,
    planCheckouts,
    applyRepository,
    undo,
  });
});

export const layer = Layer.effect(EnvironmentSyncGit, make);
