import "~/index.css";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";

const projectGroups = vi.hoisted(() =>
  ["alpha", "beta", "gamma"].map((name) => ({
    id: name,
    environmentId: "local",
    projectKey: `local:${name}`,
    displayName: name,
    title: name,
    workspaceRoot: `/work/${name}`,
    faviconPath: null,
    projectIcon: null,
    memberProjects: [{ id: name, environmentId: "local", physicalProjectKey: `local:${name}` }],
    memberProjectRefs: [{ environmentId: "local", projectId: name }],
  })),
);

vi.mock(import("./useSidebarProjectGroups"), () => ({
  useSidebarProjectGroups: () => ({
    projectGroups: projectGroups as unknown as ReadonlyArray<SidebarProjectSnapshot>,
    orderedProjectKeys: projectGroups.map((project) => project.projectKey),
  }),
}));
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: () => [],
  useThreadShells: () => [],
}));
vi.mock(import("../../hooks/useMediaQuery"), async (original) => ({
  ...(await original()),
  useIsMobile: () => false,
}));
vi.mock(import("../ProjectFavicon"), () => ({
  ProjectFavicon: () => <span data-testid="favicon" />,
}));
vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useRouter: (() => ({ navigate: async () => {} })) as never,
  useLocation: (() => "/") as never,
}));

import { ProjectRail } from "./ProjectRail";
import { useProjectRailGroupsStore } from "./projectRailGroupsStore";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  useProjectRailGroupsStore.setState({
    groups: [
      {
        id: "rg-1",
        name: "Trading",
        color: "green",
        collapsed: false,
        members: ["local:beta", "local:gamma"],
      },
    ],
  });
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.querySelectorAll("[data-level]").forEach((menu) => menu.remove());
  localStorage.clear();
  vi.unstubAllGlobals();
});

const rail = () => container.querySelector<HTMLElement>("[data-project-rail]")!;
const groupHead = () =>
  container.querySelector<HTMLButtonElement>('[data-rail="ga-chip"], [data-rail="gc-head"]')!;

it("folds a group from its label and keeps folded projects out of reach", async () => {
  await act(async () => root.render(<ProjectRail />));
  expect(rail().dataset.groupStyle).toBe("edge");
  expect(groupHead().textContent).toContain("Trading");
  expect(groupHead().getAttribute("aria-expanded")).toBe("true");

  await act(async () => groupHead().click());

  expect(groupHead().getAttribute("aria-expanded")).toBe("false");
  expect(useProjectRailGroupsStore.getState().groups[0]?.collapsed).toBe(true);
  const inner = container.querySelector('[data-rail="ga-inner"]')!;
  expect(inner.hasAttribute("inert")).toBe(true);
  expect(groupHead().textContent).toContain("2");
});

it("switches between the short and the named rail", async () => {
  await act(async () => root.render(<ProjectRail />));
  expect(rail().dataset.named).toBe("false");
  expect(container.querySelector('[data-rail="row"]')).toBeNull();

  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Show names"]')!.click(),
  );

  expect(rail().dataset.named).toBe("true");
  const rows = [...container.querySelectorAll('[data-rail="row"]')].map((row) => row.textContent);
  expect(rows).toEqual(["alpha", "beta", "gamma"]);
  expect(groupHead().dataset.rail).toBe("gc-head");
  expect(JSON.parse(localStorage.getItem("t3code:sidebar:project-rail-layout")!)).toMatchObject({
    named: true,
  });
});

it("opens a project menu that can group the project", async () => {
  await act(async () => root.render(<ProjectRail />));
  const alpha = container.querySelector<HTMLButtonElement>('button[aria-label="alpha"]')!;

  await act(async () => {
    alpha.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 40 }),
    );
  });
  await vi.waitFor(() => expect(document.body.textContent).toContain("Add to group"));
  expect(document.body.textContent).toContain("Project settings");
});
