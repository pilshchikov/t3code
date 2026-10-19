import { request, subscribe } from "@t3tools/client-runtime/rpc";
import { WS_METHODS } from "@t3tools/contracts";
import { usageMcpSnapshot } from "@t3tools/shared/usageMcpSnapshot";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

export const readPeerUsageLimits = Effect.fn("web.peerUsageLimits.read")(function* (
  refresh: boolean,
) {
  if (refresh) yield* request(WS_METHODS.serverRefreshProviders, { fresh: true });
  const config = yield* request(WS_METHODS.serverGetConfig, {});
  // Hub snapshots arrive on the config stream, rather than server.getConfig.
  const sources =
    config.usageLimitSources ??
    (config.environment.capabilities.usageLimitSources
      ? yield* subscribe(WS_METHODS.subscribeServerConfig, { usageLimitSources: true }).pipe(
          Stream.filter((event) => event.type === "usageLimitSourcesUpdated"),
          Stream.map((event) => event.payload.sources),
          Stream.runHead,
          Effect.flatMap(Effect.fromOption),
          Effect.timeout("10 seconds"),
        )
      : []);
  return {
    environmentId: config.environment.environmentId,
    snapshot: usageMcpSnapshot(config.providers, sources, DateTime.formatIso(yield* DateTime.now)),
  };
});
