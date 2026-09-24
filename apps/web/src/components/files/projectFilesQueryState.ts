import { useAtomValue } from "@effect/atom-react";
import type { ProjectEntriesChangedEvent, ProjectFileChangedEvent } from "@t3tools/contracts";
import {
  type EnvironmentId,
  type ProjectListEntriesResult,
  ProjectReadFileError,
  type ProjectReadFileResult,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useEffect, useRef } from "react";
import {
  isWorkspaceAudioPreviewPath,
  isWorkspaceImagePreviewPath,
  isWorkspaceVideoPreviewPath,
} from "@t3tools/shared/filePreview";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { projectEnvironment } from "~/state/projects";
import { useProjectPathSearch } from "~/state/queries";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";

const EMPTY_PROJECT_FILE_PATH = "";
const EMPTY_PROJECT_FILE_QUERY_ATOM = Atom.make(
  AsyncResult.initial<ProjectReadFileResult, never>(false),
).pipe(Atom.withLabel("project-file-query:empty"));
const EMPTY_PROJECT_FILE_WATCH_ATOM = Atom.make(
  AsyncResult.initial<ProjectFileChangedEvent, never>(false),
).pipe(Atom.withLabel("project-file-watch:empty"));
const EMPTY_PROJECT_ENTRIES_WATCH_ATOM = Atom.make(
  AsyncResult.initial<ProjectEntriesChangedEvent, never>(false),
).pipe(Atom.withLabel("project-entries-watch:empty"));
/** A pending in-app write to the file, overlaying the query until confirmed. */
export function optimisticFileAtom(
  environmentId: EnvironmentId,
  cwd: string,
  relativePath: string,
) {
  return projectEnvironment.optimisticFile({ environmentId, cwd, relativePath });
}

interface ProjectQueryState<A> {
  readonly data: A | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
}

interface ProjectFileQueryState extends ProjectQueryState<ProjectReadFileResult> {
  readonly isNotFile: boolean;
}

function getProjectEntriesQueryAtom(environmentId: EnvironmentId, cwd: string, directoryPath = "") {
  return projectEnvironment.listEntries({
    environmentId,
    input: { cwd, ...(directoryPath !== undefined ? { directoryPath } : {}) },
  });
}

export function getProjectFileQueryAtom(
  environmentId: EnvironmentId,
  cwd: string,
  relativePath: string | null,
) {
  return projectEnvironment.readFile({
    environmentId,
    input: { cwd, relativePath: relativePath ?? EMPTY_PROJECT_FILE_PATH },
  });
}

export function setProjectFileQueryData(
  environmentId: EnvironmentId,
  cwd: string,
  relativePath: string,
  contents: string,
): void {
  appAtomRegistry.set(optimisticFileAtom(environmentId, cwd, relativePath), {
    confirmedAgainst: undefined,
    data: {
      relativePath,
      contents,
      byteLength: new TextEncoder().encode(contents).byteLength,
      truncated: false,
    },
  });
}

export function getOptimisticProjectFileQueryData(
  environmentId: EnvironmentId,
  cwd: string,
  relativePath: string,
): ProjectReadFileResult | null {
  return appAtomRegistry.get(optimisticFileAtom(environmentId, cwd, relativePath))?.data ?? null;
}

export function confirmProjectFileQueryData(
  environmentId: EnvironmentId,
  cwd: string,
  relativePath: string,
  contents: string,
): boolean {
  const atom = optimisticFileAtom(environmentId, cwd, relativePath);
  const optimisticFile = appAtomRegistry.get(atom);
  if (optimisticFile?.data.contents !== contents) return false;

  const queryAtom = getProjectFileQueryAtom(environmentId, cwd, relativePath);
  const confirmed = {
    ...optimisticFile,
    confirmedAgainst: appAtomRegistry.get(queryAtom),
  };
  appAtomRegistry.set(atom, confirmed);
  appAtomRegistry.refresh(queryAtom);
  void executeAtomQuery(appAtomRegistry, queryAtom, {
    reportDefect: false,
    reportFailure: false,
  }).then((result) => {
    if (result._tag === "Success" && appAtomRegistry.get(atom) === confirmed) {
      appAtomRegistry.set(atom, null);
    }
  });
  return true;
}

