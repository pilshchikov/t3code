/** Fork policy: analytics never collect identifiers or transmit events. */
import type { TelemetryOwner } from "./Identify.ts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class AnalyticsService extends Context.Service<
  AnalyticsService,
  {
    readonly record: (
      event: string,
      properties?: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<void>;
    readonly flush: Effect.Effect<void>;

    // Compatibility with upstream callers; the fork discards owners without collecting them.
    readonly recordOwners: (
      owners: ReadonlyArray<TelemetryOwner>,
      observedBy: "server" | "client",
    ) => Effect.Effect<void>;
  }
>()("t3/telemetry/AnalyticsService") {
  static readonly layerTest = Layer.succeed(
    AnalyticsService,
    AnalyticsService.of({
      record: Effect.fn("AnalyticsService.record")(function () {
        return Effect.void;
      }),
      flush: Effect.void,
      recordOwners: Effect.fn("AnalyticsService.recordOwners")(function () {
        return Effect.void;
      }),
    }),
  );
}

const make = Effect.succeed(
  AnalyticsService.of({
    record: Effect.fn("AnalyticsService.record")(() => Effect.void),
    flush: Effect.void,
    recordOwners: Effect.fn("AnalyticsService.recordOwners")(() => Effect.void),
  }),
);
export const layer = Layer.effect(AnalyticsService, make);
