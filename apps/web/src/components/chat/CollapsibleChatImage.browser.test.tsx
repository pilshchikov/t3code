import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { CollapsibleChatImage } from "./CollapsibleChatImage";

let root: Root | undefined;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.body.appendChild(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  vi.unstubAllGlobals();
});

async function mount(element: ReactElement) {
  root = createRoot(container);
  await act(async () => root!.render(element));
}
async function update(element: ReactElement) {
  await act(async () => root!.render(element));
}
async function unmount() {
  await act(async () => root?.unmount());
  root = undefined;
}
const images = () => container.querySelectorAll("img");
const toggleButton = () => container.querySelector("button")!;

describe("CollapsibleChatImage", () => {
  const screenshot = (key: string, src = "white.png") => (
    <CollapsibleChatImage imageKey={key} label="Site screenshot">
      <img src={src} alt="Site screenshot" />
    </CollapsibleChatImage>
  );
  const toggle = async () => {
    await act(async () => toggleButton().click());
  };

  it("removes the bright image and restores it on demand", async () => {
    await mount(screenshot("toggle"));
    expect(images()).toHaveLength(1);
    await toggle();
    expect(images()).toHaveLength(0);
    expect(toggleButton().getAttribute("aria-expanded")).toBe("false");
    await toggle();
    expect(images()).toHaveLength(1);
  });

  it("stays hidden across row remounts and signed URL refreshes without hiding other images", async () => {
    await mount(screenshot("virtualized"));
    await toggle();
    await unmount();
    await mount(screenshot("virtualized", "white.png?new-signature"));
    expect(images()).toHaveLength(0);
    await update(screenshot("other-image"));
    expect(images()).toHaveLength(1);
    await update(screenshot("virtualized"));
    await toggle();
    expect(images()).toHaveLength(1);
  });
});
