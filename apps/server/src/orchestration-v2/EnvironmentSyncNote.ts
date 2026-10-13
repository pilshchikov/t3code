import type {
  OrchestrationV2AppThread,
  OrchestrationV2ProviderThread,
  OrchestrationV2ProviderTurn,
  OrchestrationV2Run,
  OrchestrationV2RunAttempt,
  ThreadEnvironmentSync,
} from "@t3tools/contracts";

/**
 * A provider thread whose native session was created on the host the thread
 * came from. Resuming it here would look up a session this machine never had,
 * so the turn starts a fresh session and hands the history over as text.
 */
export function hasStaleNativeSession(
  thread: Pick<OrchestrationV2AppThread, "environmentSync">,
  providerThread: Pick<OrchestrationV2ProviderThread, "nativeThreadRef">,
): boolean {
  const nativeId = providerThread.nativeThreadRef?.nativeId;
  return (
    nativeId !== null &&
    nativeId !== undefined &&
    (thread.environmentSync?.staleNativeThreadIds.includes(nativeId) ?? false)
  );
}

/** Provider-facing text telling the agent which machine it now works on. */
export function environmentSyncNote(sync: ThreadEnvironmentSync, cwd: string | null): string {
  return [
    `Note: this conversation moved to another machine. It ran on "${sync.origin.label}" in ${sync.originWorkspacePath}. It now runs on "${sync.host.label}"${cwd === null ? "" : ` in ${cwd}`}.`,
    "Git history, branches, and uncommitted changes were copied. Files Git ignores were not: installed dependencies, build output, and local config such as .env files.",
    `Paths in the earlier conversation refer to "${sync.origin.label}". If something you expect is missing here, it may still exist there. Reinstall or rebuild it, or ask the user to copy it over.`,
    ...sync.notes,
  ].join("\n");
}

/**
 * The note for a run when no provider turn has completed since the thread
 * arrived. Delivery is derived, like the restart note. A completed turn in a
 * run that started here proves the agent was told. Compactions carry no text
 * of their own, and a restart continuation resumes or re-prompts its source.
 */
export function pendingEnvironmentSyncNote(input: {
  readonly thread: Pick<OrchestrationV2AppThread, "environmentSync">;
  readonly run: Pick<OrchestrationV2Run, "id" | "ordinal" | "restartContinuationOfRunId">;
  readonly runs: ReadonlyArray<Pick<OrchestrationV2Run, "id" | "ordinal">>;
  readonly attempts: ReadonlyArray<Pick<OrchestrationV2RunAttempt, "id" | "runId">>;
  readonly providerTurns: ReadonlyArray<
    Pick<OrchestrationV2ProviderTurn, "runAttemptId" | "status">
  >;
  readonly isCompaction: boolean;
  readonly cwd: string | null;
}): string {
  const sync = input.thread.environmentSync;
  if (
    sync === undefined ||
    input.isCompaction ||
    input.run.restartContinuationOfRunId !== undefined ||
    input.run.ordinal <= sync.afterRunOrdinal
  ) {
    return "";
  }
  const runsHere = new Set(
    input.runs.filter((run) => run.ordinal > sync.afterRunOrdinal).map((run) => run.id),
  );
  const deliveredAttempts = new Set(
    input.providerTurns
      .filter((turn) => turn.status === "completed")
      .map((turn) => turn.runAttemptId),
  );
  const delivered = input.attempts.some(
    (attempt) => runsHere.has(attempt.runId) && deliveredAttempts.has(attempt.id),
  );
  return delivered ? "" : environmentSyncNote(sync, input.cwd);
}
