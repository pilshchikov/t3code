import { scopedProjectKey, scopeProjectRef } from "../environment/scoped.ts";
import {
  repositoryGroupingDisplayNameOf,
  repositoryGroupingKeyOf,
  type EnvironmentId,
  type ScopedProjectRef,
  type SidebarProjectGroupingMode,
} from "@t3tools/contracts";
import type { ClientSettings, DesktopProjectLayout } from "@t3tools/contracts/settings";

import type { EnvironmentProject } from "./models.ts";
import { normalizeProjectPathForComparison } from "./projects.ts";

const SCRATCH_PROJECT_SCOPE_KEY = "\0no-project";

export interface ProjectGroupingSettings {
  readonly sidebarProjectGroupingMode: SidebarProjectGroupingMode;
  readonly sidebarProjectGroupingOverrides: Record<string, SidebarProjectGroupingMode>;
  /** Physical project key to the logical project its checkout was attached to by hand. */
  readonly sidebarProjectLinks?: Record<string, string>;
}

export type ProjectGroupingMode = SidebarProjectGroupingMode;

export function selectProjectGroupingSettings(settings: ClientSettings): ProjectGroupingSettings {
  return {
    sidebarProjectGroupingMode: settings.sidebarProjectGroupingMode,
    sidebarProjectGroupingOverrides: settings.sidebarProjectGroupingOverrides,
    sidebarProjectLinks: settings.sidebarProjectLinks,
  };
}

function uniqueNonEmptyValues(values: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    unique.push(trimmed);
  }
  return unique;
}

function deriveRepositoryRelativeProjectPath(
  project: Pick<EnvironmentProject, "workspaceRoot" | "repositoryIdentity">,
): string | null {
  const rootPath = project.repositoryIdentity?.rootPath?.trim();
  if (!rootPath) {
    return null;
  }

  const normalizedProjectPath = normalizeProjectPathForComparison(project.workspaceRoot);
  const normalizedRootPath = normalizeProjectPathForComparison(rootPath);
  if (normalizedProjectPath.length === 0 || normalizedRootPath.length === 0) {
    return null;
  }

  if (normalizedProjectPath === normalizedRootPath) {
    return "";
  }

  const separator = normalizedRootPath.includes("\\") ? "\\" : "/";
  const rootPrefix = `${normalizedRootPath}${separator}`;
  if (!normalizedProjectPath.startsWith(rootPrefix)) {
    return null;
  }

  return normalizedProjectPath.slice(rootPrefix.length).replaceAll("\\", "/");
}

export function derivePhysicalProjectKeyFromPath(environmentId: string, cwd: string): string {
  return `${environmentId}:${normalizeProjectPathForComparison(cwd)}`;
}

export function derivePhysicalProjectKey(
  project: Pick<EnvironmentProject, "environmentId" | "workspaceRoot">,
): string {
  return derivePhysicalProjectKeyFromPath(project.environmentId, project.workspaceRoot);
}

function deriveProjectGroupingOverrideKey(
  project: Pick<EnvironmentProject, "environmentId" | "workspaceRoot">,
): string {
  return derivePhysicalProjectKey(project);
}

export function getProjectOrderKey(
  project: Pick<EnvironmentProject, "environmentId" | "workspaceRoot">,
): string {
  return derivePhysicalProjectKey(project);
}

function resolveProjectGroupingMode(
  project: Pick<EnvironmentProject, "environmentId" | "workspaceRoot">,
  settings: ProjectGroupingSettings,
): SidebarProjectGroupingMode {
  return (
    settings.sidebarProjectGroupingOverrides?.[deriveProjectGroupingOverrideKey(project)] ??
    settings.sidebarProjectGroupingMode
  );
}

function deriveRepositoryScopedKey(
  project: Pick<EnvironmentProject, "workspaceRoot" | "repositoryIdentity">,
  groupingMode: SidebarProjectGroupingMode,
): string | null {
  const canonicalKey = project.repositoryIdentity
    ? repositoryGroupingKeyOf(project.repositoryIdentity)
    : null;
  // A NUL reserves the scratch key namespace outside valid repository identities.
  if (!canonicalKey || canonicalKey.includes("\0")) {
    return null;
  }

  if (groupingMode === "repository") {
    return canonicalKey;
  }

  const relativeProjectPath = deriveRepositoryRelativeProjectPath(project);
  if (relativeProjectPath === null) {
    return canonicalKey;
  }

  return relativeProjectPath.length === 0
    ? canonicalKey
    : `${canonicalKey}::${relativeProjectPath}`;
}

