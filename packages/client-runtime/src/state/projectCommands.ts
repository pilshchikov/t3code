import {
  type EnvironmentId,
  ProjectId,
  type ProjectReadFileResult,
  type ScopedProjectRef,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import { type EnvironmentRpcInput, request } from "../rpc/client.ts";
import type { EnvironmentProject } from "./models.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentCommand,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import {
  type CreateProjectInput,
  type DeleteProjectInput,
  type UpdateProjectInput,
  createProject,
  deleteProject,
  updateProject,
} from "../operations/commands.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export type {
  CreateProjectInput,
  DeleteProjectInput,
  UpdateProjectInput,
} from "../operations/commands.ts";

export interface OptimisticProjectFile {
  readonly data: ProjectReadFileResult;
  readonly confirmedAgainst: object | null | undefined;
}

export interface OptimisticProjectFileTarget {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string;
}

function optimisticProjectFileKey(target: OptimisticProjectFileTarget): string {
  return JSON.stringify([target.environmentId, target.cwd, target.relativePath]);
}

/** The Scratch project was created, but its event never reached this client. */
export class ScratchProjectNotLoadedError extends Schema.TaggedError<ScratchProjectNotLoadedError>()(
  "ScratchProjectNotLoadedError",
  { projectId: ProjectId },
) {
  override get message(): string {
    return "The folder for threads without a project has not reached this device yet. Try again.";
  }
}

export function createProjectEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Crypto.Crypto | R, E>,
  options: {
    /** The client store's project; openScratch waits here for the created project. */
    readonly projectAtom: (ref: ScopedProjectRef) => Atom.Atom<EnvironmentProject | null>;
  },
) {
  const projectScheduler = createAtomCommandScheduler();
  const fileScheduler = createAtomCommandScheduler();
  const optimisticFileFamily = Atom.family((key: string) =>
    Atom.make<OptimisticProjectFile | null>(null).pipe(
      Atom.withLabel(`environment-data:projects:optimistic-file:${key}`),
    ),
  );
  const projectConcurrency = {
    mode: "serial" as const,
    key: ({ environmentId, input }: { environmentId: string; input: { projectId: string } }) =>
      JSON.stringify([environmentId, input.projectId]),
  };
  return {
    searchEntries: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:projects:search-entries",
      tag: WS_METHODS.projectsSearchEntries,
      staleTimeMs: 15_000,
    }),
    listResumableSessions: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:sessions:list-resumable",
      tag: WS_METHODS.sessionsListResumable,
      staleTimeMs: 15_000,
      idleTtlMs: 5 * 60_000,
    }),
    searchCode: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:projects:search-code",
      tag: WS_METHODS.projectsSearchCode,
      staleTimeMs: 5_000,
    }),
    listEntries: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:projects:list-entries",
      tag: WS_METHODS.projectsListEntries,
      retainPreviousData: true,
      idleTtlMs: 60_000,
    }),
    watchEntries: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:projects:watch-entries",
      tag: WS_METHODS.projectsWatchEntries,
      // Visible file trees own the host watcher; stop it as soon as the last consumer unmounts.
      idleTtlMs: 0,
    }),
    readFile: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:projects:read-file",
      tag: WS_METHODS.projectsReadFile,
      retainPreviousData: true,
      // Open tabs explicitly validate disk identity; age alone must not reread/repaint them.
      staleTimeMs: Infinity,
      idleTtlMs: 0,
    }),
    watchFile: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:projects:watch-file",
      tag: WS_METHODS.projectsWatchFile,
      // Stop the host watcher as soon as the file surface unmounts.
      idleTtlMs: 0,
    }),
    optimisticFile: (target: OptimisticProjectFileTarget) =>
      optimisticFileFamily(optimisticProjectFileKey(target)),
    create: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:project:create",
      execute: (input: CreateProjectInput) => createProject(input),
      scheduler: projectScheduler,
      concurrency: projectConcurrency,
    }),
    update: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:project:update",
      execute: (input: UpdateProjectInput) => updateProject(input),
      scheduler: projectScheduler,
      concurrency: projectConcurrency,
    }),
    delete: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:project:delete",
      execute: (input: DeleteProjectInput) => deleteProject(input),
      scheduler: projectScheduler,
      concurrency: projectConcurrency,
    }),
    /**
     * One-shot read for callers that need a file's contents at a moment in time rather than a
     * subscription to them — snapshotting before a delete, so the delete can be undone.
     */
    readFileOnce: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:projects:read-file-once",
      tag: WS_METHODS.projectsReadFile,
      scheduler: fileScheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId, input }) =>
          JSON.stringify([environmentId, input.cwd, input.relativePath]),
      },
    }),
    // Finds or creates the environment's Scratch project and resolves once the
    // project is in the client store, since drafts key off its stored path.
    openScratch: createEnvironmentCommand(runtime, {
      label: "environment-data:projects:open-scratch",
      execute: (
        input: EnvironmentRpcInput<typeof WS_METHODS.projectsEnsureScratch>,
        registry,
        environmentId,
      ) =>
        request(WS_METHODS.projectsEnsureScratch, input).pipe(
          Effect.flatMap(({ projectId }) =>
            AtomRegistry.toStream(registry, options.projectAtom({ environmentId, projectId })).pipe(
              Stream.filter(Predicate.isNotNull),
              Stream.runHead,
              Effect.timeoutOption("10 seconds"),
              Effect.map(Option.flatten),
              Effect.flatMap(
                Option.match({
                  onSome: Effect.succeed,
                  onNone: () => Effect.fail(new ScratchProjectNotLoadedError({ projectId })),
                }),
              ),
            ),
          ),
        ),
      scheduler: projectScheduler,
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
    // Makes a new folder and repository from just a name, then the project.
    createNew: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:projects:create-new",
      tag: WS_METHODS.projectsCreateNew,
      scheduler: projectScheduler,
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
    writeFile: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:projects:write-file",
      tag: WS_METHODS.projectsWriteFile,
      scheduler: fileScheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId, input }) =>
          JSON.stringify([environmentId, input.cwd, input.relativePath]),
      },
    }),
    deleteEntry: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:projects:delete-entry",
      tag: WS_METHODS.projectsDeleteEntry,
      scheduler: fileScheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId, input }) =>
          JSON.stringify([environmentId, input.cwd, input.relativePath]),
      },
    }),
  };
}
