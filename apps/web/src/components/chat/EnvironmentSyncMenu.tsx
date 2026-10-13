import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  findEnvironmentSyncTargetProject,
  selectEnvironmentSyncThreadIds,
} from "@t3tools/client-runtime/state/environment-sync";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  ENVIRONMENT_SYNC_DEFAULT_DIRECTORY,
  type EnvironmentId,
  type EnvironmentSyncImportResult,
  type ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import {
  projectFolderName,
  startEnvironmentSync,
  type EnvironmentSyncRequest,
} from "../../lib/environmentSyncRunner";
import {
  readThreadShell,
  readThreadShells,
  useProjects,
  useThreadShell,
  waitForThreadShell,
} from "../../state/entities";
import { environmentSyncEnvironment } from "../../state/environmentSync";
import {
  useEnvironmentMachines,
  useEnvironments,
  type EnvironmentPresentation,
} from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { stackedThreadToast, toastManager } from "../ui/toast";

/** What happens once the project is on the other machine. */
type SyncIntent = "continue" | "new-thread" | "sync";

interface EnvironmentSyncMenuProps {
  environmentId: EnvironmentId;
  /** Null on a draft, which has no thread to carry over yet. */
  threadId: ThreadId | null;
  project: EnvironmentProject | null;
}

function supportsSync(environment: EnvironmentPresentation | undefined): boolean {
  return environment?.serverConfig?.environment.capabilities.environmentSync === true;
}

function joinPath(directory: string, name: string): string {
  const separator = directory.includes("\\") && !directory.includes("/") ? "\\" : "/";
  return directory.endsWith(separator) ? `${directory}${name}` : `${directory}${separator}${name}`;
}

/**
 * Moves the work in view to another machine. The project is copied with its
 * branches and uncommitted changes, and its threads keep their history, so the
 * same conversation continues there with a fresh agent session.
 */
