import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom } from "effect/reactivity";
import {
  EnvironmentSupervisor,
  PrimaryConnectionTarget,
  AVAILABLE_CONNECTION_STATE,
  type PreparedConnection,
} from "@t3tools/client-runtime/connection";
import type { RpcSession } from "@t3tools/client-runtime/rpc";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  EnvironmentAuthorizationError,
  AuthOrchestrationReadScope,
  WS_METHODS,
  ProjectId,
} from "@t3tools/contracts";
import { resetAppAtomRegistryForTests } from "../rpc/atomRegistry";
const state = vi.hoisted(() => ({
  call: vi.fn(),
  atom: null as Atom.Writable<EnvironmentShellState> | null,
}));
vi.mock("@t3tools/client-runtime/rpc", () => ({
  request: (...args: unknown[]) => state.call(...args),
}));
vi.mock("../state/shell", () => ({ environmentShell: { stateValueAtom: () => state.atom! } }));
import { readPeerEnvironment } from "./peerEnvironment";
const env = EnvironmentId.make("lab");
const now = "2026-10-31T12:00:00.000Z";
const config = {
  environment: {
    environmentId: env,
    label: "Build Mac",
    serverVersion: "0.1.2",
    platform: { os: "darwin", arch: "arm64" },
    capabilities: { repositoryIdentity: true },
  },
  cwd: "/srv",
  settings: DEFAULT_SERVER_SETTINGS,
  providers: [],
};
const layerSupervisor = Layer.effect(
  EnvironmentSupervisor.EnvironmentSupervisor,
  Effect.gen(function* () {
    return EnvironmentSupervisor.EnvironmentSupervisor.of({
      target: new PrimaryConnectionTarget({
        environmentId: env,
        label: "Build Mac",
        httpBaseUrl: "http://localhost:3773",
        wsBaseUrl: "ws://localhost:3773",
      }),
      state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
      session: yield* SubscriptionRef.make<Option.Option<RpcSession>>(Option.none()),
      prepared: yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(Option.none()),
      connect: Effect.void,
      disconnect: Effect.void,
      retryNow: Effect.void,
    });
  }),
);
function setup() {
  resetAppAtomRegistryForTests();
  state.call.mockReset().mockReturnValue(Effect.succeed(config));
  state.atom = Atom.make<EnvironmentShellState>({
    status: "live",
    error: Option.none(),
    generation: 1,
    removedAt: new Map(),
    snapshot: Option.some({
      schemaVersion: 2,
      snapshotSequence: 1,
      threads: [],
      archivedThreads: [],
      projects: [
        {
          id: ProjectId.make("api"),
          title: "API",
          workspaceRoot: "/srv/api",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      ],
    }),
  });
}
describe("app-connected environment metadata", () => {
  it.effect(
    "reads a legacy destination config and synchronized project roots without new remote RPCs",
    () =>
      Effect.gen(function* () {
        setup();
        const result = yield* readPeerEnvironment({ environmentId: env });
        expect(result).toMatchObject({
          environment: { environmentId: env, serverVersion: "0.1.2" },
          projects: [{ workspaceRoot: "/srv/api", workspaceRoots: [{ path: "/srv/api" }] }],
          paths: { serverCwd: "/srv" },
        });
        expect(state.call).toHaveBeenCalledExactlyOnceWith(WS_METHODS.serverGetConfig, {});
      }).pipe(Effect.provide(layerSupervisor)),
  );
  it.effect(
    "can read models before the project shell synchronizes, when projects are excluded",
    () =>
      Effect.gen(function* () {
        setup();
        state.atom = null;
        expect(
          (yield* readPeerEnvironment({ environmentId: env, includeProjects: false })).projects,
        ).toEqual([]);
      }).pipe(Effect.provide(layerSupervisor)),
  );
  it.effect(
    "rejects a misrouted server identity and propagates the destination's read denial",
    () =>
      Effect.gen(function* () {
        setup();
        state.call.mockReturnValueOnce(
          Effect.succeed({
            ...config,
            environment: { ...config.environment, environmentId: EnvironmentId.make("other") },
          }),
        );
        expect((yield* readPeerEnvironment({ environmentId: env }).pipe(Effect.flip))._tag).toBe(
          "OrchestratorMcpFailure",
        );
        state.call.mockReturnValueOnce(
          Effect.fail(
            new EnvironmentAuthorizationError({
              message: "Read access denied",
              requiredScope: AuthOrchestrationReadScope,
            }),
          ),
        );
        expect(yield* readPeerEnvironment({ environmentId: env }).pipe(Effect.flip)).toMatchObject({
          _tag: "OrchestratorMcpFailure",
          code: "capability_denied",
        });
      }).pipe(Effect.provide(layerSupervisor)),
  );
});
