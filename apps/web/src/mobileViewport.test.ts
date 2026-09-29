// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { installMobileViewport } from "./mobileViewport";

describe("mobile viewport during keyboard focus", () => {
  let viewport: EventTarget & { height: number; offsetTop: number; scale: number };
  let nextFrame: FrameRequestCallback | null;
  let dispose: (() => void) | undefined;
  const originalViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");
  const originalHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
  const flush = () => {
    const callback = nextFrame;
    nextFrame = null;
    callback?.(0);
  };
  beforeEach(() => {
    viewport = Object.assign(new EventTarget(), { height: 852, offsetTop: 0, scale: 1 });
    nextFrame = null;
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 852 });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      nextFrame = callback;
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {
      nextFrame = null;
    });
  });
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.restoreAllMocks();
    if (originalViewport) Object.defineProperty(window, "visualViewport", originalViewport);
    else Reflect.deleteProperty(window, "visualViewport");
    if (originalHeight) Object.defineProperty(window, "innerHeight", originalHeight);
  });
  it("follows keyboard shrink and subsequent Safari panning without another resize", () => {
    dispose = installMobileViewport(window);
    viewport.height = 420;
    viewport.dispatchEvent(new Event("resize"));
    flush();
    expect(document.documentElement.style.getPropertyValue("--app-viewport-height")).toBe("420px");
    expect(document.documentElement.style.getPropertyValue("--app-safe-area-bottom")).toBe("0px");
    viewport.offsetTop = 432;
    viewport.dispatchEvent(new Event("scroll"));
    flush();
    expect(document.documentElement.style.getPropertyValue("--app-viewport-top")).toBe("432px");
    viewport.offsetTop = 0;
    viewport.height = 852;
    viewport.dispatchEvent(new Event("resize"));
    flush();
    expect(document.documentElement.style.getPropertyValue("--app-viewport-top")).toBe("0px");
    expect(document.documentElement.style.getPropertyValue("--app-viewport-height")).toBe("852px");
    expect(document.documentElement.style.getPropertyValue("--app-safe-area-bottom")).toBe(
      "env(safe-area-inset-bottom)",
    );
  });
  it("coalesces keyboard animation events and cancels pending work on unmount", () => {
    dispose = installMobileViewport(window);
    viewport.dispatchEvent(new Event("scroll"));
    viewport.dispatchEvent(new Event("resize"));
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    dispose();
    dispose = undefined;
    flush();
    expect(document.documentElement.style.getPropertyValue("--app-viewport-height")).toBe("");
    viewport.dispatchEvent(new Event("scroll"));
    expect(nextFrame).toBeNull();
  });
  it("leaves magnification to the browser and resumes after zoom ends", () => {
    dispose = installMobileViewport(window);
    viewport.scale = 2;
    viewport.height = 210;
    viewport.offsetTop = 50;
    viewport.dispatchEvent(new Event("resize"));
    flush();
    expect(document.documentElement.style.getPropertyValue("--app-viewport-height")).toBe("852px");
    viewport.scale = 1;
    viewport.height = 420;
    viewport.dispatchEvent(new Event("resize"));
    flush();
    expect(document.documentElement.style.getPropertyValue("--app-viewport-top")).toBe("50px");
  });
});
