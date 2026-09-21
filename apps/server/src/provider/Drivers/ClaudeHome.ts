import * as NodeOS from "node:os";

import type { ClaudeSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { expandHomePath } from "../../pathExpansion.ts";

type ClaudeEnvironmentConfig = Pick<ClaudeSettings, "configDir" | "homePath">;
const quotePath = Schema.encodeSync(Schema.fromJsonString(Schema.String));

/**
 * Resolve the Claude config directory the CLI would use: the instance's
 * `homePath` (exported as `CLAUDE_CONFIG_DIR`), then an inherited
 * `CLAUDE_CONFIG_DIR`, then Claude's default `~/.claude`. Empty must not
 * fall back to bare `$HOME` — that leftover from the old HOME override
 * produced a different continuation group than an explicit `~/.claude`.
 */
export const resolveClaudeHomePath = Effect.fn("resolveClaudeHomePath")(function* (
  config: ClaudeEnvironmentConfig,
  environment?: NodeJS.ProcessEnv,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  const homePath = config.homePath.trim();
  if (homePath.length > 0) {
    return path.resolve(expandHomePath(homePath));
  }
  // Inherited env vars are not shell-expanded, so a literal `~` stays literal.
  const inherited = environment?.CLAUDE_CONFIG_DIR?.trim() ?? "";
  if (inherited.length > 0) {
    return path.resolve(inherited);
  }
  return path.resolve(path.join(NodeOS.homedir(), ".claude"));
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
  function* (
    config: ClaudeEnvironmentConfig,
    environment?: NodeJS.ProcessEnv,
  ): Effect.fn.Return<string, never, Path.Path> {
    const resolvedHomePath = yield* resolveClaudeHomePath(config, environment);
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
    cwd?: string,
    environment?: NodeJS.ProcessEnv,
  ): Effect.fn.Return<string, never, Path.Path> {
    const resolvedHomePath = yield* resolveClaudeHomePath(config, environment);
    const resolvedConfigDir = yield* resolveClaudeConfigDir(config);
    return resolvedConfigDir
      ? `${config.binaryPath}\0${resolvedHomePath}\0${resolvedConfigDir}\0${cwd ?? ""}`
      : `${config.binaryPath}\0${resolvedHomePath}\0${cwd ?? ""}`;
  },
);

/**
 * Describe the spawned CLI's environment separately from the login command so
 * paths remain literal on every shell, including relative inherited values.
 */
export const claudeSignedOutMessage = (input: {
  readonly configDir: string | undefined;
  readonly cwd: string;
}): string => {
  const configuration =
    input.configDir !== undefined
      ? ` from ${quotePath(input.cwd)}, with CLAUDE_CONFIG_DIR set to ${quotePath(input.configDir)}`
      : "";
  return `Claude could not authenticate. For subscription login, run \`claude auth login\` on this environment's machine${configuration}, then start a new thread. For API-key authentication, check this instance's configured credentials.`;
};
