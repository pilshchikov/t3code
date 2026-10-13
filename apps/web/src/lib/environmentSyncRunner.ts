import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import {
  findEnvironmentSyncTargetProject,
  runEnvironmentSync,
  type EnvironmentSyncOutcome,
  type EnvironmentSyncProgress,
} from "@t3tools/client-runtime/state/environment-sync";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type {
  EnvironmentId,
  EnvironmentSyncImportResult,
  EnvironmentSyncPeer,
  ProjectId,
} from "@t3tools/contracts";

import { toastManager } from "../components/ui/toast";
import { hiddenToastActionProps, stackedThreadToast } from "../components/ui/toastHelpers";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readProjects, waitForProject } from "../state/entities";
import { environmentSyncEnvironment } from "../state/environmentSync";
import { readPreparedConnection } from "../state/session";
import { formatBytes } from "./formatBytes";

interface EnvironmentSyncRequest {
  readonly source: EnvironmentSyncPeer;
  readonly target: EnvironmentSyncPeer;
  readonly project: {
    readonly projectId: ProjectId;
    readonly title: string;
    readonly workspaceRoot: string;
  };
  /** The project on the target that holds the same repository, when there is one. */
  readonly targetProjectId: ProjectId | null;
  /** Folder for a project the target does not have yet. Null uses the target's synced projects folder. */
  readonly destinationPath: string | null;
}

/** An environment as the sync needs it: where it is, what it is called, and whether it can sync. */
export interface SyncEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connection: { readonly phase: string };
  readonly serverConfig: {
    readonly environment: { readonly capabilities: { readonly environmentSync?: boolean } };
  } | null;
}

export function canEnvironmentSync(environment: SyncEnvironment | null | undefined): boolean {
  return (
    environment?.connection.phase === "connected" &&
    environment.serverConfig?.environment.capabilities.environmentSync === true
  );
}

/** One sync per project and target at a time. A second would race the first one's checkout. */
const running = new Set<string>();

export function projectFolderName(workspaceRoot: string): string {
  const segments = workspaceRoot.split(/[/\\]/).filter((segment) => segment.length > 0);
  return segments.at(-1) ?? "project";
}

function progressDescription(
  progress: EnvironmentSyncProgress,
  request: EnvironmentSyncRequest,
): string {
  switch (progress.stage) {
    case "preparing":
      return `Checking what ${request.target.label} already has`;
    case "exporting":
      return `Packing changes on ${request.source.label}`;
    case "transferring":
      return progress.totalBytes === 0
        ? "Nothing new to copy"
        : `Copying ${formatBytes(progress.transferredBytes)} of ${formatBytes(progress.totalBytes)}`;
    case "importing":
      return `Updating the checkouts on ${request.target.label}`;
  }
}

/** What a finished sync did, in one line, and what the user should look at. */
function describeEnvironmentSyncResult(result: EnvironmentSyncImportResult): {
  readonly summary: string;
  readonly problems: ReadonlyArray<string>;
} {
  const checkouts = `${result.syncedCheckouts} checkout${result.syncedCheckouts === 1 ? "" : "s"}`;
  return {
    summary: result.projectCreated
      ? `Created in ${result.workspaceRoot} with ${checkouts}`
      : `${checkouts} match the source`,
    problems: result.warnings,
  };
}

/**
 * Runs a sync with one toast that follows it from start to finish. The toast
 * outlives whatever started it, so progress stays visible while the user keeps
 * working. Returns null when the same sync is already running.
 */
async function startEnvironmentSync(
  request: EnvironmentSyncRequest,
): Promise<EnvironmentSyncOutcome | null> {
  const key = `${request.target.environmentId}:${request.project.projectId}`;
  if (running.has(key)) {
    toastManager.add(
      stackedThreadToast({
        type: "info",
        title: `Already syncing ${request.project.title} to ${request.target.label}`,
      }),
    );
    return null;
  }
  running.add(key);
  const title = `Syncing ${request.project.title} to ${request.target.label}`;
  const loading = (description: string) =>
    stackedThreadToast({
      type: "loading",
      title,
      description,
      timeout: 0,
      data: { hideCopyButton: true },
    });
  const toastId = toastManager.add(loading(`Checking what ${request.target.label} already has`));
  let lastDescription = "";

  try {
    const outcome = await runEnvironmentSync({
      registry: appAtomRegistry,
      commands: environmentSyncEnvironment,
      source: request.source,
      target: request.target,
      sourceProjectId: request.project.projectId,
      prepare: {
        project: {
          projectId: request.project.projectId,
          title: request.project.title,
          folderName: projectFolderName(request.project.workspaceRoot),
        },
        ...(request.targetProjectId === null ? {} : { targetProjectId: request.targetProjectId }),
        ...(request.destinationPath === null ? {} : { destinationPath: request.destinationPath }),
      },
      resolveUrl: (environmentId, relativePath) => {
        const connection = readPreparedConnection(environmentId);
        return connection ? resolveAssetUrl(connection.httpBaseUrl, relativePath) : null;
      },
      onProgress: (progress) => {
        const description = progressDescription(progress, request);
        if (description === lastDescription) return;
        lastDescription = description;
        toastManager.update(toastId, loading(description));
      },
    });

    if (outcome.status === "failed") {
      toastManager.update(
        toastId,
        stackedThreadToast({
          type: "error",
          title: `Could not sync ${request.project.title} to ${request.target.label}`,
          description: outcome.message,
          timeout: 0,
          actionProps: hiddenToastActionProps,
        }),
      );
      return outcome;
    }

    const { summary, problems } = describeEnvironmentSyncResult(outcome.result);
    toastManager.update(
      toastId,
      stackedThreadToast({
        type: problems.length > 0 ? "warning" : "success",
        title: `Synced ${request.project.title} to ${request.target.label}`,
        description: problems.length === 0 ? summary : `${summary}. ${problems.join(" ")}`,
        timeout: problems.length > 0 ? 0 : 5_000,
        actionProps: hiddenToastActionProps,
        data: { hideCopyButton: problems.length === 0 },
      }),
    );
    return outcome;
  } finally {
    running.delete(key);
  }
}

/**
 * Brings `project` to `target` as it stands on `source`, and returns the
 * project there once the client has it. Null when the sync did not finish.
 */
export async function syncProjectToEnvironment(input: {
  readonly source: SyncEnvironment;
  readonly target: SyncEnvironment;
  readonly project: EnvironmentProject;
  readonly destinationPath?: string | null;
}): Promise<EnvironmentProject | null> {
  const existing = findEnvironmentSyncTargetProject({
    sourceProject: input.project,
    targetEnvironmentId: input.target.environmentId,
    projects: readProjects(),
  });
  const outcome = await startEnvironmentSync({
    source: { environmentId: input.source.environmentId, label: input.source.label },
    target: { environmentId: input.target.environmentId, label: input.target.label },
    project: {
      projectId: input.project.id,
      title: input.project.title,
      workspaceRoot: input.project.workspaceRoot,
    },
    targetProjectId: existing?.id ?? null,
    destinationPath: input.destinationPath ?? null,
  });
  if (outcome?.status !== "synced") return null;
  return waitForProject({
    environmentId: input.target.environmentId,
    projectId: outcome.result.projectId,
  }).catch(() => null);
}
