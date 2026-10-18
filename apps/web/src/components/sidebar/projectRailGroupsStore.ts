import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";
import { sanitizeRailGroups, type RailGroup } from "./projectRailGroups.logic";

/**
 * Rail groups stay on this device, like the rail's manual project order they
 * are laid over.
 */
interface ProjectRailGroupsState {
  groups: ReadonlyArray<RailGroup>;
  setGroups: (groups: ReadonlyArray<RailGroup>) => void;
}

export const useProjectRailGroupsStore = create<ProjectRailGroupsState>()(
  persist(
    (set) => ({
      groups: [],
      setGroups: (groups) => set({ groups: sanitizeRailGroups(groups) }),
    }),
    {
      name: "t3code:project-rail-groups:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ groups: state.groups }),
      merge: (persisted, current) => ({
        ...current,
        groups: sanitizeRailGroups((persisted as { groups?: unknown } | undefined)?.groups),
      }),
    },
  ),
);
