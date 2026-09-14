import type { ThreadPullRequestLink } from "@t3tools/contracts";
import {
  normalizeThreadPullRequestKey,
  resolveThreadPullRequestChains,
  visibleThreadPullRequests,
} from "@t3tools/shared/threadPullRequests";
import { pullRequestListLines } from "./pullRequestListLines";

export function threadPullRequestsOverview(input: readonly ThreadPullRequestLink[]) {
  const unique = new Map<string, ThreadPullRequestLink>();
  for (const link of visibleThreadPullRequests(input)) {
    const key = normalizeThreadPullRequestKey(link);
    unique.set(JSON.stringify(key), link);
  }
  const links = [...unique.values()];
  const totals = {
    linked: links.length,
    open: 0,
    merged: 0,
    closed: 0,
    unknown: 0,
    attention: 0,
    branches: 0,
  };
  const repositories = new Map<
    string,
    { host: string; repository: string; links: ThreadPullRequestLink[] }
  >();
  for (const link of links) {
    const key = normalizeThreadPullRequestKey(link);
    const repositoryKey = JSON.stringify([key.host, key.repository]);
    let group = repositories.get(repositoryKey);
    if (!group) {
      group = { host: link.host, repository: link.repository, links: [] };
      repositories.set(repositoryKey, group);
    }
    group.links.push(link);
    const snapshot = link.snapshot;
    if (snapshot === null) totals.unknown++;
    else {
      totals[snapshot.state]++;
      if (
        snapshot.state === "open" &&
        (snapshot.checksState === "failing" ||
          snapshot.mergeability === "conflicting" ||
          snapshot.reviewDecision === "changes-requested")
      )
        totals.attention++;
    }
  }
  const groups = [...repositories.entries()]
    .map(([key, group]) => {
      const branches = new Set(
        group.links.flatMap((link) =>
          link.snapshot ? [link.snapshot.headBranch, link.snapshot.baseBranch] : [],
        ),
      );
      totals.branches += branches.size;
      return {
        ...group,
        key,
        branches: [...branches].sort(),
        lines: pullRequestListLines(resolveThreadPullRequestChains(group.links)),
      };
    })
    .sort((a, b) => a.repository.localeCompare(b.repository) || a.host.localeCompare(b.host));
  return { totals, groups };
}
