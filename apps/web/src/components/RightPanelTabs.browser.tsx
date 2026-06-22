import "../index.css";

import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import type { RightPanelSurface } from "~/rightPanelStore";

import { RightPanelTabs } from "./RightPanelTabs";

const surfaces: RightPanelSurface[] = [
  { id: "files", kind: "files" },
  { id: "file:src/index.ts", kind: "file", relativePath: "src/index.ts" },
];

function renderTabs(showTabs: boolean) {
  return render(
    <RightPanelTabs
      mode="sheet"
      showTabs={showTabs}
      surfaces={surfaces}
      activeSurfaceId="file:src/index.ts"
      pendingSurfaceIds={new Set()}
      previewSessions={{}}
      terminalLabelsById={new Map()}
      onActivate={vi.fn()}
      onCloseSurface={vi.fn()}
      onCloseOtherSurfaces={vi.fn()}
      onCloseSurfacesToRight={vi.fn()}
      onCloseAllSurfaces={vi.fn()}
      onCopyFilePath={vi.fn()}
      onAddBrowser={vi.fn()}
      onAddTerminal={vi.fn()}
      onAddDiff={vi.fn()}
      onAddFiles={vi.fn()}
      browserAvailable
      diffAvailable
      filesAvailable
    >
      <div>Active surface</div>
    </RightPanelTabs>,
  );
}

describe("RightPanelTabs", () => {
  it("replaces the tab strip with a compact surface switcher when tabs are hidden", async () => {
    const screen = await renderTabs(false);

    expect(screen.container.querySelector("[data-right-panel-tab-list]")).toBeNull();
    expect(screen.container.querySelector("[data-right-panel-compact-navigation]")).not.toBeNull();

    await page.getByRole("button", { name: "Switch panel surface" }).click();
    await expect.element(page.getByRole("menuitem", { name: "index.ts" })).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "Files" })).toBeVisible();

    await screen.unmount();
  });

  it("keeps the normal tab strip when tabs are enabled", async () => {
    const screen = await renderTabs(true);

    expect(screen.container.querySelector("[data-right-panel-tab-list]")).not.toBeNull();
    expect(screen.container.querySelector("[data-right-panel-compact-navigation]")).toBeNull();

    await screen.unmount();
  });
});
