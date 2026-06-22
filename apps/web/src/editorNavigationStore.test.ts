import { EnvironmentId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { editorWorkspaceKey, useEditorNavigationStore } from "./editorNavigationStore";

const environmentId = EnvironmentId.make("local");
const cwd = "/workspace";

describe("editorNavigationStore", () => {
  beforeEach(() => {
    useEditorNavigationStore.setState({ recentFilesByWorkspace: {}, navigationRequest: null });
  });

  it("keeps recently opened files in most-recent-first order without duplicates", () => {
    const store = useEditorNavigationStore.getState();
    store.recordRecentFile(environmentId, cwd, "src/first.ts");
    store.recordRecentFile(environmentId, cwd, "src/second.ts");
    store.recordRecentFile(environmentId, cwd, "src/first.ts");

    expect(
      useEditorNavigationStore
        .getState()
        .recentFilesByWorkspace[editorWorkspaceKey(environmentId, cwd)]?.map((entry) => entry.path),
    ).toEqual(["src/first.ts", "src/second.ts"]);
  });

  it("records a line-targeted navigation request and promotes the target to recent", () => {
    useEditorNavigationStore.getState().navigateTo(environmentId, cwd, {
      path: "src/service.ts",
      lineNumber: 42,
      column: 7,
    });

    const state = useEditorNavigationStore.getState();
    expect(state.navigationRequest).toMatchObject({
      workspaceKey: editorWorkspaceKey(environmentId, cwd),
      path: "src/service.ts",
      lineNumber: 42,
      column: 7,
    });
    expect(state.recentFilesByWorkspace[editorWorkspaceKey(environmentId, cwd)]?.[0]?.path).toBe(
      "src/service.ts",
    );
  });
});
