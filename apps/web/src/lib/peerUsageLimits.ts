import { request } from "@t3tools/client-runtime/rpc";
import { WS_METHODS } from "@t3tools/contracts";
import { usageMcpSnapshot } from "@t3tools/shared/usageMcpSnapshot";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

export const readPeerUsageLimits = Effect.fn("web.peerUsageLimits.read")(function* (
  refresh: boolean,
) {
  if (refresh) yield* request(WS_METHODS.serverRefreshProviders, { fresh: true });
  const config = yield* request(WS_METHODS.serverGetConfig, {});
  return {
    environmentId: config.environment.environmentId,
    snapshot: usageMcpSnapshot(
      config.providers,
      config.usageLimitSources ?? [],
      DateTime.formatIso(yield* DateTime.now),
    ),
  };
});
