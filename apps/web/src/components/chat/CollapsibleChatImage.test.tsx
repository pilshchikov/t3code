import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { CollapsibleChatImage } from "./CollapsibleChatImage";

let renderer: ReactTestRenderer | undefined;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

describe("CollapsibleChatImage", () => {
  const screenshot = (key: string, src = "white.png") => (
    <CollapsibleChatImage imageKey={key} label="Site screenshot">
      <img src={src} alt="Site screenshot" />
    </CollapsibleChatImage>
  );
  const toggle = async () => {
    await act(() => renderer!.root.findByType("button").props.onClick({ stopPropagation() {} }));
  };

  it("removes the bright image and restores it on demand", async () => {
    await act(() => {
      renderer = create(screenshot("toggle"));
    });
    expect(renderer!.root.findAllByType("img")).toHaveLength(1);
    await toggle();
    expect(renderer!.root.findAllByType("img")).toHaveLength(0);
    expect(renderer!.root.findByType("button").props["aria-expanded"]).toBe(false);
    await toggle();
    expect(renderer!.root.findAllByType("img")).toHaveLength(1);
  });

  it("stays hidden across row remounts and signed URL refreshes without hiding other images", async () => {
    await act(() => {
      renderer = create(screenshot("virtualized"));
    });
    await toggle();
    await act(() => renderer!.unmount());
    await act(() => {
      renderer = create(screenshot("virtualized", "white.png?new-signature"));
    });
    expect(renderer!.root.findAllByType("img")).toHaveLength(0);
    await act(() => renderer!.update(screenshot("other-image")));
    expect(renderer!.root.findAllByType("img")).toHaveLength(1);
    await act(() => renderer!.update(screenshot("virtualized")));
    await toggle();
    expect(renderer!.root.findAllByType("img")).toHaveLength(1);
  });
});
