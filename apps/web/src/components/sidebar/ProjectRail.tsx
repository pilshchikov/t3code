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

export const PROJECT_RAIL_WIDTH = "3.25rem";

const ITEM_CLASS =
  // The focus ring is inset: an offset ring would sit on the neighbouring
  // project in a column this narrow.
  "relative grid size-9 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-md border border-transparent text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset aria-[current=true]:border-sidebar-border aria-[current=true]:bg-sidebar-row-selected";

/** Every project icon gets the same box, whatever shape its favicon is. */
const ICON_BOX_CLASS = "grid size-4.5 place-items-center overflow-hidden";

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
      // Same token overrides the thread sidebar uses, so both columns share one
      // surface instead of the rail landing on the raised card colour.
      data-app-sidebar=""
      className="flex h-svh w-13 shrink-0 flex-col items-center gap-1 border-e border-sidebar-border bg-sidebar pt-[var(--project-rail-top-inset,0.5rem)] pb-2 text-sidebar-foreground"
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
              <span className={ICON_BOX_CLASS}>
                <LayersIcon className="size-4.5" />
              </span>
            </button>
          }
        />
        <TooltipPopup side="right">All projects</TooltipPopup>
      </Tooltip>

      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                    <span className={ICON_BOX_CLASS}>
                      <ProjectFavicon project={group} className="size-full" />
                    </span>
                    {isLive ? (
                      <span
                        aria-hidden="true"
                        className="absolute end-0.5 top-0.5 size-1.5 rounded-full bg-primary"
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

      <div className="flex shrink-0 flex-col items-center gap-1 pt-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Add project"
                className={cn(ITEM_CLASS, "hover:text-sidebar-foreground")}
                onClick={() => openCommandPalette({ open: "add-project" })}
              >
                <span className={ICON_BOX_CLASS}>
                  <PlusIcon className="size-4.5" />
                </span>
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
                className={cn(ITEM_CLASS, "hover:text-sidebar-foreground")}
                onClick={() => setVisible(false)}
              >
                <span className={ICON_BOX_CLASS}>
                  <PanelLeftCloseIcon className="size-4.5" />
                </span>
              </button>
            }
          />
          <TooltipPopup side="right">Hide project rail</TooltipPopup>
        </Tooltip>
      </div>
    </nav>
  );
});
