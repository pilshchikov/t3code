import { fetchRemoteEnvironmentDescriptor } from "@t3tools/client-runtime/environment";
import type { BundledServerRuntime, DesktopBundledServerUpdateInput } from "@t3tools/contracts";
import type {
  DesktopDiscoveredSshHost,
  DesktopSshEnvironmentBootstrap,
  DesktopSshEnvironmentTarget,
} from "@t3tools/contracts";
import { CLI_RELEASE_BASE_URL_ENV } from "@t3tools/shared/cliRelease";
import * as NetService from "@t3tools/shared/Net";
import * as SshAuth from "@t3tools/ssh/auth";
import { resolveSshTarget } from "@t3tools/ssh/command";
import { discoverSshHosts } from "@t3tools/ssh/config";
import {
  SshCommandError,
  SshHostDiscoveryError,
  SshInvalidTargetError,
  SshLaunchError,
  SshPairingError,
  SshPasswordPromptError,
  SshReadinessError,
} from "@t3tools/ssh/errors";
import * as SshTunnel from "@t3tools/ssh/tunnel";
import * as Context from "effect/Context";
import type * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Option from "effect/Option";
import serverPackageJson from "../../../server/package.json" with { type: "json" };

import type * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

import * as DesktopSshPasswordPrompts from "./DesktopSshPasswordPrompts.ts";

export type DesktopSshEnvironmentRuntimeServices =
  | ChildProcessSpawner.ChildProcessSpawner
  | Digest.Digest
  | FileSystem.FileSystem
  | Path.Path
  | HttpClient.HttpClient
  | NetService.NetService;

export type DesktopSshEnvironmentOperationError =
  | SshCommandError
  | SshInvalidTargetError
  | SshLaunchError
  | SshPairingError
  | SshReadinessError
  | SshPasswordPromptError
  | NetService.NetError;

export type DesktopSshEnvironmentDiscoverError = SshHostDiscoveryError;

export class DesktopSshEnvironment extends Context.Service<
  DesktopSshEnvironment,
  {
    readonly getBundledRuntime: Effect.Effect<BundledServerRuntime | null>;
    readonly updateBundledRuntime: (
      input: DesktopBundledServerUpdateInput,
    ) => Effect.Effect<BundledServerRuntime, DesktopSshEnvironmentOperationError>;
    readonly discoverHosts: (input?: {
      readonly homeDir?: string;
    }) => Effect.Effect<readonly DesktopDiscoveredSshHost[], DesktopSshEnvironmentDiscoverError>;
    readonly resolveHost: (
      alias: string,
    ) => Effect.Effect<DesktopSshEnvironmentTarget, SshCommandError | SshInvalidTargetError>;
    readonly ensureEnvironment: (
      target: DesktopSshEnvironmentTarget,
      options?: { readonly issuePairingToken?: boolean },
    ) => Effect.Effect<DesktopSshEnvironmentBootstrap, DesktopSshEnvironmentOperationError>;
    readonly disconnectEnvironment: (
      target: DesktopSshEnvironmentTarget,
    ) => Effect.Effect<void, DesktopSshEnvironmentOperationError>;
    readonly closeAllTunnels: Effect.Effect<void>;
  }
>()("@t3tools/desktop/ssh/DesktopSshEnvironment") {}

export interface DesktopSshEnvironmentLayerOptions {
  readonly resolveBundledRuntime?: Effect.Effect<SshTunnel.BundledSshRuntimeAsset | null>;
  readonly resolveCliRunner?: Effect.Effect<SshTunnel.RemoteT3RunnerOptions>;
  readonly resolveLauncherId?: Effect.Effect<string | null>;
}

export const resolveDesktopSshCliRunner = (
  environment: DesktopEnvironment.DesktopEnvironment["Service"],
  env: NodeJS.ProcessEnv,
): SshTunnel.RemoteT3RunnerOptions => {
  const devRemoteEntryPath = Option.getOrUndefined(environment.devRemoteT3ServerEntryPath);
  if (environment.isDevelopment && devRemoteEntryPath !== undefined) {
    return {
      nodeScriptPath: devRemoteEntryPath,
      nodeEngineRange: serverPackageJson.engines.node,
    };
  }
  const releaseBaseUrl = env[CLI_RELEASE_BASE_URL_ENV]?.trim() || undefined;
  return {
    archiveVersion: environment.appVersion,
    ...(releaseBaseUrl === undefined ? {} : { releaseBaseUrl }),
  };
};

// Remote servers record this ID as their owner, so it has to outlive restarts,
// updates and edits to a saved connection. Without a stored one there is none.
export const readOrCreateLauncherId = Effect.fn("desktop.ssh.readOrCreateLauncherId")(
  function* (filePath: string) {
    const fileSystem = yield* FileSystem.FileSystem;
    const random = yield* SecureRandom.SecureRandom;
    // Any other read failure may hide a stored ID, which a new one would overwrite.
    const stored = yield* fileSystem.readFileString(filePath).pipe(
      Effect.catchIf(
        (cause) => cause.reason._tag === "NotFound",
        () => Effect.succeed(""),
      ),
    );
    if (/^[0-9a-f]{32}$/u.test(stored.trim())) return stored.trim();
    const launcherId = (yield* random.uuidV4()).replace(/-/g, "");
    yield* fileSystem.writeFileString(filePath, `${launcherId}\n`);
    return launcherId;
  },
  Effect.orElseSucceed(() => null),
);

function discoverDesktopSshHostsEffect(input?: { readonly homeDir?: string }) {
  return discoverSshHosts(input ?? {});
}