export function projectGroupLogicalKey(groupKey: string): string {
  // The NUL keeps group keys apart from repository keys, which never contain one.
  return `\0group:${groupKey}`;
}

function deriveLogicalProjectKey(
  project: Pick<
    EnvironmentProject,
    "environmentId" | "id" | "workspaceRoot" | "repositoryIdentity" | "isScratch" | "groupKey"
  >,
  options?: {
    readonly groupingMode?: SidebarProjectGroupingMode;
    readonly groupScratchProjects?: boolean;
  },
): string {
  if (options?.groupScratchProjects && project.isScratch) return SCRATCH_PROJECT_SCOPE_KEY;
  const groupKey = project.isScratch ? undefined : project.groupKey?.trim();
  if (groupKey) return projectGroupLogicalKey(groupKey);
  const groupingMode = options?.groupingMode ?? "repository";
  if (groupingMode === "separate") {
    return derivePhysicalProjectKey(project);
  }

  return (
    deriveRepositoryScopedKey(project, groupingMode) ??
    derivePhysicalProjectKey(project) ??
    scopedProjectKey(scopeProjectRef(project.environmentId, project.id))
  );
}

/**
 * A hand-made link outranks repository matching but not a server-stored group, which every
 * device shares. The "No project" folders are never linked.
 */
function linkedLogicalProjectKey(
  project: Pick<EnvironmentProject, "environmentId" | "workspaceRoot" | "isScratch" | "groupKey">,
  settings: ProjectGroupingSettings,
): string | undefined {
  return project.isScratch || project.groupKey?.trim()
    ? undefined
    : settings.sidebarProjectLinks?.[derivePhysicalProjectKey(project)];
}

export function deriveLogicalProjectKeyFromSettings(
  project: Pick<
    EnvironmentProject,
    "environmentId" | "id" | "workspaceRoot" | "repositoryIdentity" | "isScratch" | "groupKey"
  >,
  settings: ProjectGroupingSettings,
  options?: { readonly groupScratchProjects?: boolean },
): string {
  return (
    linkedLogicalProjectKey(project, settings) ??
    deriveLogicalProjectKey(project, {
      groupingMode: resolveProjectGroupingMode(project, settings),
      groupScratchProjects: options?.groupScratchProjects ?? false,
    })
  );
}

/**
 * The link map after attaching `project` to `logicalProjectKey`. Attaching a
 * checkout to the project it already belongs to without help removes its link.
 */
export function withProjectLink(
  project: Pick<
    EnvironmentProject,
    "environmentId" | "id" | "workspaceRoot" | "repositoryIdentity" | "isScratch" | "groupKey"
  >,
  logicalProjectKey: string | null,
  settings: ProjectGroupingSettings,
): Record<string, string> {
  const physicalProjectKey = derivePhysicalProjectKey(project);
  const { [physicalProjectKey]: _previous, ...links } = settings.sidebarProjectLinks ?? {};
  if (logicalProjectKey === null || project.isScratch) return links;
  const unaided = deriveLogicalProjectKeyFromSettings(project, {
    ...settings,
    sidebarProjectLinks: links,
  });
  return unaided === logicalProjectKey
    ? links
    : { ...links, [physicalProjectKey]: logicalProjectKey };
}

export function resolveScratchProjectScopeKey(
  key: string | null,
  projects: ReadonlyArray<
    Pick<
      EnvironmentProject,
      "environmentId" | "id" | "workspaceRoot" | "repositoryIdentity" | "isScratch" | "groupKey"
    >
  >,
  settings: ProjectGroupingSettings = {
    sidebarProjectGroupingMode: "repository",
    sidebarProjectGroupingOverrides: {},
  },
): string | null {
  if (key === null || key === SCRATCH_PROJECT_SCOPE_KEY) return key;
  if (
    projects.some(
      (project) =>
        deriveLogicalProjectKeyFromSettings(project, settings, { groupScratchProjects: true }) ===
        key,
    )
  ) {
    return key;
  }
  return projects.some((project) => {
    if (!project.isScratch) return false;
    const mode = resolveProjectGroupingMode(project, settings);
    return (
      derivePhysicalProjectKey(project) === key ||
      (mode !== "separate" && deriveRepositoryScopedKey(project, mode) === key)
    );
  })
    ? SCRATCH_PROJECT_SCOPE_KEY
    : key;
}

