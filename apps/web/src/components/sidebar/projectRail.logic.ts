import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";

import { hasUnseenCompletion, resolveSidebarThreadStatus } from "../Sidebar.logic";

export interface ProjectRailStatus {
  running: boolean;
  completed: boolean;
  input: boolean;
}

export function projectRailStatuses(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  lastVisitedByThread: Readonly<Record<string, string>>,
): ReadonlyMap<string, ProjectRailStatus> {
  const projects = new Map<string, ProjectRailStatus>();
  for (const thread of threads) {
    if (thread.archivedAt != null) continue;
    const key = `${thread.environmentId}:${thread.projectId}`;
    const status = projects.get(key) ?? { running: false, completed: false, input: false };
    const threadStatus = resolveSidebarThreadStatus(thread);
    status.running ||= threadStatus === "working" || threadStatus === "monitoring";
    status.input ||= threadStatus === "approval" || threadStatus === "input";
    status.completed ||= hasUnseenCompletion({
      ...thread,
      lastVisitedAt:
        lastVisitedByThread[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
    });
    projects.set(key, status);
  }
  return projects;
}