export function resolveProjectFileQueryData(
  environmentId: EnvironmentId,
  cwd: string,
  relativePath: string | null,
  data: ProjectReadFileResult | null,
): ProjectReadFileResult | null {
  if (relativePath === null) return data;
  return appAtomRegistry.get(optimisticFileAtom(environmentId, cwd, relativePath))?.data ?? data;
}

export function clearProjectFileQueryData(
  environmentId: EnvironmentId,
  cwd: string,
  relativePath: string,
): void {
  appAtomRegistry.set(optimisticFileAtom(environmentId, cwd, relativePath), null);
}

function failureCause<A>(result: AsyncResult.AsyncResult<A, unknown>): unknown {
  return result._tag === "Failure" ? Cause.squash(result.cause) : null;
}

function errorMessage(cause: unknown): string | null {
  if (cause === null) return null;
  return cause instanceof Error ? cause.message : "Workspace query failed.";
}

const isProjectReadFileError = Schema.is(ProjectReadFileError);

export function useProjectEntriesQuery(
  environmentId: EnvironmentId,
  cwd: string,
  directoryPath = "",
  active = true,
): ProjectQueryState<ProjectListEntriesResult> {
  const atom = getProjectEntriesQueryAtom(environmentId, cwd, directoryPath);
  const result = useAtomValue(atom);
  const refreshing = useRef({ running: false, again: false, generation: 0 });
  useEffect(() => {
    const state = refreshing.current;
    return () => {
      state.generation++;
      state.running = false;
      state.again = false;
    };
  }, [atom, active]);
  const refresh = useCallback(() => {
    const state = refreshing.current;
    if (!active || state.running) return;
    state.running = true;
    const generation = state.generation;
    void (async () => {
      try {
        do {
          state.again = false;
          await executeAtomQuery(appAtomRegistry, atom, {
            reportDefect: false,
            reportFailure: false,
            refresh: true,
          });
        } while (state.again && state.generation === generation);
      } finally {
        if (state.generation === generation) state.running = false;
      }
    })();
  }, [active, atom]);
  const onDirectoryChange = useCallback(() => {
    if (refreshing.current.running) refreshing.current.again = true;
    else refresh();
  }, [refresh]);
  useProjectEntriesWatchRefresh(
    active ? environmentId : null,
    active ? cwd : null,
    onDirectoryChange,
    directoryPath,
  );
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [active, refresh]);
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    error: errorMessage(failureCause(result)),
    isPending: result.waiting,
    refresh,
  };
}

export function useProjectEntriesWatchRefresh(
  environmentId: EnvironmentId | null,
  cwd: string | null,
  refresh: () => void,
  directoryPath = "",
): void {
  const watchAtom = (
    environmentId !== null && cwd !== null
      ? projectEnvironment.watchEntries({ environmentId, input: { cwd, directoryPath } })
      : EMPTY_PROJECT_ENTRIES_WATCH_ATOM
  ) as Atom.Atom<AsyncResult.AsyncResult<ProjectEntriesChangedEvent, unknown>>;
  const watchResult = useAtomValue(watchAtom);
  const watchRevision = AsyncResult.isSuccess(watchResult) ? watchResult.value.revision : null;

  useEffect(() => {
    if (watchRevision === null) return;
    refresh();
  }, [refresh, watchRevision]);
}

/**
 * Backing query for the project file picker: a debounced, bounded, file-only
 * server search. An empty query is a valid request — the index answers it
 * with frecency-ordered files, so the picker's initial view is recent files
 * without transferring the full workspace listing. `matchedQuery` is the
 * query the returned entries were computed for, so the caller can highlight
 * against results instead of half-typed input.
 */
export function useProjectFilePickerQuery(
  environmentId: EnvironmentId,
  cwd: string,
  query: string,
  limit: number,
  options?: { readonly imageOnly?: boolean },
) {
  const search = useProjectPathSearch(
    {
      environmentId,
      cwd,
      query,
      kind: "file",
      ...(options?.imageOnly ? { imageOnly: true } : {}),
    },
    limit,
    { allowEmptyQuery: true },
  );

  return {
    entries: search.isPending ? [] : search.entries,
    error: search.error,
    isPending: search.isPending,
    matchedQuery: search.searchedQuery,
  };
}

