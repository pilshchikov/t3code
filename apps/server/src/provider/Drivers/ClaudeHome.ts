import * as NodeOS from "node:os";

import type { ClaudeSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { expandHomePath } from "../../pathExpansion.ts";

type ClaudeEnvironmentConfig = Pick<ClaudeSettings, "configDir" | "homePath">;

export const resolveClaudeHomePath = Effect.fn("resolveClaudeHomePath")(function* (
  config: ClaudeEnvironmentConfig,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  const homePath = config.homePath.trim();
  return path.resolve(homePath.length > 0 ? expandHomePath(homePath) : NodeOS.homedir());
});

export const resolveClaudeConfigDir = Effect.fn("resolveClaudeConfigDir")(function* (
  config: ClaudeEnvironmentConfig,
): Effect.fn.Return<string | undefined, never, Path.Path> {
  const configDir = config.configDir.trim();
  if (configDir.length === 0) return undefined;
  const path = yield* Path.Path;
  return path.resolve(expandHomePath(configDir));
});

export const makeClaudeEnvironment = Effect.fn("makeClaudeEnvironment")(function* (
  config: ClaudeEnvironmentConfig,
  baseEnv?: NodeJS.ProcessEnv,
): Effect.fn.Return<NodeJS.ProcessEnv, never, Path.Path> {
  const resolvedBaseEnv = baseEnv ?? process.env;
  const homePath = config.homePath.trim();
  const configDir = config.configDir.trim();
  if (homePath.length === 0 && configDir.length === 0) return resolvedBaseEnv;
  return {
    ...resolvedBaseEnv,
    ...(homePath.length > 0 ? { HOME: yield* resolveClaudeHomePath(config) } : {}),
    ...(configDir.length > 0 ? { CLAUDE_CONFIG_DIR: yield* resolveClaudeConfigDir(config) } : {}),
  };
});

export const makeClaudeContinuationGroupKey = Effect.fn("makeClaudeContinuationGroupKey")(
  function* (config: ClaudeEnvironmentConfig): Effect.fn.Return<string, never, Path.Path> {
    const resolvedHomePath = yield* resolveClaudeHomePath(config);
    const resolvedConfigDir = yield* resolveClaudeConfigDir(config);
    if (resolvedConfigDir) {
      return `claude:config:${resolvedConfigDir}:home:${resolvedHomePath}`;
    }
    return `claude:home:${resolvedHomePath}`;
  },
);

export const makeClaudeCapabilitiesCacheKey = Effect.fn("makeClaudeCapabilitiesCacheKey")(
  function* (
    config: Pick<ClaudeSettings, "binaryPath" | "configDir" | "homePath">,
  ): Effect.fn.Return<string, never, Path.Path> {
    const resolvedHomePath = yield* resolveClaudeHomePath(config);
    const resolvedConfigDir = yield* resolveClaudeConfigDir(config);
    return resolvedConfigDir
      ? `${config.binaryPath}\0${resolvedHomePath}\0${resolvedConfigDir}`
      : `${config.binaryPath}\0${resolvedHomePath}`;
  },
);
