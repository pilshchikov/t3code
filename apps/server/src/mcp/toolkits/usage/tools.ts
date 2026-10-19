import {
  McpUsageLimitsInput,
  McpUsageLimitsResult,
  McpUsageReadInput,
  OrchestratorMcpFailure,
  UsageSummary,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";
import * as Schema from "effect/Schema";
import * as Environment from "../../../environment/ServerEnvironment.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as UsageSnapshots from "../../../usage/UsageSnapshots.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagement.ThreadManagementService,
    Environment.ServerEnvironment,
    UsageSnapshots.UsageSnapshots,
  ],
};

export const UsageToolkit = Toolkit.make(
  Tool.make("t3_usage_limits_read", {
    ...shared,
    description:
      "Read the same provider/account quota data as this environment's Usage → Limits page, including Claude and Codex profiles and configured usage hubs. Call this rather than guessing limits from a model's native tools. Returns usedPercent, reset times, checkedAt, unavailable/probe-failure states and the caller's provider instance ID. A null limits value means unknown, never zero usage. Cached by default; refresh:true runs the existing page probes first. A refresh can still fail: inspect checkedAt and unavailable before treating data as current. Does not redeem credits or change accounts. Other environments are not included.",
    parameters: McpUsageLimitsInput,
    success: Schema.toCodecJson(McpUsageLimitsResult),
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("t3_usage_read", {
    ...shared,
    description:
      "Read token/cost history from the same sources and scanner as this environment's Usage page, for every supported provider/account and model. Defaults to today in UTC; pass sinceDay/untilDay (YYYY-MM-DD) and an IANA timeZone for another window. Costs may be estimates or unpriced: inspect costSource, pricing, source status and refreshing. awaitRefresh:true waits for slow sources instead of returning cached data. Session totals do not equal subscription quota; use t3_usage_limits_read for quota. Input token categories are disjoint; reasoningTokens is already included in outputTokens. Hourly resolution also requires sinceTime/untilTime ISO instants. Other environments are not included.",
    parameters: McpUsageReadInput,
    success: Schema.toCodecJson(UsageSummary),
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
);