export function useProjectFileQuery(
  environmentId: EnvironmentId,
  cwd: string,
  relativePath: string | null,
  enabled = true,
  watch = false,
  preserveOptimistic = false,
  active = true,
): ProjectFileQueryState {
  const isMedia =
    relativePath !== null &&
    (isWorkspaceImagePreviewPath(relativePath) ||
      isWorkspaceVideoPreviewPath(relativePath) ||
      isWorkspaceAudioPreviewPath(relativePath));
  const atom =
    enabled && relativePath !== null
      ? isMedia
        ? projectEnvironment.readFile({
            environmentId,
            input: { cwd, relativePath, metadataOnly: true },
          })
        : getProjectFileQueryAtom(environmentId, cwd, relativePath)
      : EMPTY_PROJECT_FILE_QUERY_ATOM;
  const result = useAtomValue(atom);
  const shouldWatch = enabled && watch && active && relativePath !== null && !isMedia;
  const watchAtom = shouldWatch
    ? projectEnvironment.watchFile({
        environmentId,
        input: { cwd, relativePath },
      })
    : EMPTY_PROJECT_FILE_WATCH_ATOM;
  const watchResult = useAtomValue(watchAtom);
  const watchRevision = AsyncResult.isSuccess(watchResult) ? watchResult.value.revision : null;
  const targetKey = shouldWatch ? `${environmentId}\u0000${cwd}\u0000${relativePath}` : null;
  const checkState = useRef({ generation: 0, running: false, again: false });
  useEffect(() => {
    const state = checkState.current;
    return () => {
      state.generation++;
      state.running = false;
      state.again = false;
    };
  }, [atom, targetKey, preserveOptimistic]);
  const refresh = useCallback(() => {
    if (!enabled || isMedia || relativePath === null || !active || preserveOptimistic) return;
    const state = checkState.current;
    if (state.running) {
      state.again = true;
      return;
    }
    const generation = state.generation;
    state.running = true;
    const metadataAtom = projectEnvironment.readFile({
      environmentId,
      input: { cwd, relativePath, metadataOnly: true },
    });
    void (async () => {
      try {
        do {
          state.again = false;
          // Finish an initial read before checking, avoiding two full reads on first open.
          await executeAtomQuery(appAtomRegistry, atom, {
            reportDefect: false,
            reportFailure: false,
          });
          if (state.generation !== generation) return;
          const metadata = await executeAtomQuery(appAtomRegistry, metadataAtom, {
            reportDefect: false,
            reportFailure: false,
            refresh: true,
          });
          if (state.generation !== generation) return;
          const currentResult = appAtomRegistry.get(atom);
          const current = Option.getOrNull(AsyncResult.value(currentResult));
          if (
            currentResult._tag === "Failure" ||
            metadata._tag !== "Success" ||
            !current?.revision ||
            metadata.value.revision !== current.revision
          ) {
            clearProjectFileQueryData(environmentId, cwd, relativePath);
            await executeAtomQuery(appAtomRegistry, atom, {
              reportDefect: false,
              reportFailure: false,
              refresh: true,
            });
          }
        } while (state.again && state.generation === generation);
      } finally {
        if (state.generation === generation) state.running = false;
      }
    })();
  }, [active, atom, cwd, enabled, environmentId, isMedia, preserveOptimistic, relativePath]);
  useEffect(() => {
    if (shouldWatch) refresh();
  }, [refresh, shouldWatch, watchRevision]);
  useEffect(() => {
    if (targetKey === null || typeof window === "undefined") return;
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh, targetKey]);
  const data = Option.getOrNull(AsyncResult.value(result));
  const optimisticResult = useAtomValue(
    optimisticFileAtom(environmentId, cwd, relativePath ?? EMPTY_PROJECT_FILE_PATH),
  );
  const optimisticFile = relativePath === null ? null : optimisticResult;
  const cause = failureCause(result);
  return {
    data: optimisticFile?.data ?? (result._tag === "Failure" ? null : data),
    error: errorMessage(result),
    isNotFile: isProjectReadFileError(cause) && cause.failure === "path_not_file",
    isPending: result.waiting,
    refresh,
  };
}
