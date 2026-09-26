import { memo, useCallback, useMemo } from "react";
import { useLocation, useRouter } from "@tanstack/react-router";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { LayersIcon, PanelLeftCloseIcon, PlusIcon } from "lucide-react";

import { openCommandPalette } from "../../commandPaletteBus";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { useSidebarProjectScope } from "../../hooks/useSidebarProjectScope";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useThreadShells } from "../../state/entities";
import { useUiStateStore } from "../../uiStateStore";
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

function ProjectRailItem({
  group,
  isCurrent,
  isLive,
  onSelect,
}: {
  group: SidebarProjectSnapshot;
  isCurrent: boolean;
  isLive: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.projectKey,
  });
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            ref={setNodeRef}
            type="button"
            aria-current={isCurrent}
            aria-label={group.displayName}
            className={cn(ITEM_CLASS, isDragging && "z-20 opacity-80")}
            style={{ transform: CSS.Translate.toString(transform), transition }}
            onClick={onSelect}
            {...attributes}
            {...listeners}
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
}

/**
 * A column of project icons left of the sidebar, so switching project is one
 * click instead of opening the picker first. Desktop only: the mobile sidebar
 * is a sheet with no room beside it.
 *
 * The rail always uses the manual project order, whatever the sidebar's sort is
 * set to, and drag reorders it. An icon that moves on its own is a target that
 * cannot be learned.
 */
export const ProjectRail = memo(function ProjectRail() {
  const isMobile = useIsMobile();
  const [visible, setVisible] = useProjectRailVisible();
  const { projectGroups, orderedProjectKeys } = useSidebarProjectGroups({ sortOrder: "manual" });
  const threads = useThreadShells();
  const [projectScopeKey, setProjectScopeKey] = useSidebarProjectScope();
  const reorderProjects = useUiStateStore((store) => store.reorderProjects);
  const router = useRouter();
  const pathname = useLocation({ select: (location) => location.pathname });

  const liveProjectKeys = useMemo(() => projectKeysWithLiveWork(threads), [threads]);
  // A short threshold, so a click still selects rather than starting a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const dragged = projectGroups.find((group) => group.projectKey === active.id);
      const target = projectGroups.find((group) => group.projectKey === over.id);
      if (!dragged || !target) return;
      reorderProjects(
        orderedProjectKeys,
        dragged.memberProjects.map((member) => member.physicalProjectKey),
        target.memberProjects.map((member) => member.physicalProjectKey),
      );
    },
    [orderedProjectKeys, projectGroups, reorderProjects],
  );

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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={projectGroups.map((group) => group.projectKey)}
            strategy={verticalListSortingStrategy}
          >
            {projectGroups.map((group) => (
              <ProjectRailItem
                key={group.projectKey}
                group={group}
                isCurrent={projectScopeKey === group.projectKey}
                isLive={group.memberProjects.some((member) =>
                  liveProjectKeys.has(`${member.environmentId}:${member.id}`),
                )}
                onSelect={() => selectScope(group.projectKey)}
              />
            ))}
          </SortableContext>
        </DndContext>
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
