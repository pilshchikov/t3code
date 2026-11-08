import { AuthOrchestrationOperateScope } from "@t3tools/contracts";

import { getClientSettings, persistClientSettingsPatch } from "./hooks/useSettings";
import {
  deriveLogicalProjectKeyFromSettings,
  projectGroupLogicalKey,
  selectProjectGroupingSettings,
  withProjectLink,
} from "./logicalProject";
import { randomUUID } from "./lib/utils";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { readProjects } from "./state/entities";
import { readEnvironment } from "./state/environments";
import { projectEnvironment } from "./state/projects";
import { readEnvironmentScope } from "./state/session";
import type { Project } from "./types";

type LinkableProject = Pick<
  Project,
  | "environmentId"
  | "id"
  | "title"
  | "workspaceRoot"
  | "repositoryIdentity"
  | "isScratch"
  | "groupKey"
>;

const canStoreGroup = (project: LinkableProject) => {
  const environment = readEnvironment(project.environmentId);
  return (
    environment?.connection.phase === "connected" &&
    environment.serverConfig?.environment.capabilities.projectGroups === true &&
    readEnvironmentScope(project.environmentId, AuthOrchestrationOperateScope)
  );
};

const newGroupKey = (title: string) => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "project"}-${randomUUID().slice(0, 6)}`;
};

async function storeGroupKey(projects: ReadonlyArray<LinkableProject>, groupKey: string | null) {
  for (const project of projects) {
    if ((project.groupKey ?? null) === groupKey) continue;
    const result = await projectEnvironment.update.run(appAtomRegistry, {
      environmentId: project.environmentId,
      input: { projectId: project.id, groupKey },
    });
    if (result._tag === "Failure") return false;
  }
  return true;
}

/**
 * Shows checkouts under another logical project, or their own again for null, and returns
 * the key they end up under. The group lives on the servers when every machine involved can
 * store it; otherwise it is a link on this device.
 */
export async function linkProjects(
  projects: ReadonlyArray<LinkableProject>,
  logicalProjectKey: string | null,
): Promise<string | null> {
  const settings = selectProjectGroupingSettings(getClientSettings());
  let links = settings.sidebarProjectLinks ?? {};
  if (logicalProjectKey === null) {
    await storeGroupKey(
      projects.filter((project) => project.groupKey != null && canStoreGroup(project)),
      null,
    );
  } else {
    const targets = readProjects().filter(
      (project) =>
        project.isScratch !== true &&
        deriveLogicalProjectKeyFromSettings(project, settings) === logicalProjectKey,
    );
    const members = [...targets, ...projects].filter((project) => project.isScratch !== true);
    if (members.length > 0 && members.every(canStoreGroup)) {
      const groupKey =
        members.find((project) => project.groupKey != null)?.groupKey ??
        newGroupKey(members[0]!.title);
      if (await storeGroupKey(members, groupKey)) {
        for (const project of members) {
          links = withProjectLink(project, null, { ...settings, sidebarProjectLinks: links });
        }
        await persistClientSettingsPatch({ sidebarProjectLinks: links });
        return projectGroupLogicalKey(groupKey);
      }
    }
  }
  for (const project of projects) {
    links = withProjectLink(project, logicalProjectKey, {
      ...settings,
      sidebarProjectLinks: links,
    });
  }
  await persistClientSettingsPatch({ sidebarProjectLinks: links });
  return logicalProjectKey;
}