export const EnvironmentSyncMenu = memo(function EnvironmentSyncMenu({
  environmentId,
  threadId,
  project,
}: EnvironmentSyncMenuProps) {
  const navigate = useNavigate();
  const handleNewThread = useNewThreadHandler();
  const { environments } = useEnvironments();
  const machines = useEnvironmentMachines();
  const projects = useProjects();
  const undoSync = useAtomCommand(environmentSyncEnvironment.undo, { reportFailure: false });
  const canUndo = useAtomValue(environmentSyncEnvironment.undo.permissionAtom(environmentId));
  const [destination, setDestination] = useState<{
    readonly target: EnvironmentPresentation;
    readonly intent: SyncIntent;
    readonly path: string;
  } | null>(null);

  const current = environments.find((environment) => environment.environmentId === environmentId);
  const others = environments.filter((environment) => environment.environmentId !== environmentId);

  const openThread = useCallback(
    async (targetEnvironmentId: EnvironmentId, targetThreadId: ThreadId) => {
      const ref = scopeThreadRef(targetEnvironmentId, targetThreadId);
      if (!(await waitForThreadShell(ref, 15_000))) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "The thread has not appeared yet",
            description: "Open it from the sidebar once the other machine finishes loading.",
          }),
        );
        return;
      }
      await navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
    },
    [navigate],
  );

  const run = useCallback(
    async (input: {
      readonly source: EnvironmentPresentation;
      readonly target: EnvironmentPresentation;
      readonly sourceProject: EnvironmentProject;
      readonly intent: SyncIntent;
      readonly destinationPath: string | null;
    }) => {
      const { source, target, sourceProject, intent } = input;
      const targetProject = findEnvironmentSyncTargetProject({
        sourceProject,
        targetEnvironmentId: target.environmentId,
        projects,
      });
      const pushing = source.environmentId === environmentId;
      // Read when the sync starts. The list changes all the time and the menu must not follow it.
      const viewed =
        threadId === null ? null : readThreadShell(scopeThreadRef(source.environmentId, threadId));
      const rootThreadIds = selectEnvironmentSyncThreadIds({
        projectId: sourceProject.id,
        threads: readThreadShells().filter(
          (thread) => thread.environmentId === source.environmentId,
        ),
        // A subagent thread travels with the conversation that started it.
        currentThreadId: viewed?.lineage.rootThreadId ?? null,
      });
      const afterSync = (result: EnvironmentSyncImportResult) => {
        if (intent === "new-thread") {
          void handleNewThread(scopeProjectRef(target.environmentId, result.projectId));
        } else if (intent === "continue" && threadId !== null) {
          void openThread(target.environmentId, threadId);
        }
      };
      const request: EnvironmentSyncRequest = {
        source: { environmentId: source.environmentId, label: source.label },
        target: { environmentId: target.environmentId, label: target.label },
        project: {
          projectId: sourceProject.id,
          title: sourceProject.title,
          workspaceRoot: sourceProject.workspaceRoot,
        },
        targetProjectId: targetProject?.id ?? null,
        destinationPath: input.destinationPath,
        rootThreadIds,
        // Continuing one thread only needs that thread's checkout.
        includeProjectCheckout: intent !== "continue",
        ...(intent === "sync" && pushing && threadId !== null
          ? {
              followUp: {
                label: `Open on ${target.label}`,
                run: () => void openThread(target.environmentId, threadId),
              },
            }
          : {}),
      };
      const outcome = await startEnvironmentSync(request);
      if (outcome === null) {
        toastManager.add(
          stackedThreadToast({
            type: "info",
            title: `Already syncing ${sourceProject.title} to ${target.label}`,
          }),
        );
        return;
      }
      if (outcome.status !== "synced" || intent === "sync") return;
      if (intent === "continue" && threadId !== null) {
        const action = outcome.result.threads.find(
          (thread) => thread.threadId === threadId,
        )?.action;
        if (action === "busy") {
          toastManager.add(
            stackedThreadToast({
              type: "warning",
              title: "This thread is still working",
              description: `Wait for it to finish or stop it, then continue on ${target.label}.`,
            }),
          );
          return;
        }
        if (action === "diverged") {
          toastManager.add(
            stackedThreadToast({
              type: "warning",
              title: "This thread changed on both machines",
              description: `Neither copy was changed. Open the one on ${target.label} to continue from there.`,
              actionProps: {
                children: `Open on ${target.label}`,
                onClick: () => void openThread(target.environmentId, threadId),
              },
            }),
          );
          return;
        }
      }
      afterSync(outcome.result);
    },
    [environmentId, handleNewThread, openThread, projects, threadId],
  );

  const begin = useCallback(
    (target: EnvironmentPresentation, intent: SyncIntent) => {
      if (current === undefined || project === null) return;
      const targetProject = findEnvironmentSyncTargetProject({
        sourceProject: project,
        targetEnvironmentId: target.environmentId,
        projects,
      });
      if (targetProject !== null) {
        void run({
          source: current,
          target,
          sourceProject: project,
          intent,
          destinationPath: null,
        });
        return;
      }
      // The first sync creates the project there, so the user confirms where it goes.
      const configured = target.serverConfig?.settings.environmentSyncDirectory ?? "";
      setDestination({
        target,
        intent,
        path: joinPath(
          configured === "" ? ENVIRONMENT_SYNC_DEFAULT_DIRECTORY : configured,
          projectFolderName(project.workspaceRoot),
        ),
      });
    },
    [current, project, projects, run],
  );

  const pull = useCallback(
    (from: EnvironmentPresentation, sourceProject: EnvironmentProject) => {
      if (current === undefined) return;
      void run({
        source: from,
        target: current,
        sourceProject,
        intent: "sync",
        destinationPath: null,
      });
    },
    [current, run],
  );

  const undo = useCallback(async () => {
    if (project === null || current === undefined) return;
    const result = await undoSync({ environmentId, input: { projectId: project.id } });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not undo the sync",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
      return;
    }
    const { restoredCheckouts, warnings } = result.value;
    toastManager.add(
      stackedThreadToast({
        type: warnings.length > 0 ? "warning" : "success",
        title: `Restored ${project.title} on ${current.label}`,
        description: [
          restoredCheckouts.length === 0
            ? "No checkout needed restoring."
            : `Put back ${restoredCheckouts.join(", ")}.`,
          "Threads keep the history they received.",
          ...warnings,
        ].join(" "),
      }),
    );
  }, [current, environmentId, project, undoSync]);

  if (current === undefined || project === null || project.isScratch || !supportsSync(current)) {
    return null;
  }

  return (
    <>
      <Menu>
        <MenuTrigger
          render={<Button variant="ghost" size="xs" aria-label="Machine for this project" />}
        >
          <EnvironmentMachineIcon kind={machines.get(environmentId) ?? "server"} />
          <span className="max-w-32 truncate">{current.label}</span>
          <ChevronDownIcon aria-hidden />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuGroup>
            <MenuGroupLabel>
              {threadId === null ? "This project is on" : "This thread runs on"} {current.label}
            </MenuGroupLabel>
          </MenuGroup>
          <MenuSeparator />
          {others.length === 0 ? (
            <MenuItem onClick={() => void navigate({ to: "/settings/connections" })}>
              Connect another machine…
            </MenuItem>
          ) : (
            others.map((other) => (
              <OtherEnvironmentItems
                key={other.environmentId}
                environment={other}
                project={project}
                projects={projects}
                threadId={threadId}
                onBegin={begin}
                onPull={pull}
                onOpen={openThread}
              />
            ))
          )}
          <MenuSeparator />
          <MenuItem disabled={!canUndo} onClick={() => void undo()}>
            Undo last sync on {current.label}
          </MenuItem>
          <MenuItem onClick={() => void navigate({ to: "/settings/storage" })}>
            Synced projects folder…
          </MenuItem>
        </MenuPopup>
      </Menu>

      <Dialog
        open={destination !== null}
        onOpenChange={(open) => {
          if (!open) setDestination(null);
        }}
      >
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Copy {project.title} to {destination?.target.label}
            </DialogTitle>
            <DialogDescription>
              {destination?.target.label} does not have this project yet. Git history, branches, and
              uncommitted changes are copied. Files Git ignores are not, such as installed
              dependencies and .env files.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-foreground">
                Folder on {destination?.target.label}
              </span>
              <Input
                autoCapitalize="none"
                spellCheck={false}
                value={destination?.path ?? ""}
                onChange={(event) =>
                  setDestination((previous) =>
                    previous === null ? null : { ...previous, path: event.target.value },
                  )
                }
              />
            </label>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDestination(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={(destination?.path.trim() ?? "") === ""}
              onClick={() => {
                if (destination === null) return;
                setDestination(null);
                void run({
                  source: current,
                  target: destination.target,
                  sourceProject: project,
                  intent: destination.intent,
                  destinationPath: destination.path.trim(),
                });
              }}
            >
              Copy project
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
});

