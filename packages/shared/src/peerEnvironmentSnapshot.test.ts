import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  type ServerProvider,
  type OrchestrationProjectShell,
} from "@t3tools/contracts";
import { peerEnvironmentSnapshot } from "./peerEnvironmentSnapshot.ts";

const now = "2026-10-31T12:00:00.000Z";
const env = EnvironmentId.make("lab");
const instanceId = ProviderInstanceId.make("codex-work");
const provider: ServerProvider = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  displayName: "Work",
  enabled: true,
  installed: true,
  status: "ready",
  version: "1.0",
  auth: { status: "authenticated", email: "private@example.invalid" },
  checkedAt: now,
  runtimePaths: { homePath: "/private/account", shadowHomePath: null },
  slashCommands: [],
  skills: [],
  models: ["alpha", "beta", "gamma"].map((slug) => ({
    slug,
    name: slug.toUpperCase(),
    isCustom: false,
    capabilities:
      slug === "beta"
        ? {
            optionDescriptors: [
              {
                id: "effort",
                label: "Effort",
                type: "select" as const,
                options: [{ id: "high", label: "High" }],
                currentValue: "high",
              },
            ],
          }
        : null,
  })),
};
const project: OrchestrationProjectShell = {
  id: ProjectId.make("api"),
  title: "API",
  workspaceRoot: "/lab/api",
  workspaceRoots: [
    { path: "/lab/api" },
    { path: "/lab/shared", label: "Shared", agentGuidance: "private guidance" },
  ],
  defaultModelSelection: { instanceId, model: "beta" },
  scripts: [],
  createdAt: now,
  updatedAt: now,
};
const source = {
  environment: {
    environmentId: env,
    label: "Lab",
    platform: { os: "darwin" as const, arch: "arm64" as const },
    serverVersion: "0.1.2",
    capabilities: { repositoryIdentity: true },
  },
  cwd: "/lab",
  newProjectsRoot: "/lab/projects",
  scratchWorkspaceRoot: "/lab/scratch",
  providers: [provider],
  settings: {
    ...DEFAULT_SERVER_SETTINGS,
    providerModelPreferences: {
      [instanceId]: { hiddenModels: ["alpha"], modelOrder: ["gamma", "beta"] },
    },
    providerInstances: {
      [instanceId]: {
        driver: provider.driver,
        enabled: true,
        environment: [{ name: "TOKEN", value: "private-token", sensitive: true }],
        config: {},
      },
    },
  },
};
describe("peer environment discovery", () => {
  it("lists destination roots and configured models with independent pages, without account secrets", () => {
    const result = peerEnvironmentSnapshot(
      source,
      [project, { ...project, id: ProjectId.make("ui"), title: "UI", workspaceRoot: "/lab/ui" }],
      { environmentId: env, limit: 1 },
      now,
    );
    expect(result.environment).toEqual(source.environment);
    expect(result.paths).toMatchObject({
      serverCwd: "/lab",
      newProjectsRoot: "/lab/projects",
      scratchWorkspaceRoot: "/lab/scratch",
    });
    expect(result.projects).toMatchObject([
      {
        projectId: project.id,
        workspaceRoots: [{ path: "/lab/api" }, { path: "/lab/shared", label: "Shared" }],
        defaultModelSelection: { model: "beta" },
      },
    ]);
    expect(result.nextProjectCursor).toBe(1);
    expect(result.providers).toMatchObject([
      { instanceId, models: [{ slug: "gamma" }], nextModelCursor: 1, authStatus: "authenticated" },
    ]);
    const text = JSON.stringify(result);
    for (const secret of [
      "private-token",
      "private@example.invalid",
      "/private/account",
      "private guidance",
    ])
      expect(text).not.toContain(secret);
    expect(
      peerEnvironmentSnapshot(
        source,
        [project],
        { environmentId: env, modelCursor: 1, includeProjects: false, limit: 1 },
        now,
      ).providers[0]?.models[0]?.slug,
    ).toBe("beta");
  });
  it("filters the selected project and provider, uses saved project overrides, and bounds model search", () => {
    const result = peerEnvironmentSnapshot(
      {
        ...source,
        settings: {
          ...source.settings,
          projectSettingsOverrides: {
            [project.id]: {
              defaultRuntimeMode: "approval-required",
              providerInstances: { [instanceId]: { enabled: false } },
            },
          },
        },
      },
      [project],
      {
        environmentId: env,
        projectId: project.id,
        providerInstanceId: instanceId,
        modelSearch: "beta",
      },
      now,
    );
    expect(result.providers[0]?.models[0]?.capabilities?.optionDescriptors).toMatchObject([
      { id: "effort", options: [{ id: "high" }] },
    ]);
    expect(result.projects[0]).toMatchObject({
      defaultRuntimeMode: "approval-required",
      enabledProviderInstanceIds: [],
    });
    expect(result.providers[0]).toMatchObject({
      enabledForProject: false,
      available: false,
      models: [{ slug: "beta" }],
      nextModelCursor: null,
    });
    expect(
      peerEnvironmentSnapshot(
        source,
        [project],
        { environmentId: env, providerInstanceId: ProviderInstanceId.make("missing") },
        now,
      ).providers,
    ).toEqual([]);
  });
});
