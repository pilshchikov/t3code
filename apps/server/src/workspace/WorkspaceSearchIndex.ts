import {
  FileFinder,
  type GrepMatch,
  type MixedItem,
  type MixedSearchResult,
} from "@ff-labs/fff-node";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as LayerMap from "effect/LayerMap";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import type {
  ProjectEntry,
  ProjectCodeSearchMatch,
  ProjectCodeSymbolKind,
  ProjectListEntriesResult,
  ProjectSearchCodeInput,
  ProjectSearchCodeResult,
  ProjectSearchEntriesResult,
} from "@t3tools/contracts";

const WORKSPACE_INDEX_MAX_ENTRIES = 25_000;
const WORKSPACE_INDEX_PAGE_SIZE = WORKSPACE_INDEX_MAX_ENTRIES + 2;
const WORKSPACE_INDEX_SCAN_TIMEOUT = "15 seconds";
const WORKSPACE_INDEX_IDLE_TTL = "15 minutes";
const WORKSPACE_INDEX_SCAN_POLL_INTERVAL = "50 millis";

export class WorkspaceSearchIndexCreateFailed extends Schema.TaggedErrorClass<WorkspaceSearchIndexCreateFailed>()(
  "WorkspaceSearchIndexCreateFailed",
  {
    cwd: Schema.String,
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to create the workspace search index for '${this.cwd}'.`;
  }
}

export class WorkspaceSearchIndexScanTimedOut extends Schema.TaggedErrorClass<WorkspaceSearchIndexScanTimedOut>()(
  "WorkspaceSearchIndexScanTimedOut",
  {
    cwd: Schema.String,
    timeout: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace search index for '${this.cwd}' did not finish scanning within ${this.timeout}`;
  }
}

export class WorkspaceSearchIndexSearchFailed extends Schema.TaggedErrorClass<WorkspaceSearchIndexSearchFailed>()(
  "WorkspaceSearchIndexSearchFailed",
  {
    cwd: Schema.String,
    queryLength: Schema.Number,
    pageSize: Schema.Number,
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Workspace search failed for '${this.cwd}'.`;
  }
}

export class WorkspaceSearchIndexRefreshFailed extends Schema.TaggedErrorClass<WorkspaceSearchIndexRefreshFailed>()(
  "WorkspaceSearchIndexRefreshFailed",
  {
    cwd: Schema.String,
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to refresh the workspace search index for '${this.cwd}'.`;
  }
}

