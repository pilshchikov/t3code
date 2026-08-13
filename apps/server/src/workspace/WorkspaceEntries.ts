// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as RcMap from "effect/RcMap";
import * as Schema from "effect/Schema";

import type {
  FilesystemBrowseInput,
  FilesystemBrowseResult,
  ProjectEntry,
  ProjectListEntriesInput,
  ProjectListEntriesResult,
  ProjectSearchContentsInput,
  ProjectSearchContentsResult,
  ProjectSearchCodeInput,
  ProjectSearchCodeResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { isExplicitRelativePath, isWindowsAbsolutePath } from "@t3tools/shared/path";
import { normalizeSearchQuery } from "@t3tools/shared/searchRanking";

import * as WorkspacePaths from "./WorkspacePaths.ts";
import * as WorkspaceSearchIndex from "./WorkspaceSearchIndex.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";

const MAX_IGNORED_WORKSPACE_ENTRIES = 10_000;
const MAX_WORKSPACE_ENTRIES = 25_000;

function parentPathOf(input: string): string | undefined {
  const separatorIndex = input.lastIndexOf("/");
  return separatorIndex === -1 ? undefined : input.slice(0, separatorIndex);
}

function pathDepth(input: string): number {
  let depth = 1;
  for (const character of input) {
    if (character === "/") depth += 1;
  }
  return depth;
}

function normalizeEntryPath(input: string): string {
  return input.replace(/\/+$/, "");
}

function withDirectoryAncestors(entries: ReadonlyArray<ProjectEntry>): ProjectEntry[] {
  const normalizedEntries = entries.map((entry) => ({
    ...entry,
    path: normalizeEntryPath(entry.path),
  }));
  const entriesByPath = new Map(normalizedEntries.map((entry) => [entry.path, entry] as const));
  for (const entry of normalizedEntries) {
    let parentPath = parentPathOf(entry.path);
    while (parentPath) {
      if (!entriesByPath.has(parentPath)) {
        entriesByPath.set(parentPath, { path: parentPath, kind: "directory" });
      }
      parentPath = parentPathOf(parentPath);
    }
  }
  return [...entriesByPath.values()];
}

export class WorkspaceEntriesWindowsPathUnsupportedError extends Schema.TaggedErrorClass<WorkspaceEntriesWindowsPathUnsupportedError>()(
  "WorkspaceEntriesWindowsPathUnsupportedError",
  {
    cwd: Schema.optional(Schema.String),
    partialPath: Schema.String,
    platform: Schema.String,
  },
) {
  override get message(): string {
    const cwd = this.cwd ? ` from '${this.cwd}'` : "";
    return `Windows-style workspace path '${this.partialPath}' is not supported on '${this.platform}'${cwd}.`;
  }
}

export class WorkspaceEntriesCurrentProjectRequiredError extends Schema.TaggedErrorClass<WorkspaceEntriesCurrentProjectRequiredError>()(
  "WorkspaceEntriesCurrentProjectRequiredError",
  {
    partialPath: Schema.String,
  },
) {
  override get message(): string {
    return `A current project is required to browse relative workspace path '${this.partialPath}'.`;
  }
}

export class WorkspaceEntriesReadDirectoryError extends Schema.TaggedErrorClass<WorkspaceEntriesReadDirectoryError>()(
  "WorkspaceEntriesReadDirectoryError",
  {
    cwd: Schema.optional(Schema.String),
    partialPath: Schema.String,
    parentPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    const cwd = this.cwd ? ` from '${this.cwd}'` : "";
    return `Failed to read workspace directory '${this.parentPath}' while browsing '${this.partialPath}'${cwd}.`;
  }
}

export const WorkspaceEntriesBrowseError = Schema.Union([
  WorkspaceEntriesWindowsPathUnsupportedError,
  WorkspaceEntriesCurrentProjectRequiredError,
  WorkspaceEntriesReadDirectoryError,
]);
export type WorkspaceEntriesBrowseError = typeof WorkspaceEntriesBrowseError.Type;

export const WorkspaceEntriesError = Schema.Union([
  WorkspacePaths.WorkspaceRootNotExistsError,
  WorkspacePaths.WorkspaceRootCreateFailedError,
  WorkspacePaths.WorkspaceRootStatFailedError,
  WorkspacePaths.WorkspaceRootNotDirectoryError,
  WorkspaceSearchIndex.WorkspaceSearchIndexCreateFailed,
  WorkspaceSearchIndex.WorkspaceSearchIndexScanTimedOut,
  WorkspaceSearchIndex.WorkspaceSearchIndexSearchFailed,
]);
export type WorkspaceEntriesError = typeof WorkspaceEntriesError.Type;

export class WorkspaceEntries extends Context.Service<
  WorkspaceEntries,
  {
    readonly browse: (
      input: FilesystemBrowseInput,
    ) => Effect.Effect<FilesystemBrowseResult, WorkspaceEntriesBrowseError>;
    readonly list: (
      input: ProjectListEntriesInput,
    ) => Effect.Effect<ProjectListEntriesResult, WorkspaceEntriesError>;
    readonly search: (
      input: ProjectSearchEntriesInput,
    ) => Effect.Effect<ProjectSearchEntriesResult, WorkspaceEntriesError>;
    readonly searchContents: (
      input: ProjectSearchContentsInput,
    ) => Effect.Effect<ProjectSearchContentsResult, WorkspaceEntriesError>;
    readonly searchCode: (
      input: ProjectSearchCodeInput,
    ) => Effect.Effect<ProjectSearchCodeResult, WorkspaceEntriesError>;
    readonly refresh: (cwd: string) => Effect.Effect<void>;
  }
>()("t3/workspace/WorkspaceEntries") {}

function expandHomePath(input: string, path: Path.Path): string {
  if (input === "~") {
    return NodeOS.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(NodeOS.homedir(), input.slice(2));
  }
  return input;
}

const resolveBrowseTarget = Effect.fn("WorkspaceEntries.resolveBrowseTarget")(function* (
  input: FilesystemBrowseInput,
  path: Path.Path,
): Effect.fn.Return<string, WorkspaceEntriesBrowseError> {
  const platform = yield* HostProcessPlatform;
  if (platform !== "win32" && isWindowsAbsolutePath(input.partialPath)) {
    return yield* new WorkspaceEntriesWindowsPathUnsupportedError({
      cwd: input.cwd,
      partialPath: input.partialPath,
      platform,
    });
  }

  if (!isExplicitRelativePath(input.partialPath)) {
    return path.resolve(expandHomePath(input.partialPath, path));
  }

  if (!input.cwd) {
    return yield* new WorkspaceEntriesCurrentProjectRequiredError({
      partialPath: input.partialPath,
    });
  }
  return path.resolve(expandHomePath(input.cwd, path), input.partialPath);
});

export const make = Effect.gen(function* () {
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const workspaceSearchIndexes = yield* WorkspaceSearchIndex.WorkspaceSearchIndexMap;
  const vcsDriverRegistry = yield* Effect.serviceOption(VcsDriverRegistry.VcsDriverRegistry);

  const normalizeWorkspaceRoot = Effect.fn("WorkspaceEntries.normalizeWorkspaceRoot")(function* (
    cwd: string,
  ): Effect.fn.Return<string, WorkspaceEntriesError> {
    return yield* workspacePaths.normalizeWorkspaceRoot(cwd);
  });

  const refresh: WorkspaceEntries["Service"]["refresh"] = Effect.fn("WorkspaceEntries.refresh")(
    function* (cwd) {
      const normalizedCwd = yield* normalizeWorkspaceRoot(cwd).pipe(
        Effect.orElseSucceed(() => cwd),
      );
      for (const variant of WorkspaceSearchIndex.WORKSPACE_SEARCH_INDEX_VARIANTS) {
        const indexKey = WorkspaceSearchIndex.workspaceSearchIndexKey(normalizedCwd, variant);
        if (!(yield* RcMap.has(workspaceSearchIndexes.rcMap, indexKey))) {
          continue;
        }
        const recoverRefreshFailure = (
          cause:
            | WorkspaceSearchIndex.WorkspaceSearchIndexCreateFailed
            | WorkspaceSearchIndex.WorkspaceSearchIndexScanTimedOut
            | WorkspaceSearchIndex.WorkspaceSearchIndexRefreshFailed,
        ) =>
          Effect.gen(function* () {
            yield* Effect.logWarning("Failed to refresh workspace search index", {
              cwd,
              variant,
              cause,
            });
            yield* workspaceSearchIndexes.invalidate(indexKey);
          });
        yield* Effect.gen(function* () {
          const searchIndex = yield* WorkspaceSearchIndex.WorkspaceSearchIndex;
          yield* searchIndex.refresh();
        }).pipe(
          Effect.provide(workspaceSearchIndexes.get(indexKey)),
          Effect.catchTags({
            WorkspaceSearchIndexCreateFailed: recoverRefreshFailure,
            WorkspaceSearchIndexScanTimedOut: recoverRefreshFailure,
            WorkspaceSearchIndexRefreshFailed: recoverRefreshFailure,
          }),
        );
      }
    },
  );

  const browse: WorkspaceEntries["Service"]["browse"] = Effect.fn("WorkspaceEntries.browse")(
    function* (input) {
      const resolvedInputPath = yield* resolveBrowseTarget(input, path);
      const endsWithSeparator = /[\\/]$/.test(input.partialPath) || input.partialPath === "~";
      const parentPath = endsWithSeparator ? resolvedInputPath : path.dirname(resolvedInputPath);
      const prefix = endsWithSeparator ? "" : path.basename(resolvedInputPath);

      const dirents = yield* Effect.tryPromise({
        try: () => NodeFSP.readdir(parentPath, { withFileTypes: true }),
        catch: (cause) =>
          new WorkspaceEntriesReadDirectoryError({
            cwd: input.cwd,
            partialPath: input.partialPath,
            parentPath,
            cause,
          }),
      }).pipe(
        Effect.catchIf(
          (error) => {
            const code = (error.cause as NodeJS.ErrnoException | undefined)?.code;
            return code === "EACCES" || code === "EPERM";
          },
          () => Effect.succeed([]),
        ),
      );

      const showHidden = endsWithSeparator || prefix.startsWith(".");
      const lowerPrefix = prefix.toLowerCase();
      const entries: Array<{ readonly name: string; readonly fullPath: string }> = [];
      for (const dirent of dirents) {
        if (
          dirent.isDirectory() &&
          dirent.name.toLowerCase().startsWith(lowerPrefix) &&
          (showHidden || !dirent.name.startsWith("."))
        ) {
          entries.push({
            name: dirent.name,
            fullPath: path.join(parentPath, dirent.name),
          });
        }
      }

      return {
        parentPath,
        entries: entries.toSorted((left, right) => left.name.localeCompare(right.name)),
      };
    },
  );

  const search: WorkspaceEntries["Service"]["search"] = Effect.fn("WorkspaceEntries.search")(
    function* (input) {
      const normalizedCwd = yield* normalizeWorkspaceRoot(input.cwd);
      const normalizedQuery = normalizeSearchQuery(input.query, {
        trimLeadingPattern: /^[@./]+/,
      });
      return yield* Effect.gen(function* () {
        const searchIndex = yield* WorkspaceSearchIndex.WorkspaceSearchIndex;
        return yield* searchIndex.search(normalizedQuery, input.limit, input.kind, input.imageOnly);
      }).pipe(
        Effect.provide(
          workspaceSearchIndexes.get(
            WorkspaceSearchIndex.workspaceSearchIndexKey(normalizedCwd, "paths"),
          ),
        ),
      );
    },
  );

  const searchContents: WorkspaceEntries["Service"]["searchContents"] = Effect.fn(
    "WorkspaceEntries.searchContents",
  )(function* (input) {
    const normalizedCwd = yield* normalizeWorkspaceRoot(input.cwd);
    return yield* Effect.gen(function* () {
      const searchIndex = yield* WorkspaceSearchIndex.WorkspaceSearchIndex;
      return yield* searchIndex.searchContents(input);
    }).pipe(
      Effect.provide(
        workspaceSearchIndexes.get(
          WorkspaceSearchIndex.workspaceSearchIndexKey(normalizedCwd, "content"),
        ),
      ),
    );
  });

  const searchCode: WorkspaceEntries["Service"]["searchCode"] = Effect.fn(
    "WorkspaceEntries.searchCode",
  )(function* (input) {
    const normalizedCwd = yield* normalizeWorkspaceRoot(input.cwd);
    return yield* Effect.gen(function* () {
      const searchIndex = yield* WorkspaceSearchIndex.WorkspaceSearchIndex;
      return yield* searchIndex.searchCode({
        query: input.query.trim(),
        scope: input.scope,
        limit: input.limit,
      });
    }).pipe(
      Effect.provide(
        workspaceSearchIndexes.get(
          WorkspaceSearchIndex.workspaceSearchIndexKey(normalizedCwd, "content"),
        ),
      ),
    );
  });

  const list: WorkspaceEntries["Service"]["list"] = Effect.fn("WorkspaceEntries.list")(
    function* (input) {
      const normalizedCwd = yield* normalizeWorkspaceRoot(input.cwd);
      const detected = yield* Option.match(vcsDriverRegistry, {
        onNone: () => Effect.succeed(null),
        onSome: (registry) =>
          registry
            .detect({ cwd: normalizedCwd, requestedKind: "auto" })
            .pipe(Effect.orElseSucceed(() => null)),
      });

      if (detected) {
        const [workspaceFiles, ignoredEntries] = yield* Effect.all([
          detected.driver.listWorkspaceFiles(normalizedCwd).pipe(Effect.option),
          detected.driver.listIgnoredWorkspaceEntries
            ? detected.driver
                .listIgnoredWorkspaceEntries(normalizedCwd)
                .pipe(Effect.orElseSucceed(() => []))
            : Effect.succeed([]),
        ]);
        if (Option.isSome(workspaceFiles)) {
          // Prefer shallow ignored paths so useful project-local folders (for
          // example `local-notes/`) are not crowded out by thousands of deep cache,
          // virtualenv, or node_modules entries.
          const ignoredSlice = ignoredEntries
            .toSorted(
              (left, right) =>
                pathDepth(left.path) - pathDepth(right.path) || left.path.localeCompare(right.path),
            )
            .slice(0, MAX_IGNORED_WORKSPACE_ENTRIES);
          const allEntries = withDirectoryAncestors([
            ...workspaceFiles.value.paths.map((filePath) => ({
              path: normalizeEntryPath(filePath),
              kind: "file" as const,
            })),
            ...ignoredSlice.map((entry) => ({
              ...entry,
              path: normalizeEntryPath(entry.path),
              ignored: true as const,
            })),
          ]).sort((left, right) => left.path.localeCompare(right.path));
          return {
            entries: allEntries.slice(0, MAX_WORKSPACE_ENTRIES),
            truncated:
              workspaceFiles.value.truncated ||
              ignoredEntries.length > MAX_IGNORED_WORKSPACE_ENTRIES ||
              allEntries.length > MAX_WORKSPACE_ENTRIES,
          };
        }
      }

      return yield* Effect.gen(function* () {
        const searchIndex = yield* WorkspaceSearchIndex.WorkspaceSearchIndex;
        return yield* searchIndex.list();
      }).pipe(
        Effect.provide(
          workspaceSearchIndexes.get(
            WorkspaceSearchIndex.workspaceSearchIndexKey(normalizedCwd, "paths"),
          ),
        ),
      );
    },
  );

  return WorkspaceEntries.of({ browse, list, refresh, search, searchContents, searchCode });
});

export const layer = Layer.effect(WorkspaceEntries, make).pipe(
  Layer.provide(WorkspaceSearchIndex.WorkspaceSearchIndexMap.layer),
);