export function deriveProjectGroupLabel(input: {
  readonly groupKey: string;
  readonly representative: Pick<EnvironmentProject, "title" | "repositoryIdentity">;
  readonly members: ReadonlyArray<
    Pick<EnvironmentProject, "title" | "hasCustomTitle" | "repositoryIdentity">
  >;
}): string {
  const sharedTitles = uniqueNonEmptyValues(input.members.map((member) => member.title));
  const sharedDisplayNames = uniqueNonEmptyValues(
    input.members.map((member) =>
      member.repositoryIdentity ? repositoryGroupingDisplayNameOf(member.repositoryIdentity) : null,
    ),
  );
  const sharedRepositoryNames = uniqueNonEmptyValues(
    input.members.map((member) => member.repositoryIdentity?.name),
  );
  const sharedTitle = sharedTitles[0];
  if (
    sharedTitles.length === 1 &&
    sharedTitle !== undefined &&
    (input.members.some((member) => member.hasCustomTitle === true) ||
      (!sharedDisplayNames.includes(sharedTitle) && !sharedRepositoryNames.includes(sharedTitle)))
  ) {
    return sharedTitle;
  }
  if (sharedDisplayNames.length === 1) {
    return sharedDisplayNames[0]!;
  }

  if (sharedRepositoryNames.length === 1) {
    return sharedRepositoryNames[0]!;
  }

  // A whole-repository group is named for the repository, not one member's folder:
  // clones can disagree on its casing. A subfolder group keeps its own title.
  const representativeIdentity = input.representative.repositoryIdentity;
  if (
    representativeIdentity &&
    input.groupKey === repositoryGroupingKeyOf(representativeIdentity)
  ) {
    return (
      repositoryGroupingDisplayNameOf(representativeIdentity) ??
      representativeIdentity.name ??
      input.representative.title
    );
  }
  return input.representative.title;
}

export interface ProjectGroupMember<TProject extends EnvironmentProject = EnvironmentProject> {
  readonly physicalProjectKey: string;
  readonly project: TProject;
}

export interface ProjectGroup<TProject extends EnvironmentProject = EnvironmentProject> {
  readonly key: string;
  readonly label: string;
  readonly representative: TProject;
  readonly members: ReadonlyArray<ProjectGroupMember<TProject>>;
  readonly memberProjectRefs: ReadonlyArray<ScopedProjectRef>;
  /** Clients write every member together. When members still disagree, the project stays visible. */
  readonly pinned: boolean;
  readonly archived: boolean;
}

/** The groups a project picker offers: archived groups left out, pinned ones first. */
export function pickableProjectGroups<
  TGroup extends { readonly pinned: boolean; readonly archived: boolean },
>(groups: ReadonlyArray<TGroup>): TGroup[] {
  const open = groups.filter((group) => !group.archived);
  return [...open.filter((group) => group.pinned), ...open.filter((group) => !group.pinned)];
}

function projectFreshnessTime(project: EnvironmentProject): number {
  const updatedAtTime = Date.parse(project.updatedAt);
  if (Number.isFinite(updatedAtTime)) {
    return updatedAtTime;
  }
  const createdAtTime = Date.parse(project.createdAt);
  return Number.isFinite(createdAtTime) ? createdAtTime : 0;
}

function shouldReplacePhysicalProjectWinner<TProject extends EnvironmentProject>(
  existing: TProject,
  candidate: TProject,
): boolean {
  const freshnessDelta = projectFreshnessTime(candidate) - projectFreshnessTime(existing);
  return freshnessDelta > 0 || (freshnessDelta === 0 && candidate.id > existing.id);
}

