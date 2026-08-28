/**
 * Merges per-environment usage summaries into the single view the page renders.
 *
 * Pure, so the de-duplication and derivation rules can be tested without a
 * connected environment.
 *
 * @module usageMerge
 */
import {
  USAGE_MERGE_COMPATIBLE_SINCE,
  type EnvironmentId,
  type UsageBucket,
  type UsageProviderKind,
  type UsageSourceFingerprint,
  type UsageSummary,
} from "@t3tools/contracts";

export interface EnvironmentUsage {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly summary: UsageSummary;
}

export interface ProviderTotals {
  readonly provider: UsageProviderKind;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly records: number;
  readonly sessions: number;
  readonly costShare: number;
  readonly tokenShare: number;
}

export interface ModelTotals {
  readonly model: string;
  readonly provider: UsageProviderKind;
  /** The account whose transcripts these tokens came from; one row per model per account. */
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly instanceId: string | null;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly records: number;
  readonly costShare: number;
}

export interface UsageSourceTotals {
  readonly sourceId: string;
  readonly label: string;
  readonly provider: UsageProviderKind;
  /** The provider instance this source was configured from, when the server named one. */
  readonly instanceId: string | null;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly records: number;
  readonly costShare: number;
}

export interface DailyTotals {
  readonly day: string;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly byProvider: ReadonlyMap<UsageProviderKind, { costUsd: number; totalTokens: number }>;
}

export interface HourlyTotals {
  readonly day: string;
  readonly hourStart: string;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly byProvider: ReadonlyMap<UsageProviderKind, { costUsd: number; totalTokens: number }>;
}

export interface CostQuality {
  readonly providerReportedShare: number;
  readonly modelPricedShare: number;
  readonly unpricedShare: number;
  readonly cacheSavingsUsd: number;
}

export interface MergedUsage {
  readonly costUsd: number;
  readonly uncachedInputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly records: number;
  readonly sessions: number;
  readonly providers: readonly ProviderTotals[];
  readonly sources: readonly UsageSourceTotals[];
  readonly models: readonly ModelTotals[];
  readonly daily: readonly DailyTotals[];
  readonly hourly: readonly HourlyTotals[];
  readonly costQuality: CostQuality;
  /** Environments whose data was dropped as a duplicate of another's. */
  readonly duplicateSources: readonly string[];
  readonly contributingEnvironments: readonly EnvironmentId[];
  readonly staleEnvironments: readonly EnvironmentId[];
}

/**
 * Two sources are the same physical transcript directory only when host,
 * provider, path and filesystem identity all agree.
 *
 * `volumeId` is what stops two machines that happen to share a hostname and a
 * home path, which is every Mac in a fleet, from collapsing into one source and
 * having one of them silently dropped.
 */
function fingerprintKey(fingerprint: UsageSourceFingerprint): string {
  return [
    fingerprint.hostId,
    fingerprint.provider,
    fingerprint.resolvedHomePath,
    fingerprint.volumeId,
  ].join(" ");
}

/**
 * Decides which environment owns each physical transcript directory.
 *
 * Several environments on one machine (worktree servers, for instance) resolve
 * the same provider home and would otherwise double count every token. The
 * first environment in a stable order claims a fingerprint; the rest have that
 * provider's buckets dropped. Environments are sorted by id so the winner does
 * not change between renders.
 */
function claimSources(environments: readonly EnvironmentUsage[]): {
  readonly ownerByFingerprint: ReadonlyMap<string, EnvironmentId>;
  readonly duplicates: readonly string[];
} {
  const ownerByFingerprint = new Map<string, EnvironmentId>();
  const duplicates: string[] = [];

  const ordered = [...environments].sort((a, b) => a.environmentId.localeCompare(b.environmentId));

  for (const environment of ordered) {
    for (const source of environment.summary.sources) {
      if (source.status === "missing") continue;
      const key = fingerprintKey(source.fingerprint);
      if (ownerByFingerprint.has(key)) {
        duplicates.push(`${environment.label}: ${source.fingerprint.resolvedHomePath}`);
        continue;
      }
      ownerByFingerprint.set(key, environment.environmentId);
    }
  }

  return { ownerByFingerprint, duplicates };
}

