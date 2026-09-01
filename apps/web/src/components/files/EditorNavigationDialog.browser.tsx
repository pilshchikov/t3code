import "../../index.css";

import { EnvironmentId, type ProjectEntry } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { editorWorkspaceKey, useEditorNavigationStore } from "~/editorNavigationStore";

const { searchCode, searchEntries } = vi.hoisted(() => ({
  searchCode: vi.fn(),
  searchEntries: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("~/commandPaletteContext", () => ({
  isCommandPaletteOpen: () => false,
  useOpenCommandPalette: () => vi.fn(),
}));

vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: () => ({ showEditorTabs: true }),
  useUpdateClientSettings: () => vi.fn(),
}));

vi.mock("~/state/projects", () => ({
  projectEnvironment: {
    searchCode: "searchCode",
    searchEntries: "searchEntries",
  },
}));

vi.mock("~/state/use-atom-query-runner", () => ({
  useAtomQueryRunner: (family: string) => (family === "searchCode" ? searchCode : searchEntries),
}));

import { EditorNavigationDialog } from "./EditorNavigationDialog";

const environmentId = EnvironmentId.make("local");
const cwd = "/workspace";
const entries: ProjectEntry[] = [
  { path: "src/TeamService.ts", kind: "file" },
  { path: "README.md", kind: "file" },
];

function dispatchShiftRelease(): void {
  window.dispatchEvent(
    new KeyboardEvent("keyup", {
      key: "Shift",
      bubbles: true,
      cancelable: true,
    }),
  );
}

function renderDialog() {
  return render(
    <EditorNavigationDialog
      environmentId={environmentId}
      cwd={cwd}
      projectName="workspace"
      entries={entries}
      onOpenFile={vi.fn()}
      onToggleExplorer={vi.fn()}
      onRefreshFiles={vi.fn()}
    />,
  );
}

describe("EditorNavigationDialog", () => {
  beforeEach(() => {
    searchEntries.mockResolvedValue({
      _tag: "Success",
      value: { entries: [], truncated: false },
    });
    searchCode.mockResolvedValue({
      _tag: "Success",
      value: { matches: [], truncated: false },
    });
    useEditorNavigationStore.setState({ recentFilesByWorkspace: {}, navigationRequest: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens Search Everywhere on Double Shift with all IDEA-style scopes", async () => {
    const screen = await renderDialog();

    dispatchShiftRelease();
    dispatchShiftRelease();

    const dialog = page.getByRole("dialog", { name: "Search Everywhere" });
    await expect.element(dialog).toBeVisible();
    for (const scope of ["All", "Classes", "Files", "Symbols", "Actions", "Text"]) {
      await expect.element(dialog.getByRole("button", { name: scope })).toBeVisible();
    }
    expect(dialog.element().getBoundingClientRect().width).toBeGreaterThan(300);

    await screen.unmount();
  });

  it("searches symbols and renders their source location", async () => {
    searchCode.mockImplementation((target: { input: { scope: string } }) =>
      Promise.resolve({
        _tag: "Success",
        value: {
          matches:
            target.input.scope === "symbols"
              ? [
                  {
                    path: "src/TeamService.ts",
                    lineNumber: 12,
                    column: 2,
                    snippet: "class TeamService {",
                    isDefinition: true,
                    kind: "class",
                  },
                ]
              : [],
          truncated: false,
        },
      }),
    );
    const screen = await renderDialog();
    dispatchShiftRelease();
    dispatchShiftRelease();

    const symbolsTab = page.getByRole("button", { name: "Symbols" });
    await symbolsTab.click();
    await page.getByRole("textbox", { name: "Search everywhere" }).fill("team");

    await expect.element(page.getByText("TeamService", { exact: true })).toBeVisible();
    await expect.element(page.getByText("src/TeamService.ts:12", { exact: true })).toBeVisible();

    await screen.unmount();
  });

  it("lists project files on Double Shift before typing and opens the clicked file", async () => {
    const onOpenFile = vi.fn();
    const screen = await render(
      <EditorNavigationDialog
        environmentId={environmentId}
        cwd={cwd}
        projectName="workspace"
        entries={entries}
        onOpenFile={onOpenFile}
        onToggleExplorer={vi.fn()}
        onRefreshFiles={vi.fn()}
      />,
    );

    dispatchShiftRelease();
    dispatchShiftRelease();

    // No recent files and an empty query: the dialog must still surface the workspace's files so
    // there is something to select (regression guard for the empty Double-Shift dialog bug).
    await page.getByText("TeamService.ts", { exact: true }).click();

    expect(onOpenFile).toHaveBeenCalledWith("src/TeamService.ts");

    await screen.unmount();
  });

  it("opens a file result via Double Shift search", async () => {
    searchEntries.mockResolvedValue({
      _tag: "Success",
      value: {
        entries: [{ path: "src/TeamService.ts", kind: "file" }],
        truncated: false,
      },
    });
    const onOpenFile = vi.fn();
    const screen = await render(
      <EditorNavigationDialog
        environmentId={environmentId}
        cwd={cwd}
        projectName="workspace"
        entries={entries}
        onOpenFile={onOpenFile}
        onToggleExplorer={vi.fn()}
        onRefreshFiles={vi.fn()}
      />,
    );

    dispatchShiftRelease();
    dispatchShiftRelease();

    await page.getByRole("textbox", { name: "Search everywhere" }).fill("team");
    await page.getByText("TeamService.ts", { exact: true }).click();

    expect(onOpenFile).toHaveBeenCalledWith("src/TeamService.ts");

    await screen.unmount();
  });

  it("opens persisted recent files with Cmd+E", async () => {
    useEditorNavigationStore.setState({
      recentFilesByWorkspace: {
        [editorWorkspaceKey(environmentId, cwd)]: [
          { path: "src/TeamService.ts", openedAt: Date.now() },
        ],
      },
    });
    const screen = await renderDialog();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "e",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    await expect.element(page.getByRole("dialog", { name: "Recent Files" })).toBeVisible();
    await expect.element(page.getByText("TeamService.ts", { exact: true })).toBeVisible();

    await screen.unmount();
  });
});
