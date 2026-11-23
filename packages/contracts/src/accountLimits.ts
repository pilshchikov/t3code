/**
 * Windows are data, not schema: providers add, pause and restore windows without notice, so clients
 * render the array as-is. Clients never merge across environments, since two machines' clocks
 * cannot arbitrate freshness for each other.
 */
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { UsageProviderKind } from "./usage.ts";

/**
 * Bumped on incompatible {@link AccountLimitsSummary} changes. v2 keys snapshots per provider
 * instance.
 */
export const ACCOUNT_LIMITS_CONTRACT_VERSION = 2 as const;

export const AccountLimitsWindow = Schema.Struct({
  /**
   * Stable identifier: `five_hour` and `seven_day` for the standard windows,
   * provider-specific slugs for anything scoped (model weeklies etc.).
   */
  id: TrimmedNonEmptyString,
  /** Short display label ("5h", "Week", "Fable"). */
  label: TrimmedNonEmptyString,
  /** Share of the window consumed, 0-100. */
  usedPercent: Schema.Number,
  /**
   * ISO timestamp when the window resets. Null until the window has traffic:
   * providers report an untouched window with no reset clock.
   */
  resetsAt: Schema.NullOr(Schema.String),
  /** Window length, when the provider reports one. */
  windowMinutes: Schema.NullOr(Schema.Number),
});
export type AccountLimitsWindow = typeof AccountLimitsWindow.Type;

export const AccountLimitsSource = Schema.Literals(["live", "transcript"]);
export type AccountLimitsSource = typeof AccountLimitsSource.Type;

export const AccountLimitsSnapshot = Schema.Struct({
  provider: UsageProviderKind,
  /**
   * Provider instance the windows were observed on, so accounts on different instances never
   * overwrite each other. Optional so pre-attribution servers still decode; absent means the
   * driver's default instance.
   */
  instanceId: Schema.optional(ProviderInstanceId),
  /** Provider plan slug ("max", "pro"), when known. */
  plan: Schema.NullOr(TrimmedNonEmptyString),
  windows: Schema.Array(AccountLimitsWindow),
  /**
   * When the provider reported these numbers, not when we were asked. Live
   * Claude data only flows while a session runs, so this can lag by hours;
   * clients surface the age instead of pretending the data is current.
   */
  asOf: Schema.String,
  /**
   * `live` - captured off a running provider session.
   * `transcript` - recovered from the provider's on-disk session files
   * (Codex writes its snapshot beside every token count; Claude never
   * persists limits, so Claude snapshots are always `live`).
   */
  source: AccountLimitsSource,
});
export type AccountLimitsSnapshot = typeof AccountLimitsSnapshot.Type;

export const AccountLimitsSummary = Schema.Struct({
  contractVersion: Schema.Number,
  readAt: Schema.String,
  /**
   * At most one snapshot per provider instance. Empty until a session has
   * reported.
   */
  snapshots: Schema.Array(AccountLimitsSnapshot),
});
export type AccountLimitsSummary = typeof AccountLimitsSummary.Type;
