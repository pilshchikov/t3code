import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useSidebarProjectScope } from "./useSidebarProjectScope";

let root: Root | undefined;
let container: HTMLDivElement;
let scope: ReturnType<typeof useSidebarProjectScope>;
function Probe() {
  const value = useSidebarProjectScope();
  useLayoutEffect(() => {
    scope = value;
  });
  return null;
}
async function mount() {
  root = createRoot(container);
  await act(async () => root!.render(<Probe />));
}
async function unmount() {
  await act(async () => root?.unmount());
  root = undefined;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.body.appendChild(document.createElement("div"));
});
afterEach(async () => {
  await unmount();
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("retains the chosen project across closing and reopening the mobile sheet", async () => {
  await mount();
  expect(scope[0]).toBeNull();
  await act(async () => scope[1]("environment:my-project"));
  expect(scope[0]).toBe("environment:my-project");
  await unmount();
  await mount();
  expect(scope[0]).toBe("environment:my-project");
  await act(async () => scope[1](null));
  await unmount();
  await mount();
  expect(scope[0]).toBeNull();
});
