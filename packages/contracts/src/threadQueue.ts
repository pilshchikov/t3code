import * as Schema from "effect/Schema";
import {
  MessageId,
  NonNegativeInt,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const ThreadQueueInput = Schema.Struct({
  action: Schema.Literals(["list", "read", "edit", "cancel", "reorder", "promote_to_steer"]),
  threadId: Schema.optional(ThreadId),
  queuedRunId: Schema.optional(RunId),
  text: Schema.optional(Schema.String.check(Schema.isMaxLength(100000))),
  beforeRunId: Schema.optional(Schema.NullOr(RunId)),
  targetRunId: Schema.optional(RunId),
  cursor: Schema.optional(NonNegativeInt),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  clientRequestId: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
});
export type ThreadQueueInput = typeof ThreadQueueInput.Type;
export const ThreadQueueEntry = Schema.Struct({
  queuedRunId: RunId,
  messageId: MessageId,
  text: Schema.String,
  truncated: Schema.Boolean,
});
export const ThreadQueueResult = Schema.Union([
  Schema.Struct({
    items: Schema.Array(ThreadQueueEntry),
    nextCursor: Schema.NullOr(NonNegativeInt),
    activeRunId: Schema.NullOr(RunId),
  }),
  ThreadQueueEntry,
  Schema.Struct({ sequence: NonNegativeInt }),
]);
export type ThreadQueueResult = typeof ThreadQueueResult.Type;