const isSshPasswordPromptError = Schema.is(SshPasswordPromptError);

export function isDesktopSshPasswordPromptCancellation(
  error: unknown,
): error is SshPasswordPromptError {
  return (
    isSshPasswordPromptError(error) &&
    DesktopSshPasswordPrompts.isDesktopSshPasswordPromptCancellation(error.cause)
  );
}

function unexpectedPasswordPromptError(error: never): never {
  throw new Error(`Unhandled desktop SSH password prompt error: ${String(error)}`);
}

function toSshPasswordPromptError(
  cause: DesktopSshPasswordPrompts.DesktopSshPasswordPromptRequestError,
): SshPasswordPromptError {
  let message: string;
  switch (cause._tag) {
    case "DesktopSshPromptRequestIdGenerationError":
      message = "Secure randomness is unavailable.";
      break;
    case "DesktopSshPromptWindowUnavailableError":
    case "DesktopSshPromptPresentationError":
      message = "T3 Code window is not available for SSH authentication.";
      break;
    case "DesktopSshPromptTimedOutError":
      message = `SSH authentication timed out for ${cause.destination}.`;
      break;
    case "DesktopSshPromptCancelledError":
      message = `SSH authentication cancelled for ${cause.destination}.`;
      break;
    case "DesktopSshPromptWindowClosedError":
      message = "SSH authentication was cancelled because the app window closed.";
      break;
    case "DesktopSshPromptServiceStoppedError":
      message = "SSH password prompt service stopped.";
      break;
    default:
      return unexpectedPasswordPromptError(cause);
  }
  return new SshPasswordPromptError({ message, cause });
}

const makePasswordPrompt = (
  prompts: DesktopSshPasswordPrompts.DesktopSshPasswordPrompts["Service"],
): SshAuth.SshPasswordPrompt["Service"] => ({
  isAvailable: true,
  request: (request: SshAuth.SshPasswordRequest) =>
    prompts.request(request).pipe(Effect.mapError(toSshPasswordPromptError)),
});

/** @public */
export const make = Effect.fn("desktop.ssh.make")(function* (
  options: DesktopSshEnvironmentLayerOptions = {},
) {
  const manager = yield* SshTunnel.SshEnvironmentManager;
  const prompts = yield* DesktopSshPasswordPrompts.DesktopSshPasswordPrompts;
  const runtimeContext = yield* Effect.context<DesktopSshEnvironmentRuntimeServices>();
  const passwordPrompt = SshAuth.SshPasswordPrompt.of(makePasswordPrompt(prompts));

  const getBundledRuntime = (options.resolveBundledRuntime ?? Effect.succeed(null)).pipe(
    Effect.map((asset) => asset?.metadata ?? null),
    Effect.orDie,
  );
  return DesktopSshEnvironment.of({
    getBundledRuntime,
    updateBundledRuntime: Effect.fn("desktop.ssh.updateBundledRuntime")(function* (input) {
      const metadata = yield* manager
        .updateBundledRuntime(input.target, input.environmentId, input.buildId)
        .pipe(
          Effect.provideService(SshAuth.SshPasswordPrompt, passwordPrompt),
          Effect.provide(runtimeContext),
        );
      const bootstrap = yield* manager
        .ensureEnvironment(input.target)
        .pipe(
          Effect.provideService(SshAuth.SshPasswordPrompt, passwordPrompt),
          Effect.provide(runtimeContext),
        );
      const descriptor = yield* fetchRemoteEnvironmentDescriptor({
        httpBaseUrl: bootstrap.httpBaseUrl,
      }).pipe(
        Effect.provide(runtimeContext),
        Effect.mapError(
          (cause) =>
            new SshLaunchError({
              stdout: "",
              message: "Could not verify the updated server.",
              cause,
            }),
        ),
      );
      if (
        descriptor.environmentId !== input.environmentId ||
        descriptor.serverBuildId !== metadata.buildId ||
        descriptor.serverVersion !== metadata.version
      ) {
        return yield* new SshLaunchError({
          stdout: "",
          message: "The remote server did not report the installed fork build.",
        });
      }
      return metadata;
    }),
    discoverHosts: Effect.fn("desktop.ssh.discoverHosts")((input) =>
      discoverDesktopSshHostsEffect(input).pipe(Effect.provide(runtimeContext)),
    ),
    resolveHost: Effect.fn("desktop.ssh.resolveHost")((alias) =>
      resolveSshTarget(alias.trim()).pipe(Effect.provide(runtimeContext)),
    ),
    ensureEnvironment: Effect.fn("desktop.ssh.ensureEnvironment")((target, ensureOptions) =>
      manager
        .ensureEnvironment(target, ensureOptions)
        .pipe(
          Effect.provideService(SshAuth.SshPasswordPrompt, passwordPrompt),
          Effect.provide(runtimeContext),
        ),
    ),
    disconnectEnvironment: Effect.fn("desktop.ssh.disconnectEnvironment")((target) =>
      manager
        .disconnectEnvironment(target)
        .pipe(
          Effect.provideService(SshAuth.SshPasswordPrompt, passwordPrompt),
          Effect.provide(runtimeContext),
        ),
    ),
    closeAllTunnels: manager.closeAllTunnels,
  });
});

export const layer = (options: DesktopSshEnvironmentLayerOptions = {}) =>
  Layer.effect(DesktopSshEnvironment, make(options)).pipe(
    Layer.provide(SshTunnel.SshEnvironmentManager.layer(options)),
  );