function selectProjectIdentitySource<TProject extends EnvironmentProject>(
  projects: ReadonlyArray<TProject>,
  winner: TProject,
): TProject {
  if (winner.repositoryIdentity !== null) {
    return winner;
  }

  let freshestIdentifiedProject: TProject | null = null;
  for (const project of projects) {
    if (project.repositoryIdentity === null) {
      continue;
    }
    if (
      freshestIdentifiedProject === null ||
      shouldReplacePhysicalProjectWinner(freshestIdentifiedProject, project)
    ) {
      freshestIdentifiedProject = project;
    }
  }
  return freshestIdentifiedProject ?? winner;
}

export function buildProjectGroups<TProject extends EnvironmentProject>(input: {
  readonly projects: ReadonlyArray<TProject>;
  readonly settings: ProjectGroupingSettings;
  readonly preferredEnvironmentId?: EnvironmentId | null;
  readonly groupScratchProjects?: boolean;
}): ReadonlyArray<ProjectGroup<TProject>> {
  const projectsByPhysicalKey = new Map<string, TProject[]>();
  for (const project of input.projects) {
    const physicalProjectKey = derivePhysicalProjectKey(project);
    const existing = projectsByPhysicalKey.get(physicalProjectKey);
    if (existing) {
      existing.push(project);
    } else {
      projectsByPhysicalKey.set(physicalProjectKey, [project]);
    }
  }

  const logicalKeyByPhysicalKey = new Map<string, string>();
  const groupedMembers = new Map<string, ProjectGroupMember<TProject>[]>();
  for (const [physicalProjectKey, physicalProjects] of projectsByPhysicalKey) {
    const winner = physicalProjects.reduce((current, candidate) =>
      shouldReplacePhysicalProjectWinner(current, candidate) ? candidate : current,
    );
    const identitySource = selectProjectIdentitySource(physicalProjects, winner);
    const logicalKey =
      linkedLogicalProjectKey(winner, input.settings) ??
      deriveLogicalProjectKey(
        { ...identitySource, groupKey: winner.groupKey ?? identitySource.groupKey },
        {
          groupingMode: resolveProjectGroupingMode(winner, input.settings),
          groupScratchProjects: input.groupScratchProjects ?? false,
        },
      );
    logicalKeyByPhysicalKey.set(physicalProjectKey, logicalKey);
    const member = { physicalProjectKey, project: winner };
    const existing = groupedMembers.get(logicalKey);
    if (existing) {
      existing.push(member);
    } else {
      groupedMembers.set(logicalKey, [member]);
    }
  }

  const projectRefsByLogicalKey = new Map<string, ScopedProjectRef[]>();
  const seenProjectRefs = new Set<string>();
  for (const project of input.projects) {
    const physicalProjectKey = derivePhysicalProjectKey(project);
    const logicalKey =
      logicalKeyByPhysicalKey.get(physicalProjectKey) ??
      deriveLogicalProjectKeyFromSettings(project, input.settings, {
        groupScratchProjects: input.groupScratchProjects ?? false,
      });
    const projectRefKey = scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
    if (seenProjectRefs.has(projectRefKey)) continue;
    seenProjectRefs.add(projectRefKey);
    const projectRef = scopeProjectRef(project.environmentId, project.id);
    const existing = projectRefsByLogicalKey.get(logicalKey);
    if (existing) {
      existing.push(projectRef);
    } else {
      projectRefsByLogicalKey.set(logicalKey, [projectRef]);
    }
  }

  const preferredEnvironmentId = input.preferredEnvironmentId ?? null;
  return Array.from(groupedMembers, ([key, members]) => {
    const representative =
      (preferredEnvironmentId
        ? members.find((member) => member.project.environmentId === preferredEnvironmentId)?.project
        : null) ?? members[0]!.project;
    return {
      key,
      label:
        input.groupScratchProjects && representative.isScratch
          ? "No project"
          : members.length > 1
            ? deriveProjectGroupLabel({
                groupKey: key,
                representative,
                members: members.map((member) => member.project),
              })
            : representative.title,
      representative,
      members,
      memberProjectRefs: projectRefsByLogicalKey.get(key) ?? [],
      pinned: members.some((member) => member.project.pinnedAt != null),
      archived: members.every((member) => member.project.archivedAt != null),
    };
  });
}

export function sortProjectsByGroupOrder<
  TProject extends { readonly id: string; readonly environmentId: string },
