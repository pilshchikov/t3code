import { memo, useMemo } from "react";
import { useLocation, useRouter } from "@tanstack/react-router";
import { LayersIcon, PanelLeftCloseIcon, PlusIcon } from "lucide-react";

import { openCommandPalette } from "../../commandPaletteBus";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { useSidebarProjectScope } from "../../hooks/useSidebarProjectScope";
import { useThreadShells } from "../../state/entities";
import { cn } from "~/lib/utils";
import { ProjectFavicon } from "../ProjectFavicon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { projectKeysWithLiveWork } from "./projectRail.logic";
import { useSidebarProjectGroups } from "./useSidebarProjectGroups";
import { useProjectRailVisible } from "./projectRailVisibility";

const ITEM_CLASS =
  "relative grid size-8.5 shrink-0 cursor-pointer place-items-center rounded-md border border-transparent text-muted-foreground transition-colors hover:bg-accent aria-[current=true]:border-border aria-[current=true]:bg-muted";

/**
 * A column of project icons left of the sidebar, so switching project is one
 * click instead of opening the picker first. Desktop only: the mobile sidebar
 * is a sheet with no room beside it.
 */
export const ProjectRail = memo(function ProjectRail() {
  const isMobile = useIsMobile();
  const [visible, setVisible] = useProjectRailVisible();
  const projectGroups = useSidebarProjectGroups();
  const threads = useThreadShells();
  const [projectScopeKey, setProjectScopeKey] = useSidebarProjectScope();
  const router = useRouter();
  const pathname = useLocation({ select: (location) => location.pathname });

  const liveProjectKeys = useMemo(() => projectKeysWithLiveWork(threads), [threads]);

  if (isMobile || !visible || projectGroups.length === 0) return null;

  const selectScope = (nextScopeKey: string | null) => {
    setProjectScopeKey(nextScopeKey);
    if (pathname.startsWith("/settings")) void router.navigate({ to: "/" });
  };

  return (
    <nav
      aria-label="Projects"
      data-project-rail=""
      className="flex h-full w-13 shrink-0 flex-col items-center gap-0.5 border-e border-border bg-sidebar py-2"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-current={projectScopeKey === null}
              aria-label="All projects"
              className={ITEM_CLASS}
              onClick={() => selectScope(null)}
            >
              <LayersIcon className="size-4.5" />
            </button>
          }
        />
        <TooltipPopup side="right">All projects</TooltipPopup>
      </Tooltip>

      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {projectGroups.map((group) => {
          const isLive = group.memberProjects.some((member) =>
            liveProjectKeys.has(`${member.environmentId}:${member.id}`),
          );
          return (
            <Tooltip key={group.projectKey}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-current={projectScopeKey === group.projectKey}
                    aria-label={group.displayName}
                    className={ITEM_CLASS}
                    onClick={() => selectScope(group.projectKey)}
                  >
                    <ProjectFavicon project={group} className="size-4.5" />
                    {isLive ? (
                      <span
                        aria-hidden="true"
                        className="absolute end-1 top-1 size-1.5 rounded-full bg-primary"
                      />
                    ) : null}
                  </button>
                }
              />
              <TooltipPopup side="right">{group.displayName}</TooltipPopup>
            </Tooltip>
          );
        })}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-0.5 pt-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Add project"
                className={cn(ITEM_CLASS, "hover:text-foreground")}
                onClick={() => openCommandPalette({ open: "add-project" })}
              >
                <PlusIcon className="size-4.5" />
              </button>
            }
          />
          <TooltipPopup side="right">Add project</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Hide project rail"
                className={cn(ITEM_CLASS, "hover:text-foreground")}
                onClick={() => setVisible(false)}
              >
                <PanelLeftCloseIcon className="size-4.5" />
              </button>
            }
          />
          <TooltipPopup side="right">Hide project rail</TooltipPopup>
        </Tooltip>
      </div>
    </nav>
  );
});
