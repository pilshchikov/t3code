import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  createEnvironmentRpcCommand,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ProjectId,
  type ScopedThreadRef,
  WS_METHODS,
} from "@t3tools/contracts";

import { stackedThreadToast, toastManager } from "./components/ui/toast";
import { connectionAtomRuntime } from "./connection/runtime";
import { getClientSettings } from "./hooks/useSettings";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "./logicalProject";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { readProjects, readThreadShell } from "./state/entities";
import { readEnvironment } from "./state/environments";
import { readEnvironmentScope } from "./state/session";

export interface ThreadMoveTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly label: string;
}

const command = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:peer-threads-move",
  tag: WS_METHODS.peerThreadsMove,
  concurrency: { mode: "parallel" },
});

const reachable = (environmentId: EnvironmentId, capability: "threadMove" | "projectGroups") => {
  const environment = readEnvironment(environmentId);
  return (
    environment?.connection.phase === "connected" &&
    environment.serverConfig?.environment.capabilities[capability] === true &&
    readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)
  );
};

/** The same project on the other machines first, then the other projects on the thread's own. */
export function threadMoveTargets(threadRef: ScopedThreadRef): ReadonlyArray<ThreadMoveTarget> {
  const thread = readThreadShell(threadRef);
  if (thread === null || !reachable(threadRef.environmentId, "threadMove")) return [];
  const settings = selectProjectGroupingSettings(getClientSettings());
  const projects = readProjects().filter(
    (project) => project.isScratch !== true && project.archivedAt == null,
  );
  const own = projects.find(
    (project) =>
      project.environmentId === threadRef.environmentId && project.id === thread.projectId,
  );
  const ownKey = own === undefined ? null : deriveLogicalProjectKeyFromSettings(own, settings);
  const elsewhere = projects
    .filter(
      (project) =>
        project.environmentId !== threadRef.environmentId &&
        ownKey !== null &&
        deriveLogicalProjectKeyFromSettings(project, settings) === ownKey &&
        reachable(project.environmentId, "projectGroups"),
    )
    .map((project) => ({
      environmentId: project.environmentId,
      projectId: project.id,
      label: readEnvironment(project.environmentId)?.label ?? project.environmentId,
    }));
  const here = projects
    .filter(
      (project) =>
        project.environmentId === threadRef.environmentId && project.id !== thread.projectId,
    )
    .toSorted((left, right) => left.title.localeCompare(right.title))
    .map((project) => ({
      environmentId: project.environmentId,
      projectId: project.id,
      label: project.title,
    }));
  return [...elsewhere, ...here];
}

const moveThread = (threadRef: ScopedThreadRef, target: ThreadMoveTarget) =>
  command.run(appAtomRegistry, {
    environmentId: threadRef.environmentId,
    input: {
      threadId: threadRef.threadId,
      environmentId: target.environmentId,
      projectId: target.projectId,
    },
  });

export async function moveThreadAndOpen(
  threadRef: ScopedThreadRef,
  target: ThreadMoveTarget,
  open: (ref: ScopedThreadRef) => void,
) {
  const result = await moveThread(threadRef, target);
  if (result._tag === "Success") {
    toastManager.add({ type: "success", title: "Thread moved", description: target.label });
    open(scopeThreadRef(result.value.environmentId, result.value.threadId));
    return;
  }
  if (isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: "Could not move thread",
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}
