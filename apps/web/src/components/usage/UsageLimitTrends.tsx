import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  UsageLimitHistory,
  UsageLimitHistoryInput,
  UsageLimitHistoryPoint,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import { useEffect, useMemo, useState } from "react";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { serverEnvironment } from "../../state/server";
import { Button } from "../ui/button";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import { historyAccounts, historySegments } from "./usageLimitHistoryModel";

function TrendChart({
  points,
  history,
  color,
}: {
  points: readonly UsageLimitHistoryPoint[];
  history: UsageLimitHistory;
  color: string;
}) {
  const start = Date.parse(history.since);
  const end = Date.parse(history.readAt);
  const x = (point: UsageLimitHistoryPoint) =>
    35 + ((Date.parse(point.measuredAt) - start) / (end - start)) * 525;
  const y = (point: UsageLimitHistoryPoint) => 12 + (100 - point.remainingPercent) * 1.1;
  const latest = points.at(-1)!;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span>{latest.windowLabel}</span>
        <span className="tabular-nums">{latest.remainingPercent.toFixed(1)}% remaining</span>
      </div>
      <svg
        viewBox="0 0 570 150"
        className="mt-2 w-full"
        role="img"
        aria-label={`${latest.windowLabel}: remaining quota over time. Latest ${latest.remainingPercent.toFixed(1)} percent.`}
      >
        {[0, 50, 100].map((value) => (
          <g key={value}>
            <text
              x="29"
              y={16 + (100 - value) * 1.1}
              textAnchor="end"
              fill="currentColor"
              fontSize="10"
              className="text-muted-foreground"
            >
              {value}%
            </text>
            <line
              x1="35"
              x2="560"
              y1={12 + (100 - value) * 1.1}
              y2={12 + (100 - value) * 1.1}
              stroke="currentColor"
              className="text-border"
            />
          </g>
        ))}
        {historySegments(points, history.resolutionMinutes).map((segment, index) => (
          <g key={index}>
            <polyline
              points={segment.map((p) => `${x(p)},${y(p)}`).join(" ")}
              fill="none"
              stroke={color}
              strokeWidth="2"
            />
            {segment.map((p) => (
              <circle
                key={p.measuredAt}
                cx={x(p)}
                cy={y(p)}
                r={segment.length === 1 ? 2.5 : 1.5}
                fill={color}
              >
                <title>
                  {new Date(p.measuredAt).toLocaleString()}: {p.remainingPercent.toFixed(1)}%
                  remaining
                </title>
              </circle>
            ))}
          </g>
        ))}
        <text x="35" y="145" fill="currentColor" fontSize="10" className="text-muted-foreground">
          {new Date(start).toLocaleDateString()}
        </text>
        <text
          x="560"
          y="145"
          textAnchor="end"
          fill="currentColor"
          fontSize="10"
          className="text-muted-foreground"
        >
          {new Date(end).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </text>
      </svg>
      <p className="text-xs text-muted-foreground">
        Last measured {new Date(latest.measuredAt).toLocaleString()}
      </p>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          Measurements ({points.length > 100 ? "latest 100" : points.length})
        </summary>
        <div className="mt-2 max-h-48 overflow-auto">
          <table className="w-full text-left tabular-nums">
            <thead>
              <tr>
                <th>Measured</th>
                <th>Remaining</th>
              </tr>
            </thead>
            <tbody>
              {points
                .slice(-100)
                .reverse()
                .map((p) => (
                  <tr key={p.measuredAt}>
                    <td>{new Date(p.measuredAt).toLocaleString()}</td>
                    <td>{p.remainingPercent.toFixed(1)}%</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function EnvironmentTrends({
  environmentId,
  label,
  days,
}: {
  environmentId: EnvironmentId;
  label: string;
  days: UsageLimitHistoryInput["days"];
}) {
  const query = useMemo(
    () => serverEnvironment.usageLimitHistory({ environmentId, input: { days } }),
    [environmentId, days],
  );
  const result = useAtomValue(query);
  const history = Option.getOrNull(AsyncResult.value(result));
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") appAtomRegistry.refresh(query);
    }, 60_000);
    return () => clearInterval(timer);
  }, [query]);
  const accounts = useMemo(() => historyAccounts(history?.points ?? []), [history]);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{label}</h3>
        <Button
          size="sm"
          variant="ghost"
          disabled={result.waiting}
          onClick={() => appAtomRegistry.refresh(query)}
        >
          Refresh history
        </Button>
      </div>
      {result._tag === "Failure" ? (
        <p role="alert" className="text-sm text-muted-foreground">
          Could not load history. The environment may be offline or need an update.
        </p>
      ) : null}
      {!history && result.waiting ? (
        <p className="text-sm text-muted-foreground">Loading history…</p>
      ) : null}
      {history && accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No measurements in this period yet. History starts after installing this version and
          receiving fresh provider limits.
        </p>
      ) : null}
      {history?.truncated ? (
        <p role="status" className="text-sm text-muted-foreground">
          Showing the latest 20,000 points. Choose a shorter period for more detail.
        </p>
      ) : null}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {history
          ? accounts.map(([id, account]) => (
              <article key={id} className="min-w-0 rounded-xl border border-border bg-card p-4">
                <h4 className="mb-4 flex items-center gap-2 text-sm font-medium">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: account.color ?? "var(--primary)" }}
                  />
                  {account.label.includes("@") ? (
                    <RedactedSensitiveText
                      value={account.label}
                      ariaLabel="Toggle account label visibility"
                      revealTooltip="Click to reveal account"
                      hideTooltip="Click to hide account"
                    />
                  ) : (
                    account.label
                  )}
                </h4>
                <div className="flex flex-col gap-5">
                  {[...account.windows]
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([windowId, points]) => (
                      <TrendChart
                        key={windowId}
                        points={points}
                        history={history}
                        color={account.color ?? "var(--primary)"}
                      />
                    ))}
                </div>
              </article>
            ))
          : null}
      </div>
    </section>
  );
}

export function UsageLimitTrends({
  environments,
}: {
  environments: readonly { environmentId: EnvironmentId; label: string }[];
}) {
  const [days, setDays] = useState<UsageLimitHistoryInput["days"]>(1);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2" aria-label="History period">
        {([1, 7, 30, 90] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={days === value ? "secondary" : "ghost"}
            aria-pressed={days === value}
            onClick={() => setDays(value)}
          >
            {value === 1 ? "24 hours" : `${value} days`}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Remaining quota, not token counts. Fresh provider checks are stored in five-minute buckets
        for 90 days while the server runs. Longer ranges are downsampled. Breaks mark resets or
        missing measurements; history cannot be backfilled.
      </p>
      {environments.map((environment) => (
        <EnvironmentTrends key={environment.environmentId} {...environment} days={days} />
      ))}
    </div>
  );
}
