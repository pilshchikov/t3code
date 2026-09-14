import type { UsageLimitHistoryPoint } from "@t3tools/contracts";

/** Never draw through a reset or a period without measurements. */
export function historySegments(
  points: readonly UsageLimitHistoryPoint[],
  resolutionMinutes: number,
) {
  const segments: UsageLimitHistoryPoint[][] = [];
  for (const point of points) {
    const segment = segments.at(-1);
    const previous = segment?.at(-1);
    const gap = previous ? Date.parse(point.measuredAt) - Date.parse(previous.measuredAt) : 0;
    if (
      !segment ||
      !previous ||
      gap > Math.max(15, resolutionMinutes * 2) * 60_000 ||
      point.remainingPercent > previous.remainingPercent ||
      point.resetsAt !== previous.resetsAt
    ) {
      segments.push([point]);
    } else segment.push(point);
  }
  return segments;
}

export function historyAccounts(points: readonly UsageLimitHistoryPoint[]) {
  const accounts = new Map<
    string,
    { label: string; color: string | null; windows: Map<string, UsageLimitHistoryPoint[]> }
  >();
  for (const point of points) {
    let account = accounts.get(point.accountId);
    if (!account) {
      account = { label: point.label, color: point.color, windows: new Map() };
      accounts.set(point.accountId, account);
    }
    account.label = point.label;
    account.color = point.color;
    const window = account.windows.get(point.windowId);
    if (window) window.push(point);
    else account.windows.set(point.windowId, [point]);
  }
  return [...accounts].sort(
    ([aId, a], [bId, b]) => a.label.localeCompare(b.label) || aId.localeCompare(bId),
  );
}
