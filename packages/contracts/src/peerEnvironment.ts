import * as Schema from "effect/Schema";
import { EnvironmentId, IsoDateTime, NonNegativeInt, ProjectId } from "./baseSchemas.ts";
import { ExecutionEnvironmentDescriptor, ThreadEnvMode } from "./environment.ts";
import { ModelSelection } from "./modelSelection.ts";
import { ModelCapabilities } from "./model.ts";
import { ProviderInstanceId, ProviderDriverKind } from "./providerInstance.ts";
import { RuntimeMode } from "./providerPolicy.ts";
import { ServerProviderAuthStatus, ServerProviderState } from "./server.ts";

export const PeerEnvironmentReadInput = Schema.Struct({
  environmentId: EnvironmentId,
  projectId: Schema.optional(ProjectId),
  providerInstanceId: Schema.optional(ProviderInstanceId),
  modelSearch: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  projectCursor: Schema.optional(NonNegativeInt),
  modelCursor: Schema.optional(NonNegativeInt),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  includeProjects: Schema.optional(Schema.Boolean),
  includeModels: Schema.optional(Schema.Boolean),
});
export type PeerEnvironmentReadInput = typeof PeerEnvironmentReadInput.Type;
export const PeerWorkspace = Schema.Struct({
  path: Schema.String,
  label: Schema.optional(Schema.String),
  defaultThreadEnvMode: Schema.optional(Schema.NullOr(ThreadEnvMode)),
});
export const PeerEnvironmentSnapshot = Schema.Struct({
  environment: ExecutionEnvironmentDescriptor,
  observedAt: IsoDateTime,
  paths: Schema.Struct({
    serverCwd: Schema.String,
    newProjectsRoot: Schema.NullOr(Schema.String),
    scratchWorkspaceRoot: Schema.NullOr(Schema.String),
    worktreesDirectory: Schema.NullOr(Schema.String),
  }),
  defaults: Schema.Struct({
    defaultModelSelection: Schema.NullOr(ModelSelection),
    fallbackModelSelection: Schema.NullOr(ModelSelection),
    defaultRuntimeMode: RuntimeMode,
    defaultThreadEnvMode: Schema.NullOr(ThreadEnvMode),
    newWorktreesStartFromOrigin: Schema.Boolean,
    linkedEnvironmentsEnabled: Schema.Boolean,
  }),
  projects: Schema.Array(
    Schema.Struct({
      projectId: ProjectId,
      title: Schema.String,
      workspaceRoot: Schema.String,
      workspaceRoots: Schema.Array(PeerWorkspace),
      defaultModelSelection: Schema.NullOr(ModelSelection),
      defaultRuntimeMode: RuntimeMode,
      defaultThreadEnvMode: Schema.NullOr(ThreadEnvMode),
      enabledProviderInstanceIds: Schema.Array(ProviderInstanceId),
      archived: Schema.Boolean,
    }),
  ),
  nextProjectCursor: Schema.NullOr(NonNegativeInt),
  providers: Schema.Array(
    Schema.Struct({
      instanceId: ProviderInstanceId,
      driver: ProviderDriverKind,
      displayName: Schema.String,
      enabled: Schema.Boolean,
      enabledForProject: Schema.Boolean,
      installed: Schema.Boolean,
      available: Schema.Boolean,
      status: ServerProviderState,
      authStatus: ServerProviderAuthStatus,
      version: Schema.NullOr(Schema.String),
      checkedAt: IsoDateTime,
      runtimeModes: Schema.Array(RuntimeMode),
      models: Schema.Array(
        Schema.Struct({
          slug: Schema.String,
          name: Schema.String,
          isCustom: Schema.Boolean,
          isDefault: Schema.Boolean,
          capabilities: Schema.NullOr(ModelCapabilities),
        }),
      ),
      nextModelCursor: Schema.NullOr(NonNegativeInt),
    }),
  ),
});
export type PeerEnvironmentSnapshot = typeof PeerEnvironmentSnapshot.Type;
