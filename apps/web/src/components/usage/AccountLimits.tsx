import { useAtomValue } from "@effect/atom-react";
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { formatResetAt } from "@t3tools/shared/limitsFormat";
import {
  collectLimitAccounts,
  collectLimitPools,
  displayLimitWindows,
  type LimitAccount,
  type LimitPool,
  paceRemainingPercent,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import { T, useGT } from "gt-react";
import { TicketIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "../../lib/utils";
import { environmentPresentations } from "../../state/presentation";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { providerClients } from "../settings/providerDriverMeta";
import { barColor } from "./UsageLimits";

/** Reset times drift as time passes, not as data changes; a coarse tick keeps them honest. */
function useNowMs(intervalMs = 30_000): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Interval clock that advances reset times.
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return nowMs;
}

function shortWindowLabel(label: string): string {
  return label
    .replace(/\b5-hour\b/g, "5h")
    .replace(/\bWeekly\b/g, "Week")
    .replace(/^Gemini 4 /, "")
    .replace(/^Claude and GPT\b/, "Claude/GPT")
    .replace(" · ", " ");
}

function limitTone(remaining: number): string {
  if (remaining === 0) return "text-destructive-foreground";
  return remaining <= 20 ? "text-warning-foreground" : "text-foreground";
}

function HoverLimitRow({
  label,
  window,
  color,
  nowMs,
}: {
  readonly label: string;
  readonly window: ServerProviderUsageWindow;
  readonly color: string;
  readonly nowMs: number;
}) {
  const remaining = remainingPercent(window);
  const timeLeft = paceRemainingPercent(window, nowMs);
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_2.25rem_3.25rem] items-center gap-1.5 text-[11px]">
      <span className="truncate text-muted-foreground">{shortWindowLabel(label)}</span>
      <span aria-hidden className="relative h-1 min-w-0 rounded-full bg-foreground/10">
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${remaining}%`, backgroundColor: color }}
        />
        {timeLeft !== null ? (
          <span
            className="absolute -inset-y-px w-0.5 -translate-x-1/2 rounded-full bg-foreground/60"
            style={{ left: `${timeLeft}%` }}
          />
        ) : null}
      </span>
      <span className={cn("text-right font-semibold tabular-nums", limitTone(remaining))}>
        {remaining}%
      </span>
      <span className="truncate text-right text-[10px] text-muted-foreground tabular-nums">
        {formatResetAt(window.resetsAt ?? null, nowMs) ?? ""}
      </span>
    </div>
  );
}

function accountLabel(account: LimitAccount): string {
  return account.displayName ?? account.email ?? providerClients.get(account.driver)?.label ?? "";
}

function HoverPool({ pool, nowMs }: { readonly pool: LimitPool; readonly nowMs: number }) {
  const label = providerClients.get(pool.driver)?.label ?? String(pool.driver);
  const providerColor = barColor(pool.driver);
  const windows = displayLimitWindows(pool);
  const named = pool.accounts.length > 1;
  const gt = useGT();
  return (
    <div className="flex flex-col gap-0.5 border-border not-first:border-t not-first:pt-2">
      <div className="flex items-center gap-1.5 pb-0.5">
        <ProviderInstanceIcon
          driverKind={pool.driver}
          displayName={label}
          iconClassName="size-3 shrink-0"
        />
        <span className="text-xs font-medium text-foreground">{label}</span>
      </div>
      {pool.accounts.map((account) => {
        const color = normalizeProviderAccentColor(account.accentColor) ?? providerColor;
        const credits = account.limits.resetCredits?.availableCount ?? 0;
        return (
          <div key={account.key} className="flex flex-col gap-0.5">
            {named || credits > 0 ? (
              <div className="flex items-center gap-1.5 pt-0.5 text-[10px] text-muted-foreground">
                {named ? (
                  <>
                    <span
                      aria-hidden
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="truncate">{accountLabel(account)}</span>
                  </>
                ) : null}
                {credits > 0 ? (
                  <span className="ml-auto inline-flex items-center gap-0.5 font-semibold text-foreground tabular-nums">
                    <TicketIcon className="size-3" aria-hidden />
                    {gt("{count, plural, one {# reset} other {# resets}}", { count: credits })}
                  </span>
                ) : null}
              </div>
            ) : null}
            {windows.map((poolWindow) => {
              const member = poolWindow.members.find((entry) => entry.account.key === account.key);
              return member ? (
                <HoverLimitRow
                  key={`${poolWindow.kind}:${poolWindow.id}`}
                  label={poolWindow.label}
                  window={member.window}
                  color={color}
                  nowMs={nowMs}
                />
              ) : null;
            })}
          </div>
        );
      })}
    </div>
  );
}

/** Limits of the providers that report them, shown on hovering the Usage button. */
export function AccountLimitsHoverCard() {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const nowMs = useNowMs();
  const pools = collectLimitPools(collectLimitAccounts(presentations), nowMs).filter((pool) =>
    pool.windows.some((window) => window.members.length > 0),
  );
  return (
    <div className="flex w-64 flex-col gap-2 p-1.5">
      {pools.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          <T>No provider reports limits yet.</T>
        </p>
      ) : (
        pools.map((pool) => <HoverPool key={pool.driver} pool={pool} nowMs={nowMs} />)
      )}
    </div>
  );
}