function OtherEnvironmentItems({
  environment,
  project,
  projects,
  threadId,
  onBegin,
  onPull,
  onOpen,
}: {
  environment: EnvironmentPresentation;
  project: EnvironmentProject;
  projects: ReadonlyArray<EnvironmentProject>;
  threadId: ThreadId | null;
  onBegin: (target: EnvironmentPresentation, intent: SyncIntent) => void;
  onPull: (from: EnvironmentPresentation, sourceProject: EnvironmentProject) => void;
  onOpen: (environmentId: EnvironmentId, threadId: ThreadId) => Promise<void>;
}) {
  const machines = useEnvironmentMachines();
  const canSync = useAtomValue(
    environmentSyncEnvironment.prepare.permissionAtom(environment.environmentId),
  );
  const copyRef = useMemo(
    () => (threadId === null ? null : scopeThreadRef(environment.environmentId, threadId)),
    [environment.environmentId, threadId],
  );
  const copy = useThreadShell(copyRef);
  const icon = (
    <EnvironmentMachineIcon kind={machines.get(environment.environmentId) ?? "server"} />
  );
  const unavailable =
    environment.connection.phase !== "connected"
      ? "offline"
      : !supportsSync(environment)
        ? "needs an update"
        : !canSync
          ? "no permission"
          : null;
  if (unavailable !== null) {
    return (
      <MenuItem disabled>
        {icon}
        {environment.label} · {unavailable}
      </MenuItem>
    );
  }
  const theirProject = findEnvironmentSyncTargetProject({
    sourceProject: project,
    targetEnvironmentId: environment.environmentId,
    projects,
  });
  const syncedAt = copy?.source.environmentSync?.syncedAt;

  return (
    <MenuSub>
      <MenuSubTrigger>
        {icon}
        {environment.label}
      </MenuSubTrigger>
      <MenuSubPopup>
        {copy !== null ? (
          <MenuGroup>
            <MenuGroupLabel>
              {syncedAt === undefined
                ? "This thread is also there"
                : `Copied there ${formatRelativeTimeLabel(syncedAt)}`}
            </MenuGroupLabel>
          </MenuGroup>
        ) : null}
        {threadId !== null ? (
          <MenuItem onClick={() => onBegin(environment, "continue")}>
            Continue this thread there
          </MenuItem>
        ) : null}
        <MenuItem onClick={() => onBegin(environment, "new-thread")}>New thread there</MenuItem>
        <MenuItem onClick={() => onBegin(environment, "sync")}>Sync project there</MenuItem>
        {theirProject !== null ? (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => onPull(environment, theirProject)}>
              Update this machine from {environment.label}
            </MenuItem>
          </>
        ) : null}
        {threadId !== null && copy !== null ? (
          <MenuItem onClick={() => void onOpen(environment.environmentId, threadId)}>
            Open the copy without syncing
          </MenuItem>
        ) : null}
      </MenuSubPopup>
    </MenuSub>
  );
}
