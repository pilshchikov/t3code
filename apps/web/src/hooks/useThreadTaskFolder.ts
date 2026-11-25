import type { EnvironmentId, TaskFolder } from "@t3tools/contracts";

import { filesystemEnvironment } from "../state/filesystem";
import { useEnvironmentQuery } from "../state/query";

export function useThreadTaskFolder(input: {
  readonly environmentId: EnvironmentId | null | undefined;
  readonly worktreePath: string | null | undefined;
  readonly tracksFolders: boolean;
}): TaskFolder | null {
  const { environmentId, worktreePath, tracksFolders } = input;
  return (
    useEnvironmentQuery(
      environmentId && worktreePath && tracksFolders
        ? filesystemEnvironment.taskFolder({ environmentId, input: { worktreePath } })
        : null,
    ).data?.taskFolder ?? null
  );
}
