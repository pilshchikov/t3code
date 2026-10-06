import { it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Analytics from "./AnalyticsService.ts";

it.effect("records and flushes without an HTTP client or identifier storage", () =>
  Effect.gen(function* () {
    const analytics = yield* Analytics.AnalyticsService;
    yield* analytics.record("turn.completed", { model: "synthetic" });
    yield* analytics.flush;
  }).pipe(Effect.provide(Analytics.layer)),
);

it.effect("legacy telemetry opt-ins cannot enable tracking in the fork", () =>
  Effect.gen(function* () {
    const analytics = yield* Analytics.AnalyticsService;
    yield* analytics.record("startup");
    yield* analytics.flush;
  }).pipe(
    Effect.provide(
      Analytics.layer.pipe(
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              T3CODE_TELEMETRY_ENABLED: true,
              T3CODE_POSTHOG_KEY: "test",
              T3CODE_POSTHOG_HOST: "https://tracking.invalid",
            }),
          ),
        ),
      ),
    ),
  ),
);
