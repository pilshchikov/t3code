import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import { resolveSidebarThreadStatus } from "../Sidebar.logic";

/**
 * Projects whose rail icon should carry a dot: something there is running or
 * waiting on a person. Archived threads never count, since the sidebar hides
 * them until asked.
 */
export function projectKeysWithLiveWork(
  threads: ReadonlyArray<EnvironmentThreadShell>,
): ReadonlySet<string> {
  const live = new Set<string>();
  for (const thread of threads) {
    if (thread.archivedAt != null) continue;
    const status = resolveSidebarThreadStatus(thread);
    if (status !== "working" && status !== "approval" && status !== "input") continue;
    live.add(`${thread.environmentId}:${thread.projectId}`);
  }
  return live;
}
