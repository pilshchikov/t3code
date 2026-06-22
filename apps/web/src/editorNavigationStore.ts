import type { EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

const MAX_RECENT_FILES_PER_WORKSPACE = 100;
const EDITOR_NAVIGATION_STORAGE_KEY = "t3code:editor-navigation:v1";

export interface RecentEditorFile {
  readonly path: string;
  readonly openedAt: number;
}

export interface EditorNavigationRequest {
  readonly workspaceKey: string;
  readonly path: string;
  readonly lineNumber: number;
  readonly column: number;
  readonly requestId: number;
}

interface EditorNavigationState {
  recentFilesByWorkspace: Record<string, RecentEditorFile[]>;
  navigationRequest: EditorNavigationRequest | null;
  recordRecentFile: (environmentId: EnvironmentId, cwd: string, path: string) => void;
  navigateTo: (
    environmentId: EnvironmentId,
    cwd: string,
    target: { readonly path: string; readonly lineNumber?: number; readonly column?: number },
  ) => void;
}

export function editorWorkspaceKey(environmentId: EnvironmentId, cwd: string): string {
  return `${encodeURIComponent(environmentId)}|${encodeURIComponent(cwd)}`;
}

export const useEditorNavigationStore = create<EditorNavigationState>()(
  persist(
    (set) => ({
      recentFilesByWorkspace: {},
      navigationRequest: null,
      recordRecentFile: (environmentId, cwd, path) =>
        set((state) => {
          const workspaceKey = editorWorkspaceKey(environmentId, cwd);
          const current = state.recentFilesByWorkspace[workspaceKey] ?? [];
          return {
            recentFilesByWorkspace: {
              ...state.recentFilesByWorkspace,
              [workspaceKey]: [
                { path, openedAt: Date.now() },
                ...current.filter((entry) => entry.path !== path),
              ].slice(0, MAX_RECENT_FILES_PER_WORKSPACE),
            },
          };
        }),
      navigateTo: (environmentId, cwd, target) =>
        set((state) => {
          const workspaceKey = editorWorkspaceKey(environmentId, cwd);
          const current = state.recentFilesByWorkspace[workspaceKey] ?? [];
          return {
            navigationRequest: {
              workspaceKey,
              path: target.path,
              lineNumber: Math.max(1, target.lineNumber ?? 1),
              column: Math.max(0, target.column ?? 0),
              requestId: (state.navigationRequest?.requestId ?? 0) + 1,
            },
            recentFilesByWorkspace: {
              ...state.recentFilesByWorkspace,
              [workspaceKey]: [
                { path: target.path, openedAt: Date.now() },
                ...current.filter((entry) => entry.path !== target.path),
              ].slice(0, MAX_RECENT_FILES_PER_WORKSPACE),
            },
          };
        }),
    }),
    {
      name: EDITOR_NAVIGATION_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ recentFilesByWorkspace: state.recentFilesByWorkspace }),
    },
  ),
);
