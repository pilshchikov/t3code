import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  GitCommitStagedResult,
  GitDetailedStatusResult,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback } from "react";

import { ensureEnvironmentApi } from "~/environmentApi";
import { appAtomRegistry } from "~/rpc/atomRegistry";

const GIT_STATUS_STALE_TIME_MS = 10_000;
const GIT_STATUS_IDLE_TTL_MS = 5 * 60_000;

class GitStatusQueryError extends Data.TaggedError("GitStatusQueryError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

function statusKey(environmentId: EnvironmentId, cwd: string): string {
  return [environmentId, cwd].map(encodeURIComponent).join("|");
}

function keyParts(key: string): string[] {
  return key.split("|").map(decodeURIComponent);
}

const gitDetailedStatusQueryAtom = Atom.family((key: string) =>
  Atom.make(
    Effect.tryPromise({
      try: () => {
        const [environmentId, cwd] = keyParts(key) as [EnvironmentId, string];
        return ensureEnvironmentApi(environmentId).git.detailedStatus({ cwd });
      },
      catch: (cause) => new GitStatusQueryError({ message: "Could not load git status.", cause }),
    }),
  ).pipe(
    Atom.swr({
      staleTime: GIT_STATUS_STALE_TIME_MS,
      revalidateOnMount: true,
    }),
    Atom.setIdleTTL(GIT_STATUS_IDLE_TTL_MS),
    Atom.withLabel(`git:detailedStatus:${key}`),
  ),
);

function getGitDetailedStatusAtom(environmentId: EnvironmentId, cwd: string) {
  return gitDetailedStatusQueryAtom(statusKey(environmentId, cwd));
}

function errorMessage<A>(result: AsyncResult.AsyncResult<A, unknown>): string | null {
  if (result._tag !== "Failure") return null;
  const cause = Cause.squash(result.cause);
  return cause instanceof Error ? cause.message : "Git status query failed.";
}

export interface GitDetailedStatusState {
  readonly data: GitDetailedStatusResult | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
}

export function useGitDetailedStatus(
  environmentId: EnvironmentId,
  cwd: string,
): GitDetailedStatusState {
  const atom = getGitDetailedStatusAtom(environmentId, cwd);
  const result = useAtomValue(atom);
  const refresh = useCallback(() => appAtomRegistry.refresh(atom), [atom]);
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    error: errorMessage(result),
    isPending: result.waiting,
    refresh,
  };
}

export function refreshGitDetailedStatus(environmentId: EnvironmentId, cwd: string): void {
  appAtomRegistry.refresh(getGitDetailedStatusAtom(environmentId, cwd));
}

// Mutations. Each calls the server (which performs the change and returns fresh status) and then
// refreshes the cached query atom so the panel reflects the new state. The server also refreshes
// the VCS status stream that feeds the file-tree change markers.

export async function stageGitFiles(
  environmentId: EnvironmentId,
  cwd: string,
  paths: readonly string[],
): Promise<void> {
  await ensureEnvironmentApi(environmentId).git.stageFiles({ cwd, paths: [...paths] });
  refreshGitDetailedStatus(environmentId, cwd);
}

export async function unstageGitFiles(
  environmentId: EnvironmentId,
  cwd: string,
  paths: readonly string[],
): Promise<void> {
  await ensureEnvironmentApi(environmentId).git.unstageFiles({ cwd, paths: [...paths] });
  refreshGitDetailedStatus(environmentId, cwd);
}

export async function discardGitChanges(
  environmentId: EnvironmentId,
  cwd: string,
  paths: readonly string[],
): Promise<void> {
  await ensureEnvironmentApi(environmentId).git.discardChanges({ cwd, paths: [...paths] });
  refreshGitDetailedStatus(environmentId, cwd);
}

export async function commitGitStaged(
  environmentId: EnvironmentId,
  cwd: string,
  message: string,
  amend: boolean,
): Promise<GitCommitStagedResult> {
  const result = await ensureEnvironmentApi(environmentId).git.commitStaged({
    cwd,
    message,
    ...(amend ? { amend: true } : {}),
  });
  refreshGitDetailedStatus(environmentId, cwd);
  return result;
}
