import type { OrchestrationV2ProviderTurn, ProjectId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type * as ProjectService from "../project/ProjectService.ts";

/**
 * What the last environment sync into a repository brought, kept inside its
 * `.git` directory. The first thread to start a turn afterwards claims it and
 * tells its agent, so one conversation learns the checkout came from another
 * machine and later ones are not told again.
 */
const EnvironmentSyncNoteRecord = Schema.Struct({
  originLabel: Schema.String,
  hostLabel: Schema.String,
  originWorkspaceRoot: Schema.String,
  syncedAt: Schema.String,
  checkouts: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      originPath: Schema.String,
      notes: Schema.Array(Schema.String),
    }),
  ),
  claimedByThreadId: Schema.optional(Schema.String),
});
type EnvironmentSyncNoteRecord = typeof EnvironmentSyncNoteRecord.Type;

const decodeRecord = Schema.decodeUnknownEffect(Schema.fromJsonString(EnvironmentSyncNoteRecord));
const encodeRecord = Schema.encodeEffect(Schema.fromJsonString(EnvironmentSyncNoteRecord));

function recordPath(workspaceRoot: string): string {
  const separator = workspaceRoot.includes("\\") && !workspaceRoot.includes("/") ? "\\" : "/";
  return [workspaceRoot.replace(/[/\\]+$/, ""), ".git", "t3-environment-sync.json"].join(separator);
}

/** Replaces the record after a sync. A repository whose `.git` is not a directory keeps none. */
export const writeEnvironmentSyncNote = (
  fileSystem: FileSystem.FileSystem,
  workspaceRoot: string,
  record: EnvironmentSyncNoteRecord,
) =>
  encodeRecord(record).pipe(
    Effect.flatMap((json) => fileSystem.writeFileString(recordPath(workspaceRoot), json)),
    Effect.ignore,
  );

/** Provider-facing text telling the agent where its checkout came from. */
function environmentSyncNote(record: EnvironmentSyncNoteRecord, cwd: string | null): string {
  const checkout = record.checkouts.find((candidate) => candidate.path === cwd);
  return [
    `Note: this project was synced to "${record.hostLabel}" from another machine, "${record.originLabel}", on ${record.syncedAt}. There it lives in ${checkout?.originPath ?? record.originWorkspaceRoot}.`,
    "Git history, branches, and uncommitted changes were copied. Files Git ignores were not: installed dependencies, build output, and local config such as .env files.",
    `If something you expect is missing here, it may still exist on "${record.originLabel}". Reinstall or rebuild it, or ask the user to copy it over.`,
    ...(checkout?.notes ?? []),
  ].join("\n");
}

/**
 * The note for this turn, or an empty string. The thread that asks first
 * claims the record, and keeps getting the note until one of its turns
 * completes after the sync, which proves the agent was told.
 */
export const pendingEnvironmentSyncNote = Effect.fn("pendingEnvironmentSyncNote")(
  function* (input: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly projects: Pick<ProjectService.ProjectService["Service"], "getById">;
    readonly projectId: ProjectId;
    readonly threadId: ThreadId;
    readonly providerTurns: ReadonlyArray<
      Pick<OrchestrationV2ProviderTurn, "status" | "completedAt">
    >;
    /** Compactions and restart continuations carry no text of their own. */
    readonly carriesText: boolean;
    readonly cwd: string | null;
  }) {
    if (!input.carriesText) return "";
    const project = yield* input.projects.getById(input.projectId);
    if (Option.isNone(project)) return "";
    const file = recordPath(project.value.workspaceRoot);
    const record = yield* input.fileSystem.readFileString(file).pipe(Effect.flatMap(decodeRecord));
    if (record.claimedByThreadId !== undefined && record.claimedByThreadId !== input.threadId) {
      return "";
    }
    const syncedAt = Date.parse(record.syncedAt);
    const told = input.providerTurns.some(
      (turn) =>
        turn.status === "completed" &&
        turn.completedAt !== null &&
        DateTime.toEpochMillis(turn.completedAt) > syncedAt,
    );
    if (told) return "";
    if (record.claimedByThreadId === undefined) {
      yield* input.fileSystem.writeFileString(
        file,
        yield* encodeRecord({ ...record, claimedByThreadId: input.threadId }),
      );
    }
    return environmentSyncNote(record, input.cwd);
  },
  // A note is never worth a failed turn, whatever went wrong reading it.
  Effect.orElseSucceed(() => ""),
  Effect.catchDefect(() => Effect.succeed("")),
);