/** Sources this environment owns after fingerprint claims, plus their buckets. */
function ownedContribution(
  environment: EnvironmentUsage,
  ownerByFingerprint: ReadonlyMap<string, EnvironmentId>,
): {
  readonly buckets: readonly UsageBucket[];
  readonly sessionsByProvider: ReadonlyMap<UsageProviderKind, number>;
} {
  const ownedProviders = new Set<UsageProviderKind>();
  const ownedSourceIds = new Set<string>();
  const sessionsByProvider = new Map<UsageProviderKind, number>();
  for (const source of environment.summary.sources) {
    if (source.status === "missing") continue;
    const key = fingerprintKey(source.fingerprint);
    if (ownerByFingerprint.get(key) === environment.environmentId) {
      ownedProviders.add(source.fingerprint.provider);
      ownedSourceIds.add(source.sourceId ?? source.fingerprint.resolvedHomePath);
      const provider = source.fingerprint.provider;
      ownedProviders.add(provider);
      // Distinct within a directory. Summing per-bucket session counts instead
      // would count a session once per day and model it spans.
      sessionsByProvider.set(
        provider,
        (sessionsByProvider.get(provider) ?? 0) + source.distinctSessions,
      );
    }
  }
  return {
    buckets: environment.summary.buckets.filter((bucket) =>
      bucket.sourceId === undefined
        ? ownedProviders.has(bucket.provider)
        : ownedSourceIds.has(bucket.sourceId),
    ),
    sessionsByProvider,
  };
}

function bucketTokens(bucket: UsageBucket): number {
  // reasoningTokens is a subset of outputTokens and must not be added again.
  return (
    bucket.totals.uncachedInputTokens +
    bucket.totals.cachedInputTokens +
    bucket.totals.cacheCreationTokens +
    bucket.totals.outputTokens
  );
}

function isCompatibleContractVersion(version: number, expected: number): boolean {
  return version >= USAGE_MERGE_COMPATIBLE_SINCE && version <= expected;
}

const EMPTY_MERGED: MergedUsage = {
  costUsd: 0,
  uncachedInputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  records: 0,
  sessions: 0,
  providers: [],
  sources: [],
  models: [],
  daily: [],
  hourly: [],
  costQuality: {
    providerReportedShare: 0,
    modelPricedShare: 0,
    unpricedShare: 0,
    cacheSavingsUsd: 0,
  },
  duplicateSources: [],
  contributingEnvironments: [],
  staleEnvironments: [],
};

const PROVIDER_FALLBACK_LABEL: Record<UsageProviderKind, string> = {
  claude: "Claude Code",
  codex: "Codex",
  grok: "Grok",
};

/**
 * Merges every connected environment's summary.
 *
 * `expectedContractVersion` guards against an environment running older server
 * code: rather than blocking the page, incompatible data is excluded and its
 * id is reported so the UI can say coverage is partial. Versions in
 * [{@link USAGE_MERGE_COMPATIBLE_SINCE}, expected] still merge, so an additive
 * provider expansion does not drop Claude/Codex totals from older servers.
 */
