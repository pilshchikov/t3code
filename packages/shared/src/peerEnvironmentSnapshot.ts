import {
  isProviderAvailable,
  type OrchestrationProjectShell,
  type PeerEnvironmentReadInput,
  type PeerEnvironmentSnapshot,
  type ServerConfig,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "./projectSettings.ts";

type Source = Pick<
  ServerConfig,
  "environment" | "cwd" | "newProjectsRoot" | "scratchWorkspaceRoot" | "settings" | "providers"
>;

/** A deliberate allowlist: provider settings, credentials and per-directory guidance stay out. */
export function peerEnvironmentSnapshot(
  source: Source,
  projects: ReadonlyArray<OrchestrationProjectShell>,
  input: PeerEnvironmentReadInput,
  observedAt: string,
): PeerEnvironmentSnapshot {
  const { settings } = source;
  const limit = input.limit ?? 25;
  const selected =
    input.includeProjects === false
      ? []
      : projects.filter(
          (project) => input.projectId === undefined || project.id === input.projectId,
        );
  const cursor = input.projectCursor ?? 0;
  const projectEnabled = (
    instanceId: ServerConfig["providers"][number]["instanceId"],
    projectId: OrchestrationProjectShell["id"] | undefined,
    enabled: boolean,
  ) =>
    projectId === undefined
      ? enabled
      : (settings.projectSettingsOverrides[projectId]?.providerInstances?.[instanceId]?.enabled ??
        enabled);
  return {
    environment: source.environment,
    observedAt,
    paths: {
      serverCwd: source.cwd,
      newProjectsRoot: source.newProjectsRoot ?? null,
      scratchWorkspaceRoot: source.scratchWorkspaceRoot ?? null,
      worktreesDirectory: settings.worktreesDirectory || null,
    },
    defaults: {
      defaultModelSelection: settings.defaultModelSelection,
      fallbackModelSelection: settings.fallbackModelSelection,
      defaultRuntimeMode: settings.defaultRuntimeMode,
      defaultThreadEnvMode: settings.defaultThreadEnvMode,
      newWorktreesStartFromOrigin: settings.newWorktreesStartFromOrigin,
      linkedEnvironmentsEnabled: settings.linkedEnvironmentsEnabled,
    },
    projects: selected.slice(cursor, cursor + limit).map((project) => {
      const effective = resolveProjectSettings(settings, project.id, project).settings;
      return {
        projectId: project.id,
        title: project.title,
        workspaceRoot: project.workspaceRoot,
        workspaceRoots: (project.workspaceRoots?.length
          ? project.workspaceRoots
          : [{ path: project.workspaceRoot }]
        ).map(({ path, label, defaultThreadEnvMode }) => ({
          path,
          ...(label === undefined ? {} : { label }),
          ...(defaultThreadEnvMode === undefined ? {} : { defaultThreadEnvMode }),
        })),
        defaultModelSelection: effective.defaultModelSelection,
        defaultRuntimeMode: effective.defaultRuntimeMode,
        defaultThreadEnvMode: effective.defaultThreadEnvMode,
        enabledProviderInstanceIds: source.providers
          .filter((provider) => projectEnabled(provider.instanceId, project.id, provider.enabled))
          .map((provider) => provider.instanceId),
        archived: project.archivedAt != null,
        groupKey: project.groupKey ?? null,
      };
    }),
    nextProjectCursor: cursor + limit < selected.length ? cursor + limit : null,
    providers: source.providers
      .filter(
        (provider) =>
          input.providerInstanceId === undefined ||
          provider.instanceId === input.providerInstanceId,
      )
      .map((provider) => {
        const preferences = settings.providerModelPreferences?.[provider.instanceId];
        const order = new Map(preferences?.modelOrder.map((slug, index) => [slug, index]));
        const terms = input.modelSearch?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? [];
        const models =
          input.includeModels === false
            ? []
            : provider.models
                .filter(
                  (model) =>
                    (model.isCustom || !preferences?.hiddenModels.includes(model.slug)) &&
                    terms.every((term) =>
                      `${provider.instanceId} ${provider.displayName ?? ""} ${provider.driver} ${model.slug} ${model.name}`
                        .toLowerCase()
                        .includes(term),
                    ),
                )
                .sort(
                  (a, b) => (order.get(a.slug) ?? order.size) - (order.get(b.slug) ?? order.size),
                );
        const start = input.modelCursor ?? 0;
        const enabledForProject = projectEnabled(
          provider.instanceId,
          input.projectId,
          provider.enabled,
        );
        return {
          instanceId: provider.instanceId,
          driver: provider.driver,
          displayName: provider.displayName ?? provider.instanceId,
          enabled: provider.enabled,
          enabledForProject,
          installed: provider.installed,
          available:
            enabledForProject &&
            provider.installed &&
            provider.status !== "error" &&
            isProviderAvailable(provider) &&
            provider.auth.status !== "unauthenticated",
          status: provider.status,
          authStatus: provider.auth.status,
          version: provider.version,
          checkedAt: provider.checkedAt,
          runtimeModes: provider.supportedRuntimeModes ?? [],
          models: models
            .slice(start, start + limit)
            .map(({ slug, name, isCustom, isDefault, capabilities }) => ({
              slug,
              name,
              isCustom,
              isDefault: isDefault ?? false,
              capabilities,
            })),
          nextModelCursor: start + limit < models.length ? start + limit : null,
        };
      }),
  };
}
