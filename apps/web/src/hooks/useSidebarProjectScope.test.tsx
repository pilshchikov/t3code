import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useSidebarProjectScope } from "./useSidebarProjectScope";

let renderer: ReactTestRenderer | undefined;
let scope: ReturnType<typeof useSidebarProjectScope>;
function Probe() {
  const value = useSidebarProjectScope();
  useLayoutEffect(() => {
    scope = value;
  });
  return null;
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    }),
  );
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

it("retains the chosen project across closing and reopening the mobile sheet", () => {
  act(() => {
    renderer = create(<Probe />);
  });
  expect(scope[0]).toBeNull();
  act(() => scope[1]("environment:my-project"));
  expect(scope[0]).toBe("environment:my-project");
  act(() => renderer?.unmount());
  act(() => {
    renderer = create(<Probe />);
  });
  expect(scope[0]).toBe("environment:my-project");
  act(() => scope[1](null));
  act(() => renderer?.unmount());
  act(() => {
    renderer = create(<Probe />);
  });
  expect(scope[0]).toBeNull();
});