export function mergeUsage(
  environments: readonly EnvironmentUsage[],
  expectedContractVersion: number,
): MergedUsage {
  if (environments.length === 0) return EMPTY_MERGED;

  const current: EnvironmentUsage[] = [];
  const staleEnvironments: EnvironmentId[] = [];
  for (const environment of environments) {
    if (isCompatibleContractVersion(environment.summary.contractVersion, expectedContractVersion)) {
      current.push(environment);
    } else {
      staleEnvironments.push(environment.environmentId);
    }
  }

  const { ownerByFingerprint, duplicates } = claimSources(current);

  let costUsd = 0;
  let uncachedInputTokens = 0;
  let cachedInputTokens = 0;
  let cacheCreationTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let records = 0;
  let sessions = 0;
  let cacheSavingsUsd = 0;
  let providerReportedRecords = 0;
  let unpricedRecords = 0;

  const providerAccumulator = new Map<
    UsageProviderKind,
    { costUsd: number; totalTokens: number; records: number; sessions: number }
  >();
  const modelAccumulator = new Map<
    string,
    {
      model: string;
      provider: UsageProviderKind;
      sourceId: string;
      sourceLabel: string;
      instanceId: string | null;
      costUsd: number;
      totalTokens: number;
      records: number;
    }
  >();
  const sourceAccumulator = new Map<
    string,
    {
      sourceId: string;
      label: string;
      provider: UsageProviderKind;
      instanceId: string | null;
      costUsd: number;
      totalTokens: number;
      records: number;
    }
  >();
  const dailyAccumulator = new Map<
    string,
    {
      costUsd: number;
      totalTokens: number;
      byProvider: Map<UsageProviderKind, { costUsd: number; totalTokens: number }>;
    }
  >();
  const hourlyAccumulator = new Map<
    string,
    {
      day: string;
      hourStart: string;
      costUsd: number;
      totalTokens: number;
      byProvider: Map<UsageProviderKind, { costUsd: number; totalTokens: number }>;
    }
  >();
  const contributingEnvironments: EnvironmentId[] = [];

  for (const environment of current) {
    const { buckets, sessionsByProvider } = ownedContribution(environment, ownerByFingerprint);
    if (buckets.length > 0) contributingEnvironments.push(environment.environmentId);

    for (const [providerKind, providerSessions] of sessionsByProvider) {
      sessions += providerSessions;
      if (providerSessions === 0) continue;
      const provider = providerAccumulator.get(providerKind) ?? {
        costUsd: 0,
        totalTokens: 0,
        records: 0,
        sessions: 0,
      };
      provider.sessions += providerSessions;
      providerAccumulator.set(providerKind, provider);
    }

    for (const bucket of buckets) {
      const tokens = bucketTokens(bucket);

      costUsd += bucket.costUsd;
      cacheSavingsUsd += bucket.cacheSavingsUsd;
      uncachedInputTokens += bucket.totals.uncachedInputTokens;
      cachedInputTokens += bucket.totals.cachedInputTokens;
      cacheCreationTokens += bucket.totals.cacheCreationTokens;
      outputTokens += bucket.totals.outputTokens;
      reasoningTokens += bucket.totals.reasoningTokens;
      records += bucket.records;
      unpricedRecords += bucket.unpricedRecords;
      if (bucket.costSource === "providerReported") providerReportedRecords += bucket.records;

      const provider = providerAccumulator.get(bucket.provider) ?? {
        costUsd: 0,
        totalTokens: 0,
        records: 0,
        sessions: 0,
      };
      provider.costUsd += bucket.costUsd;
      provider.totalTokens += tokens;
      provider.records += bucket.records;
      providerAccumulator.set(bucket.provider, provider);

      const matchingSource = environment.summary.sources.find(
        (source) =>
          (bucket.sourceId !== undefined &&
            (source.sourceId === bucket.sourceId ||
              source.fingerprint.resolvedHomePath === bucket.sourceId)) ||
          (bucket.sourceId === undefined && source.fingerprint.provider === bucket.provider),
      );
      const sourceId =
        bucket.sourceId ??
        matchingSource?.sourceId ??
        matchingSource?.fingerprint.resolvedHomePath ??
        bucket.provider;
      const sourceKey = `${environment.environmentId}\u0000${sourceId}`;
      const sourceLabel =
        matchingSource?.sourceLabel ??
        matchingSource?.fingerprint.resolvedHomePath ??
        PROVIDER_FALLBACK_LABEL[bucket.provider];
      const instanceId = matchingSource?.instanceId ?? null;
      const source = sourceAccumulator.get(sourceKey) ?? {
        sourceId,
        label: sourceLabel,
        provider: bucket.provider,
        instanceId,
        costUsd: 0,
        totalTokens: 0,
        records: 0,
      };
      source.costUsd += bucket.costUsd;
      source.totalTokens += tokens;
      source.records += bucket.records;
      sourceAccumulator.set(sourceKey, source);

      // Keyed by account as well as model: two Claude subscriptions running the same model are two
      // separate lines of spend, and one merged row cannot say which account is doing the spending.
      const modelKey = `${bucket.provider}\u0000${sourceKey}\u0000${bucket.model}`;
      const model = modelAccumulator.get(modelKey) ?? {
        model: bucket.model,
        provider: bucket.provider,
        sourceId,
        sourceLabel,
        instanceId,
        costUsd: 0,
        totalTokens: 0,
        records: 0,
      };
      model.costUsd += bucket.costUsd;
      model.totalTokens += tokens;
      model.records += bucket.records;
      modelAccumulator.set(modelKey, model);

      const day = dailyAccumulator.get(bucket.day) ?? {
        costUsd: 0,
        totalTokens: 0,
        byProvider: new Map<UsageProviderKind, { costUsd: number; totalTokens: number }>(),
      };
      day.costUsd += bucket.costUsd;
      day.totalTokens += tokens;
      const dayProvider = day.byProvider.get(bucket.provider) ?? { costUsd: 0, totalTokens: 0 };
      dayProvider.costUsd += bucket.costUsd;
      dayProvider.totalTokens += tokens;
      day.byProvider.set(bucket.provider, dayProvider);
      dailyAccumulator.set(bucket.day, day);

      if (bucket.hourStart !== undefined) {
        const hour = hourlyAccumulator.get(bucket.hourStart) ?? {
          day: bucket.day,
          hourStart: bucket.hourStart,
          costUsd: 0,
          totalTokens: 0,
          byProvider: new Map<UsageProviderKind, { costUsd: number; totalTokens: number }>(),
        };
        hour.costUsd += bucket.costUsd;
        hour.totalTokens += tokens;
        const hourProvider = hour.byProvider.get(bucket.provider) ?? {
          costUsd: 0,
          totalTokens: 0,
        };
        hourProvider.costUsd += bucket.costUsd;
        hourProvider.totalTokens += tokens;
        hour.byProvider.set(bucket.provider, hourProvider);
        hourlyAccumulator.set(bucket.hourStart, hour);
      }
    }
  }

  const totalTokens = uncachedInputTokens + cachedInputTokens + cacheCreationTokens + outputTokens;

  const providers: ProviderTotals[] = [...providerAccumulator.entries()]
    .map(([provider, totals]) => ({
      provider,
      costUsd: totals.costUsd,
      totalTokens: totals.totalTokens,
      records: totals.records,
      sessions: totals.sessions,
      costShare: costUsd === 0 ? 0 : totals.costUsd / costUsd,
      tokenShare: totalTokens === 0 ? 0 : totals.totalTokens / totalTokens,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);

  const sources: UsageSourceTotals[] = [...sourceAccumulator.values()]
    .map((source) => ({
      ...source,
      instanceId: source.instanceId,
      costShare: costUsd === 0 ? 0 : source.costUsd / costUsd,
    }))
    .sort((a, b) => b.costUsd - a.costUsd || a.label.localeCompare(b.label));

  const models: ModelTotals[] = [...modelAccumulator.values()]
    .map((totals) => ({
      model: totals.model,
      provider: totals.provider,
      sourceId: totals.sourceId,
      sourceLabel: totals.sourceLabel,
      instanceId: totals.instanceId,
      costUsd: totals.costUsd,
      totalTokens: totals.totalTokens,
      records: totals.records,
      costShare: costUsd === 0 ? 0 : totals.costUsd / costUsd,
    }))
    .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);

  const daily: DailyTotals[] = [...dailyAccumulator.entries()]
    .map(([day, totals]) => ({
      day,
      costUsd: totals.costUsd,
      totalTokens: totals.totalTokens,
      byProvider: totals.byProvider,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const hourly: HourlyTotals[] = [...hourlyAccumulator.values()].sort((a, b) =>
    a.hourStart.localeCompare(b.hourStart),
  );

  return {
    costUsd,
    uncachedInputTokens,
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    records,
    sessions,
    providers,
    sources,
    models,
    daily,
    hourly,
    costQuality: {
      providerReportedShare: records === 0 ? 0 : providerReportedRecords / records,
      unpricedShare: records === 0 ? 0 : unpricedRecords / records,
      modelPricedShare:
        records === 0 ? 0 : (records - providerReportedRecords - unpricedRecords) / records,
      cacheSavingsUsd,
    },
    duplicateSources: duplicates,
    contributingEnvironments,
    staleEnvironments,
  };
}
