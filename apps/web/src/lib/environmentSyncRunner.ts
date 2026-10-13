import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import {
  runEnvironmentSync,
  type EnvironmentSyncOutcome,
  type EnvironmentSyncProgress,
} from "@t3tools/client-runtime/state/environment-sync";
import type {
  EnvironmentSyncImportResult,
  EnvironmentSyncPeer,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";

import { toastManager } from "../components/ui/toast";
import { hiddenToastActionProps, stackedThreadToast } from "../components/ui/toastHelpers";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentSyncEnvironment } from "../state/environmentSync";
import { readPreparedConnection } from "../state/session";
import { formatBytes } from "./formatBytes";

export interface EnvironmentSyncRequest {
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
  readonly rootThreadIds: ReadonlyArray<ThreadId>;
  /** Also bring the project folder's checkout when no synced thread works in it. */
  readonly includeProjectCheckout: boolean;
  /** Shown as the toast's button once the sync succeeds. */
  readonly followUp?: {
    readonly label: string;
    readonly run: (result: EnvironmentSyncImportResult) => void;
  };
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
      switch (progress.step) {
        case "threads":
          return progress.total === 0
            ? `Updating threads on ${request.target.label}`
            : `Updating threads on ${request.target.label} · ${Math.round((progress.completed / progress.total) * 100)}%`;
        case "attachments":
          return `Storing attachments on ${request.target.label}`;
        case "waiting":
        case "repository":
        case "workspaces":
          return `Updating the checkout on ${request.target.label}`;
      }
  }
}

/** What a finished sync did, in the order a user cares about it. */
export function describeEnvironmentSyncResult(
  result: EnvironmentSyncImportResult,
  targetLabel: string,
): { readonly summary: string; readonly problems: ReadonlyArray<string> } {
  const roots = result.threads.filter((thread) => thread.threadId === thread.rootThreadId);
  const count = (action: (typeof roots)[number]["action"]) =>
    roots.filter((thread) => thread.action === action).length;
  const updated = roots.filter(
    (thread) => thread.action === "import" && thread.importedEventCount > 0,
  ).length;
  const plural = (value: number, noun: string) => `${value} ${noun}${value === 1 ? "" : "s"}`;
  const summary =
    updated > 0
      ? `${plural(updated, "thread")} updated`
      : result.projectCreated
        ? `Created in ${result.workspaceRoot}`
        : "Already up to date";
  const problems = [
    ...(count("diverged") > 0
      ? [`${plural(count("diverged"), "thread")} changed on both machines and stayed as they are.`]
      : []),
    ...(count("busy") > 0 ? [`${plural(count("busy"), "thread")} still working and skipped.`] : []),
    ...(count("target_ahead") > 0
      ? [`${plural(count("target_ahead"), "thread")} already newer on ${targetLabel}.`]
      : []),
    ...result.warnings,
  ];
  return { summary, problems };
}

/**
 * Runs a sync with one toast that follows it from start to finish. The toast
 * outlives the menu that started it, so progress stays visible while the user
 * keeps working. Returns null when the same sync is already running.
 */
export async function startEnvironmentSync(
  request: EnvironmentSyncRequest,
): Promise<EnvironmentSyncOutcome | null> {
  const key = `${request.target.environmentId}:${request.project.projectId}`;
  if (running.has(key)) return null;
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
        rootThreadIds: request.rootThreadIds,
        includeProjectCheckout: request.includeProjectCheckout,
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

    const { summary, problems } = describeEnvironmentSyncResult(
      outcome.result,
      request.target.label,
    );
    const followUp = request.followUp;
    toastManager.update(
      toastId,
      stackedThreadToast({
        type: problems.length > 0 ? "warning" : "success",
        title: `Synced ${request.project.title} to ${request.target.label}`,
        description: problems.length === 0 ? summary : `${summary}. ${problems.join(" ")}`,
        timeout: problems.length > 0 ? 0 : 6_000,
        actionProps:
          followUp === undefined
            ? hiddenToastActionProps
            : {
                children: followUp.label,
                onClick: () => {
                  toastManager.close(toastId);
                  followUp.run(outcome.result);
                },
              },
        data: { hideCopyButton: problems.length === 0 },
      }),
    );
    return outcome;
  } finally {
    running.delete(key);
  }
}
