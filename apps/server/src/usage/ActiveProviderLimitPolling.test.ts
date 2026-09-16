import { describe, expect, it } from "@effect/vitest";
import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ActiveProviderLimitSchedule, layer } from "./ActiveProviderLimitPolling.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { UsageLimitHistory } from "./UsageLimitHistory.ts";

const personal = ProviderInstanceId.make("personal");
const work = ProviderInstanceId.make("work");
describe("active provider limit polling", () => {
  it("checks first start, once each 30 seconds, and last finish across concurrent threads", () => {
    const schedule = new ActiveProviderLimitSchedule();
    expect(schedule.update("a", work, true)).toEqual([work]);
    schedule.requested(work, 1000);
    expect(schedule.update("b", work, true)).toEqual([]);
    expect(schedule.due(30_999)).toEqual([]);
    expect(schedule.due(31_000)).toEqual([work]);
    schedule.requested(work, 31_000);
    expect(schedule.update("a", work, false)).toEqual([]);
    expect(schedule.update("b", work, false)).toEqual([work]);
    schedule.requested(work, 32_000);
    expect(schedule.due(100_000)).toEqual([]);
    expect(schedule.update("b", work, false)).toEqual([]);
  });
  it("keeps separate account clocks and handles provider switches", () => {
    const schedule = new ActiveProviderLimitSchedule();
    schedule.update("a", personal, true);
    schedule.requested(personal, 0);
    expect(schedule.update("b", work, true)).toEqual([work]);
    schedule.requested(work, 20_000);
    expect(schedule.due(30_000)).toEqual([personal]);
    expect(schedule.update("a", work, true)).toEqual([personal]);
  });
  it.effect("refreshes and records without a UI, stopping after work ends", () =>
    Effect.gen(function* () {
      const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
      const requests = yield* Queue.unbounded<ProviderInstanceId>();
      let recorded = 0;
      yield* Layer.build(
        layer.pipe(
          Layer.provide(
            Layer.mock(ProviderService)({
              subscribeEvents: PubSub.subscribe(events).pipe(Effect.map(Stream.fromSubscription)),
              listSessions: () => Effect.succeed([]),
            }),
          ),
          Layer.provide(
            Layer.mock(ProviderRegistry)({
              getProviders: Effect.succeed([]),
              refreshInstance: (id) => Queue.offer(requests, id).pipe(Effect.as([])),
            }),
          ),
          Layer.provide(
            Layer.mock(UsageLimitHistory)({
              record: () =>
                Effect.sync(() => {
                  recorded++;
                }),
            }),
          ),
        ),
      );
      const base = {
        eventId: EventId.make("event"),
        provider: ProviderDriverKind.make("claudeAgent"),
        providerInstanceId: work,
        threadId: ThreadId.make("thread"),
        createdAt: "2026-09-14T12:00:00.000Z",
      };
      yield* PubSub.publish(events, { ...base, type: "turn.started", payload: {} });
      expect(yield* Queue.take(requests)).toBe(work);
      yield* PubSub.publish(events, {
        ...base,
        threadId: ThreadId.make("second"),
        type: "turn.started",
        payload: {},
      });
      yield* TestClock.adjust("1 millis");
      expect(yield* Queue.size(requests)).toBe(0);
      yield* TestClock.adjust("29999 millis");
      expect(yield* Queue.take(requests)).toBe(work);
      yield* PubSub.publish(events, {
        ...base,
        type: "turn.completed",
        payload: { state: "completed" },
      });
      yield* TestClock.adjust("1 millis");
      expect(yield* Queue.size(requests)).toBe(0);
      yield* PubSub.publish(events, {
        ...base,
        threadId: ThreadId.make("second"),
        type: "turn.completed",
        payload: { state: "completed" },
      });
      expect(yield* Queue.take(requests)).toBe(work);
      yield* TestClock.adjust("60 seconds");
      expect(yield* Queue.size(requests)).toBe(0);
      expect(recorded).toBe(3);
    }).pipe(Effect.scoped),
  );
});