>(
  projects: ReadonlyArray<TProject>,
  groups: ReadonlyArray<{
    readonly memberProjectRefs: ReadonlyArray<ScopedProjectRef>;
    readonly pinned: boolean;
    readonly archived: boolean;
  }>,
): TProject[] {
  const rankByProject = new Map<string, number>();
  pickableProjectGroups(groups).forEach((group, rank) => {
    for (const ref of group.memberProjectRefs) {
      const key = `${ref.environmentId}\0${ref.projectId}`;
      if (!rankByProject.has(key)) rankByProject.set(key, rank);
    }
  });
  const rankOf = (project: TProject) =>
    rankByProject.get(`${project.environmentId}\0${project.id}`) ?? groups.length;
  return [...projects].sort((left, right) => rankOf(left) - rankOf(right));
}

export function legacyProjectCwdPreferenceKey(cwd: string): string {
  return `legacy-project-cwd:${normalizeProjectPathForComparison(cwd)}`;
}

export function orderItemsByPreferredIds<TItem, TId>(input: {
  items: readonly TItem[];
  preferredIds: readonly TId[];
  getId: (item: TItem) => TId;
  getPreferenceIds?: (item: TItem) => readonly TId[];
}): TItem[] {
  const { getId, getPreferenceIds, items, preferredIds } = input;
  if (preferredIds.length === 0) {
    return [...items];
  }

  const indexesByPreferenceId = new Map<TId, number[]>();
  for (const [index, item] of items.entries()) {
    const preferenceIds = getPreferenceIds?.(item) ?? [getId(item)];
    for (const preferenceId of new Set(preferenceIds)) {
      const indexes = indexesByPreferenceId.get(preferenceId);
      if (indexes) {
        indexes.push(index);
      } else {
        indexesByPreferenceId.set(preferenceId, [index]);
      }
    }
  }

  const emittedIndexes = new Set<number>();
  const ordered = preferredIds.flatMap((id) => {
    const index = indexesByPreferenceId
      .get(id)
      ?.find((candidate) => !emittedIndexes.has(candidate));
    if (index === undefined) {
      return [];
    }
    emittedIndexes.add(index);
    return [items[index]!];
  });
  const remaining = items.filter((_, index) => !emittedIndexes.has(index));
  return [...ordered, ...remaining];
}

export type RailGroup = DesktopProjectLayout["groups"][number];

export type RailEntry =
  | { readonly kind: "project"; readonly key: string }
  | { readonly kind: "group"; readonly group: RailGroup; readonly members: ReadonlyArray<string> };

const RAIL_GROUP_SCOPE_PREFIX = "rail-group:";

export function railGroupScopeKey(groupId: string): string {
  return `${RAIL_GROUP_SCOPE_PREFIX}${groupId}`;
}

export function railGroupIdFromScopeKey(key: string | null): string | null {
  return key?.startsWith(RAIL_GROUP_SCOPE_PREFIX)
    ? key.slice(RAIL_GROUP_SCOPE_PREFIX.length)
    : null;
}

export function railGroupName(group: Pick<RailGroup, "name">): string {
  return group.name.trim() || "Unnamed group";
}

/**
 * Lays the rail out from the manual project order. A group sits where its
 * first member does, and members a project list no longer has stay stored but
 * are not shown, so a disconnected environment does not empty a group.
 */
export function buildRailLayout(
  projectKeys: ReadonlyArray<string>,
  groups: ReadonlyArray<RailGroup>,
  settledProjectKeys: ReadonlySet<string> = new Set(),
): RailEntry[] {
  const known = new Set(projectKeys.filter((key) => !settledProjectKeys.has(key)));
  const owner = new Map<string, RailGroup>();
  for (const group of groups) {
    for (const member of group.members) if (!owner.has(member)) owner.set(member, group);
  }
  const emitted = new Set<string>();
  const entries: RailEntry[] = [];
  for (const key of projectKeys) {
    if (!known.has(key)) continue;
    const group = owner.get(key);
    if (!group) {
      entries.push({ kind: "project", key });
      continue;
    }
    if (emitted.has(group.id)) continue;
    emitted.add(group.id);
    entries.push({
      kind: "group",
      group,
      members: group.members.filter((member) => known.has(member) && owner.get(member) === group),
    });
  }
  return entries;
}
