import {
  isProviderAvailable,
  UsageDay,
  UsageReadError,
  type McpUsageLimitsInput,
  type McpUsageLimitsSnapshot,
  type McpUsageReadInput,
  type UsageSummary,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as UsageLimitSources from "./UsageLimitSources.ts";
import * as UsageService from "./UsageService.ts";

export class UsageSnapshots extends Context.Service<
  UsageSnapshots,
  {
    readonly readLimits: (input: McpUsageLimitsInput) => Effect.Effect<McpUsageLimitsSnapshot>;
    readonly readUsage: (input: McpUsageReadInput) => Effect.Effect<UsageSummary, UsageReadError>;
  }
>()("t3/usage/UsageSnapshots") {}

const make = Effect.gen(function* () {
  const registry = yield* ProviderRegistry.ProviderRegistry;
  const sources = yield* UsageLimitSources.UsageLimitSources;
  const usage = yield* UsageService.UsageService;
  return UsageSnapshots.of({
    readLimits: Effect.fn("UsageSnapshots.readLimits")(function* (input) {
      if (input.refresh)
        yield* Effect.all([registry.refresh(), sources.refresh], { concurrency: 2 });
      const providers = yield* registry.getProviders;
      const snapshots = yield* sources.current;
      return {
        readAt: DateTime.formatIso(yield* DateTime.now),
        providers: providers.map((provider) => ({
          instanceId: provider.instanceId,
          driver: provider.driver,
          ...(provider.displayName === undefined ? {} : { displayName: provider.displayName }),
          enabled: provider.enabled,
          installed: provider.installed,
          available: isProviderAvailable(provider),
          auth: {
            status: provider.auth.status,
            ...(provider.auth.label === undefined ? {} : { label: provider.auth.label }),
            ...(provider.auth.email === undefined ? {} : { email: provider.auth.email }),
            ...(provider.auth.workspaceId === undefined
              ? {}
              : { workspaceId: provider.auth.workspaceId }),
          },
          limits: provider.usageLimits ?? null,
        })),
        sources: snapshots,
      };
    }),
    readUsage: Effect.fn("UsageSnapshots.readUsage")(function* (input) {
      const timeZone = input.timeZone ?? "UTC";
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      const today = yield* Effect.try({
        try: () =>
          UsageDay.make(
            new Intl.DateTimeFormat("en-CA", {
              timeZone,
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(now),
          ),
        catch: () =>
          new UsageReadError({ reason: "invalidWindow", detail: "Invalid usage time zone." }),
      });
      return yield* usage.readSummary({
        ...input,
        timeZone,
        sinceDay: input.sinceDay ?? input.untilDay ?? today,
        untilDay: input.untilDay ?? today,
      });
    }),
  });
});

export const layer = Layer.effect(UsageSnapshots, make);
