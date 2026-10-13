import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { findEnvironmentSyncTargetProject } from "@t3tools/client-runtime/state/environment-sync";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { ENVIRONMENT_SYNC_DEFAULT_DIRECTORY, type EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon } from "lucide-react";
import { memo, useCallback, useState } from "react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import {
  canEnvironmentSync,
  projectFolderName,
  syncProjectToEnvironment,
} from "../../lib/environmentSyncRunner";
import { useProjects } from "../../state/entities";
import { environmentSyncEnvironment } from "../../state/environmentSync";
import {
  useEnvironmentMachines,
  useEnvironments,
  type EnvironmentPresentation,
} from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
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

interface EnvironmentSyncMenuProps {
  environmentId: EnvironmentId;
  project: EnvironmentProject | null;
}

interface SyncRequest {
  readonly from: EnvironmentPresentation;
  readonly to: EnvironmentPresentation;
  readonly project: EnvironmentProject;
  /** Open a new thread on the target once the project is there. */
  readonly thenNewThread: boolean;
}

function joinPath(directory: string, name: string): string {
  const separator = directory.includes("\\") && !directory.includes("/") ? "\\" : "/";
  return directory.endsWith(separator) ? `${directory}${name}` : `${directory}${separator}${name}`;
}

/**
 * Copies the project in view to another machine, or brings that machine's
 * state here. The repository travels with every checkout as it stands. Threads
 * stay on the machine where they ran.
 */
export const EnvironmentSyncMenu = memo(function EnvironmentSyncMenu({
  environmentId,
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
    readonly request: SyncRequest;
    readonly path: string;
  } | null>(null);

  const current = environments.find((environment) => environment.environmentId === environmentId);
  const others = environments.filter((environment) => environment.environmentId !== environmentId);

  const run = useCallback(
    async (request: SyncRequest, destinationPath: string | null) => {
      const synced = await syncProjectToEnvironment({
        source: request.from,
        target: request.to,
        project: request.project,
        destinationPath,
      });
      if (synced !== null && request.thenNewThread) {
        void handleNewThread(scopeProjectRef(synced.environmentId, synced.id));
      }
    },
    [handleNewThread],
  );

  const begin = useCallback(
    (request: SyncRequest) => {
      const there = findEnvironmentSyncTargetProject({
        sourceProject: request.project,
        targetEnvironmentId: request.to.environmentId,
        projects,
      });
      if (there !== null) {
        void run(request, null);
        return;
      }
      // The first sync creates the project there, so the user confirms where it goes.
      const configured = request.to.serverConfig?.settings.environmentSyncDirectory ?? "";
      setDestination({
        request,
        path: joinPath(
          configured === "" ? ENVIRONMENT_SYNC_DEFAULT_DIRECTORY : configured,
          projectFolderName(request.project.workspaceRoot),
        ),
      });
    },
    [projects, run],
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
          ...warnings,
        ].join(" "),
      }),
    );
  }, [current, environmentId, project, undoSync]);

  if (
    current === undefined ||
    project === null ||
    project.isScratch ||
    !canEnvironmentSync(current)
  ) {
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
            <MenuGroupLabel>Sync {project.title}</MenuGroupLabel>
          </MenuGroup>
          {others.length === 0 ? (
            <MenuItem onClick={() => void navigate({ to: "/settings/connections" })}>
              Connect another machine…
            </MenuItem>
          ) : (
            others.map((other) => {
              const icon = (
                <EnvironmentMachineIcon kind={machines.get(other.environmentId) ?? "server"} />
              );
              if (!canEnvironmentSync(other)) {
                return (
                  <MenuItem key={other.environmentId} disabled>
                    {icon}
                    {other.label} ·{" "}
                    {other.connection.phase === "connected" ? "needs an update" : "offline"}
                  </MenuItem>
                );
              }
              const theirs = findEnvironmentSyncTargetProject({
                sourceProject: project,
                targetEnvironmentId: other.environmentId,
                projects,
              });
              return (
                <MenuSub key={other.environmentId}>
                  <MenuSubTrigger>
                    {icon}
                    {other.label}
                  </MenuSubTrigger>
                  <MenuSubPopup>
                    <MenuItem
                      onClick={() =>
                        begin({ from: current, to: other, project, thenNewThread: true })
                      }
                    >
                      New thread on {other.label}
                    </MenuItem>
                    <MenuItem
                      onClick={() =>
                        begin({ from: current, to: other, project, thenNewThread: false })
                      }
                    >
                      Send files to {other.label}
                    </MenuItem>
                    {theirs !== null ? (
                      <MenuItem
                        onClick={() =>
                          begin({ from: other, to: current, project: theirs, thenNewThread: false })
                        }
                      >
                        Get files from {other.label}
                      </MenuItem>
                    ) : null}
                  </MenuSubPopup>
                </MenuSub>
              );
            })
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
              Copy {project.title} to {destination?.request.to.label}
            </DialogTitle>
            <DialogDescription>
              {destination?.request.to.label} does not have this project yet. Git history, branches,
              worktrees, and uncommitted changes are copied. Files Git ignores are not, such as
              installed dependencies and .env files.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-foreground">
                Folder on {destination?.request.to.label}
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
                void run(destination.request, destination.path.trim());
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