export class WorkspaceSearchIndexDestroyFailed extends Schema.TaggedErrorClass<WorkspaceSearchIndexDestroyFailed>()(
  "WorkspaceSearchIndexDestroyFailed",
  {
    cwd: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to destroy the workspace search index for '${this.cwd}'.`;
  }
}

export type WorkspaceSearchIndexError =
  | WorkspaceSearchIndexCreateFailed
  | WorkspaceSearchIndexScanTimedOut
  | WorkspaceSearchIndexSearchFailed
  | WorkspaceSearchIndexRefreshFailed;

export class WorkspaceSearchIndex extends Context.Service<
  WorkspaceSearchIndex,
  {
    readonly list: () => Effect.Effect<ProjectListEntriesResult, WorkspaceSearchIndexSearchFailed>;
    readonly search: (
      query: string,
      limit: number,
    ) => Effect.Effect<ProjectSearchEntriesResult, WorkspaceSearchIndexSearchFailed>;
    readonly searchCode: (
      input: Omit<ProjectSearchCodeInput, "cwd">,
    ) => Effect.Effect<ProjectSearchCodeResult, WorkspaceSearchIndexSearchFailed>;
    readonly refresh: () => Effect.Effect<
      void,
      WorkspaceSearchIndexRefreshFailed | WorkspaceSearchIndexScanTimedOut
    >;
  }
>()("t3/workspace/WorkspaceSearchIndex") {}

function toPosixPath(input: string): string {
  return input.replaceAll("\\", "/");
}

function trimDirectorySeparator(input: string): string {
  return input.endsWith("/") ? input.slice(0, -1) : input;
}

function parentPathOf(input: string): string | undefined {
  const separatorIndex = input.lastIndexOf("/");
  return separatorIndex === -1 ? undefined : input.slice(0, separatorIndex);
}

function toProjectEntry(item: MixedItem): ProjectEntry | null {
  const normalizedPath = trimDirectorySeparator(toPosixPath(item.item.relativePath));
  if (!normalizedPath) {
    return null;
  }

  return {
    path: normalizedPath,
    kind: item.type,
  };
}

function mapMixedSearchResult(
  result: MixedSearchResult,
  limit: number,
): { readonly entries: ProjectEntry[]; readonly truncated: boolean } {
  const entries: ProjectEntry[] = [];
  for (const item of result.items) {
    const entry = toProjectEntry(item);
    if (entry) {
      entries.push(entry);
    }
    if (entries.length >= limit) {
      break;
    }
  }

  const rootDirectoryCount = result.items.some(
    (item) => item.type === "directory" && item.item.relativePath.length === 0,
  )
    ? 1
    : 0;
  return {
    entries,
    truncated: result.totalMatched - rootDirectoryCount > limit,
  };
}

function withDirectoryAncestors(entries: ReadonlyArray<ProjectEntry>): ProjectEntry[] {
  const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const entry of entries) {
    let parentPath = parentPathOf(entry.path);
    while (parentPath) {
      if (!entryByPath.has(parentPath)) {
        entryByPath.set(parentPath, { path: parentPath, kind: "directory" });
      }
      parentPath = parentPathOf(parentPath);
    }
  }
  return [...entryByPath.values()];
}

function isLikelyParameterDeclaration(line: string, query: string): boolean {
  const openParenIndex = line.indexOf("(");
  const closeParenIndex = line.lastIndexOf(")");
  if (openParenIndex < 0 || closeParenIndex <= openParenIndex) return false;
  const prefix = line.slice(0, openParenIndex);
  if (/\b(?:if|for|while|switch|catch|with)\s*$/u.test(prefix)) return false;
  const suffix = line.slice(closeParenIndex + 1).trimStart();
  const isDeclaration =
    /\b(?:function|func|fn|def)\s+[A-Za-z_$][\w$]*\s*$/u.test(prefix) ||
    (/\b[A-Za-z_$][\w$]*\s*$/u.test(prefix) && /^(?:\{|=>|:)/u.test(suffix));
  if (!isDeclaration) return false;

  return line
    .slice(openParenIndex + 1, closeParenIndex)
    .split(",")
    .some((parameter) => {
      const identifiers = [...parameter.matchAll(/[A-Za-z_$][\w$]*/gu)].map((match) => match[0]);
      if (identifiers.length === 0) return false;
      const candidate =
        /^[\s*]*(?:\.\.\.)?([A-Za-z_$][\w$]*)\s*[?:=]/u.exec(parameter)?.[1] ?? identifiers.at(-1)!;
      return fuzzyIdentifierMatches(candidate, query);
    });
}

function fuzzyIdentifierMatches(identifier: string, query: string): boolean {
  const normalizedIdentifier = identifier.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  let queryIndex = 0;
  for (const character of normalizedIdentifier) {
    if (character === normalizedQuery[queryIndex]) queryIndex += 1;
    if (queryIndex === normalizedQuery.length) return true;
  }
  return normalizedQuery.length === 0;
}

function declaredIdentifierMatches(line: string, pattern: RegExp, query: string): boolean {
  const identifier = line.match(pattern)?.[1];
  return identifier ? fuzzyIdentifierMatches(identifier, query) : false;
}

function classifyCodeSymbol(match: GrepMatch, query: string): ProjectCodeSymbolKind {
  const line = match.lineContent;
  if (declaredIdentifierMatches(line, /\binterface\s+([A-Za-z_$][\w$]*)/u, query)) {
    return "interface";
  }
  if (declaredIdentifierMatches(line, /\benum\s+([A-Za-z_$][\w$]*)/u, query)) return "enum";
  if (declaredIdentifierMatches(line, /\bstruct\s+([A-Za-z_$][\w$]*)/u, query)) {
    return "struct";
  }
  if (declaredIdentifierMatches(line, /\btrait\s+([A-Za-z_$][\w$]*)/u, query)) return "trait";
  if (declaredIdentifierMatches(line, /\b(?:class|record|protocol)\s+([A-Za-z_$][\w$]*)/u, query)) {
    return "class";
  }
  if (declaredIdentifierMatches(line, /\btype\s+([A-Za-z_$][\w$]*)\s*(?:=|\{|$)/u, query)) {
    return "type";
  }
  if (declaredIdentifierMatches(line, /^\s+(?:async\s+)?def\s+([A-Za-z_$][\w$]*)\s*\(/u, query)) {
    return "method";
  }
  if (isLikelyParameterDeclaration(line, query)) return "parameter";
  if (
    declaredIdentifierMatches(line, /\b(?:function|func|fn|def)\s+([A-Za-z_$][\w$]*)\s*\(/u, query)
  ) {
    return "function";
  }
  if (
    declaredIdentifierMatches(
      line,
      /^\s*(?:(?:public|private|protected|static|async|final|override|virtual|abstract|export|unsafe|mut)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?:\{|=>|:)/u,
      query,
    )
  ) {
    return "method";
  }
  if (declaredIdentifierMatches(line, /\b(?:const|let|var|val)\s+([A-Za-z_$][\w$]*)/u, query)) {
    return "variable";
  }
  return "text";
}

function isCodeDefinition(match: GrepMatch, query: string): boolean {
  const kind = classifyCodeSymbol(match, query);
  return kind !== "text";
}

function isClassLikeSymbol(kind: ProjectCodeSymbolKind): boolean {
  return (
    kind === "class" ||
    kind === "interface" ||
    kind === "enum" ||
    kind === "struct" ||
    kind === "trait" ||
    kind === "type"
  );
}

function containsIdentifier(line: string, query: string): boolean {
  let fromIndex = 0;
  while (fromIndex <= line.length - query.length) {
    const index = line.indexOf(query, fromIndex);
    if (index < 0) return false;
    const before = index === 0 ? "" : line[index - 1]!;
    const afterIndex = index + query.length;
    const after = afterIndex >= line.length ? "" : line[afterIndex]!;
    if (!/[\p{L}\p{N}_$]/u.test(before) && !/[\p{L}\p{N}_$]/u.test(after)) {
      return true;
    }
    fromIndex = index + 1;
  }
  return false;
}

function toCodeSearchMatch(match: GrepMatch, query: string): ProjectCodeSearchMatch {
  return {
    path: toPosixPath(match.relativePath),
    lineNumber: Math.max(1, match.lineNumber),
    column: Math.max(0, match.col),
    snippet: match.lineContent.trimEnd().slice(0, 1_000),
    isDefinition: isCodeDefinition(match, query),
    kind: classifyCodeSymbol(match, query),
  };
}

const createFinder = Effect.fn("WorkspaceSearchIndex.createFinder")(function* (cwd: string) {
  const result = yield* Effect.try({
    try: () =>
      FileFinder.create({
        basePath: cwd,
        disableMmapCache: true,
        disableContentIndexing: true,
        aiMode: false,
        enableFsRootScanning: true,
        enableHomeDirScanning: true,
      }),
    catch: (cause) =>
      new WorkspaceSearchIndexCreateFailed({
        cwd,
        reason: "FileFinder.create threw unexpectedly.",
        cause,
      }),
  });
  if (result.ok) return result.value;
  return yield* new WorkspaceSearchIndexCreateFailed({
    cwd,
    reason: result.error,
  });
});

const waitForScan = <E>(cwd: string, finder: FileFinder, onFailure: (cause: unknown) => E) =>
  Effect.try({
    try: () => finder.isScanning(),
    catch: onFailure,
  }).pipe(
    Effect.repeat({
      while: (scanning) => scanning,
      schedule: Schedule.spaced(WORKSPACE_INDEX_SCAN_POLL_INTERVAL),
    }),
    Effect.timeoutOrElse({
      duration: WORKSPACE_INDEX_SCAN_TIMEOUT,
      orElse: () =>
        new WorkspaceSearchIndexScanTimedOut({ cwd, timeout: WORKSPACE_INDEX_SCAN_TIMEOUT }),
    }),
    Effect.withSpan("WorkspaceSearchIndex.waitForScan"),
  );

export const make = Effect.fn("WorkspaceSearchIndex.make")(function* (cwd: string) {
  const finder = yield* Effect.acquireRelease(createFinder(cwd), (finder) =>
    Effect.try({
      try: () => finder.destroy(),
      catch: (cause) => new WorkspaceSearchIndexDestroyFailed({ cwd, cause }),
    }).pipe(Effect.orDie),
  );
  yield* waitForScan(
    cwd,
    finder,
    (cause) =>
      new WorkspaceSearchIndexCreateFailed({
        cwd,
        reason: "FileFinder.isScanning threw while creating the index.",
        cause,
      }),
  );

  const runMixedSearch = Effect.fn("WorkspaceSearchIndex.runMixedSearch")(function* (
    query: string,
    pageSize: number,
  ) {
    const result = yield* Effect.try({
      try: () => finder.mixedSearch(query, { pageSize }),
      catch: (cause) =>
        new WorkspaceSearchIndexSearchFailed({
          cwd,
          queryLength: query.length,
          pageSize,
          reason: "FileFinder.mixedSearch threw unexpectedly.",
          cause,
        }),
    });
    if (!result.ok) {
      return yield* new WorkspaceSearchIndexSearchFailed({
        cwd,
        queryLength: query.length,
        pageSize,
        reason: result.error,
      });
    }
    return result.value;
  });

  const refresh: WorkspaceSearchIndex["Service"]["refresh"] = Effect.fn(
    "WorkspaceSearchIndex.refresh",
  )(function* () {
    const result = yield* Effect.try({
      try: () => finder.scanFiles(),
      catch: (cause) =>
        new WorkspaceSearchIndexRefreshFailed({
          cwd,
          reason: "FileFinder.scanFiles threw unexpectedly.",
          cause,
        }),
    });
    if (!result.ok) {
      return yield* new WorkspaceSearchIndexRefreshFailed({
        cwd,
        reason: result.error,
      });
    }
    yield* waitForScan(
      cwd,
      finder,
      (cause) =>
        new WorkspaceSearchIndexRefreshFailed({
          cwd,
          reason: "FileFinder.isScanning threw while refreshing the index.",
          cause,
        }),
    );
  });

  const list: WorkspaceSearchIndex["Service"]["list"] = Effect.fn("WorkspaceSearchIndex.list")(
    function* () {
      const result = yield* runMixedSearch("", WORKSPACE_INDEX_PAGE_SIZE);
      const mapped = mapMixedSearchResult(result, WORKSPACE_INDEX_MAX_ENTRIES);
      const sortedEntries = withDirectoryAncestors(mapped.entries).toSorted((left, right) =>
        left.path.localeCompare(right.path),
      );
      const entries = sortedEntries.slice(0, WORKSPACE_INDEX_MAX_ENTRIES);
      return {
        entries,
        truncated: mapped.truncated || entries.length < sortedEntries.length,
      };
    },
  );

  const search: WorkspaceSearchIndex["Service"]["search"] = Effect.fn(
    "WorkspaceSearchIndex.search",
  )(function* (query, limit) {
    const result = yield* runMixedSearch(query, Math.max(1, limit + 1));
    return mapMixedSearchResult(result, limit);
  });

  const searchCode: WorkspaceSearchIndex["Service"]["searchCode"] = Effect.fn(
    "WorkspaceSearchIndex.searchCode",
  )(function* (input) {
    const requestedResultCount = Math.min(1_000, Math.max(100, input.limit * 12));
    const result = yield* Effect.try({
      try: () =>
        finder.grep(input.query, {
          mode: input.scope === "navigation" ? "plain" : "fuzzy",
          pageSize: requestedResultCount,
          maxMatchesPerFile: 40,
          timeBudgetMs: 1_500,
        }),
      catch: (cause) =>
        new WorkspaceSearchIndexSearchFailed({
          cwd,
          queryLength: input.query.length,
          pageSize: requestedResultCount,
          reason: "FileFinder.grep threw unexpectedly.",
          cause,
        }),
    });
    if (!result.ok) {
      return yield* new WorkspaceSearchIndexSearchFailed({
        cwd,
        queryLength: input.query.length,
        pageSize: requestedResultCount,
        reason: result.error,
      });
    }

    const matches = result.value.items
      .filter((match) => {
        if (input.scope === "navigation") {
          return containsIdentifier(match.lineContent, input.query);
        }
        const kind = classifyCodeSymbol(match, input.query);
        if (input.scope === "classes") {
          return isCodeDefinition(match, input.query) && isClassLikeSymbol(kind);
        }
        if (input.scope === "symbols") return isCodeDefinition(match, input.query);
        return true;
      })
      .map((match) => toCodeSearchMatch(match, input.query));

    return {
      matches: matches.slice(0, input.limit),
      truncated: result.value.nextCursor !== null || matches.length > input.limit,
    };
  });

  return WorkspaceSearchIndex.of({ list, refresh, search, searchCode });
});

/**
 * A layer factory is required because every index is scoped to a concrete
 * workspace root. WorkspaceSearchIndexMap owns memoization and idle cleanup;
 * using a default cwd here would mix resources from different workspaces.
 */
export const layer = (cwd: string) => Layer.effect(WorkspaceSearchIndex, make(cwd));

export class WorkspaceSearchIndexMap extends LayerMap.Service<WorkspaceSearchIndexMap>()(
  "t3/workspace/WorkspaceSearchIndexMap",
  {
    lookup: layer,
    idleTimeToLive: WORKSPACE_INDEX_IDLE_TTL,
  },
) {}
