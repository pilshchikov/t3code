import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  UsageLimitHistory,
  UsageLimitHistoryInput,
  UsageLimitHistoryPoint,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { serverEnvironment } from "../../state/server";
import { Button } from "../ui/button";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import { historyAccounts, historyProviderGroups, historySegments } from "./usageLimitHistoryModel";
import { historyAxisTicks, historyPointsByDay, nearestHistoryPoint } from "./usageLimitHistoryAxis";

const PLOT_LEFT = 38;
const PLOT_RIGHT = 562;
const PLOT_TOP = 10;
const PLOT_BOTTOM = 118;
const AXIS_LABEL_Y = 134;
const PLOT_HEIGHT = PLOT_BOTTOM - PLOT_TOP;

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
  const span = Math.max(1, end - start);
  const x = (at: number) => PLOT_LEFT + ((at - start) / span) * (PLOT_RIGHT - PLOT_LEFT);
  const pointX = (point: UsageLimitHistoryPoint) => x(Date.parse(point.measuredAt));
  const pointY = (point: UsageLimitHistoryPoint) =>
    PLOT_TOP + ((100 - point.remainingPercent) / 100) * PLOT_HEIGHT;
  const latest = points.at(-1)!;
  const ticks = useMemo(() => historyAxisTicks(start, end), [start, end]);
  const [hovered, setHovered] = useState<UsageLimitHistoryPoint | null>(null);
  const dayGroups = useMemo(() => historyPointsByDay(points), [points]);

  // The pointer reads a time from its position and the chart answers with the
  // measurement nearest it, so a 1.5px dot never has to be hit exactly.
  const trackPointer = (event: ReactPointerEvent<SVGRectElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const ratio = (event.clientX - bounds.left) / bounds.width;
    setHovered(nearestHistoryPoint(points, start + ratio * span));
  };

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span>{latest.windowLabel}</span>
        <span className="tabular-nums">{latest.remainingPercent.toFixed(1)}% remaining</span>
      </div>
      <div className="relative mt-2">
        <svg
          viewBox={`0 0 570 142`}
          className="w-full"
          role="img"
          aria-label={`${latest.windowLabel}: remaining quota over time. Latest ${latest.remainingPercent.toFixed(1)} percent.`}
        >
          {[0, 25, 50, 75, 100].map((value) => {
            const lineY = PLOT_TOP + ((100 - value) / 100) * PLOT_HEIGHT;
            return (
              <g key={value}>
                {value % 50 === 0 ? (
                  <text
                    x={PLOT_LEFT - 6}
                    y={lineY + 3}
                    textAnchor="end"
                    fill="currentColor"
                    fontSize="10"
                    className="text-muted-foreground"
                  >
                    {value}%
                  </text>
                ) : null}
                <line
                  x1={PLOT_LEFT}
                  x2={PLOT_RIGHT}
                  y1={lineY}
                  y2={lineY}
                  stroke="currentColor"
                  strokeWidth={value % 50 === 0 ? 1 : 0.5}
                  className="text-border"
                  opacity={value % 50 === 0 ? 0.9 : 0.5}
                />
              </g>
            );
          })}
          {ticks.map((tick) => (
            <g key={`${tick.at}:${tick.isDayStart ? "day" : "hour"}`}>
              <line
                x1={x(tick.at)}
                x2={x(tick.at)}
                y1={PLOT_TOP}
                y2={PLOT_BOTTOM}
                stroke="currentColor"
                strokeWidth={tick.isDayStart ? 1 : 0.5}
                strokeDasharray={tick.isDayStart ? undefined : "2 3"}
                className="text-border"
                opacity={tick.isDayStart ? 0.9 : 0.45}
              />
              <text
                x={x(tick.at)}
                y={AXIS_LABEL_Y}
                textAnchor="middle"
                fill="currentColor"
                fontSize="10"
                className="text-muted-foreground"
                opacity={tick.isDayStart ? 1 : 0.75}
              >
                {tick.label}
              </text>
            </g>
          ))}
          <polyline
            points={points.map((p) => `${pointX(p)},${pointY(p)}`).join(" ")}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeDasharray="4 4"
            opacity="0.5"
          />
          {historySegments(points, history.resolutionMinutes).map((segment, index) => (
            <g key={index}>
              <polyline
                points={segment.map((p) => `${pointX(p)},${pointY(p)}`).join(" ")}
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {segment.map((p) => (
                <circle
                  key={p.measuredAt}
                  cx={pointX(p)}
                  cy={pointY(p)}
                  r={segment.length === 1 ? 2.5 : 1.5}
                  fill={color}
                />
              ))}
            </g>
          ))}
          {hovered ? (
            <g pointerEvents="none">
              <line
                x1={pointX(hovered)}
                x2={pointX(hovered)}
                y1={PLOT_TOP}
                y2={PLOT_BOTTOM}
                stroke="currentColor"
                strokeWidth="1"
                className="text-muted-foreground"
                opacity="0.7"
              />
              <circle
                cx={pointX(hovered)}
                cy={pointY(hovered)}
                r="4"
                fill={color}
                stroke="var(--card)"
                strokeWidth="2"
              />
            </g>
          ) : null}
          <rect
            x={PLOT_LEFT}
            y={PLOT_TOP}
            width={PLOT_RIGHT - PLOT_LEFT}
            height={PLOT_HEIGHT}
            fill="transparent"
            onPointerMove={trackPointer}
            onPointerLeave={() => setHovered(null)}
          />
        </svg>
        {hovered ? (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 w-max max-w-56 -translate-x-1/2 rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
            style={{
              left: `${Math.min(88, Math.max(12, (pointX(hovered) / 570) * 100))}%`,
            }}
          >
            <span className="block tabular-nums">
              {hovered.remainingPercent.toFixed(1)}% remaining
            </span>
            <span className="block text-muted-foreground">
              {new Date(hovered.measuredAt).toLocaleString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
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
            {historyPointsByDay(points.slice(-100)).map((day) => (
              <tbody key={day.day}>
                <tr>
                  <th
                    colSpan={2}
                    className="pt-2 text-left font-medium text-muted-foreground"
                    scope="colgroup"
                  >
                    {day.label}
                  </th>
                </tr>
                {day.points.map((p) => (
                  <tr key={p.measuredAt}>
                    <td>
                      {new Date(p.measuredAt).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td>{p.remainingPercent.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </details>
      {dayGroups.length > 1 ? (
        <p className="sr-only">
          Covering {dayGroups.length} days, newest {dayGroups[0]?.label}.
        </p>
      ) : null}
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
    }, 30_000);
    return () => clearInterval(timer);
  }, [query]);
  const accounts = useMemo(() => historyAccounts(history?.points ?? []), [history]);
  const groups = useMemo(() => historyProviderGroups(history?.points ?? []), [history]);
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
      {groups.map((group) => (
        <section key={group.label} className="flex flex-col gap-3">
          <h4 className="border-b border-border pb-2 text-sm font-semibold">{group.label}</h4>
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            {history
              ? group.accounts.map(([id, account]) => (
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
      ))}
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
        Remaining quota, not token counts. Active providers are checked at work start, about every
        30 seconds, and when their last working thread finishes. Measurements are stored for 90 days
        in 30-second buckets; longer ranges are downsampled. Lines connect measurements, including
        resets. Dashed lines span missing measurements; history cannot be backfilled.
      </p>
      {environments.map((environment) => (
        <EnvironmentTrends key={environment.environmentId} {...environment} days={days} />
      ))}
    </div>
  );
}
