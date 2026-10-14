// @vitest-environment jsdom
import { act, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type {
  CommunicationSelection,
  ThreadCommunication,
} from "@t3tools/client-runtime/state/thread-communication";
import { AgentCommunicationDialog } from "./AgentCommunicationDialog";
import { AgentCommunicationView } from "./AgentCommunicationView";

const env = EnvironmentId.make("local");
const model: ThreadCommunication = {
  rootId: "parent",
  participants: ["parent", "auditor", "recorder"].map((id) => ({
    id,
    label: id === "parent" ? "Lead agent" : id === "auditor" ? "Auditor" : "Recorder",
    environmentId: env,
    environmentLabel: "Laptop",
    threadId: ThreadId.make(id),
    parentId: id === "parent" ? null : "parent",
    status: "completed",
    model: "sonnet",
  })),
  messages: [
    {
      id: "task",
      from: "parent",
      to: "auditor",
      text: "Check the reconnect behavior.",
      summary: "Task assigned",
      kind: "delegation",
      state: "sent",
      at: "2026-10-14T20:00:00Z",
    },
    {
      id: "ask",
      from: "auditor",
      to: "recorder",
      text: "What happens if the connection closes?",
      summary: "Compare findings",
      kind: "message",
      state: "sent",
      at: "2026-10-14T20:01:00Z",
    },
    {
      id: "answer",
      from: "recorder",
      to: "auditor",
      text: "The watch reconnects without duplicate delivery.",
      summary: null,
      kind: "response",
      state: "received",
      at: "2026-10-14T20:02:00Z",
    },
  ],
};
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
let shortPhone = false;
let root: Root;
let container: HTMLDivElement;
function button(label: string) {
  const matches = [...document.querySelectorAll<HTMLButtonElement>("button")].filter(
    (b) => b.getAttribute("aria-label") === label || b.textContent?.trim() === label,
  );
  expect(matches).toHaveLength(1);
  return matches[0]!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
function Viewer() {
  const [selection, select] = useState<CommunicationSelection>({ kind: "all" });
  return <AgentCommunicationView model={model} selection={selection} onSelect={select} />;
}

describe("communication dialog interactions", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    shortPhone = false;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (media: string) => ({
        media,
        matches: shortPhone,
        addEventListener() {},
        removeEventListener() {},
      }),
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia);
    else Reflect.deleteProperty(window, "matchMedia");
  });
  it("opens from its panel button, filters a sibling connection, hides the map and closes", async () => {
    await act(async () =>
      root.render(<AgentCommunicationDialog>{() => <Viewer />}</AgentCommunicationDialog>),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click("Agent communication");
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Who’s coordinating");
    await click("Read connection between Auditor and Recorder");
    const messages = document.querySelector('[aria-label="Messages between agents"]')!;
    expect(messages.textContent).toContain("What happens if the connection closes?");
    expect(messages.textContent).toContain("without duplicate delivery");
    expect(messages.textContent).not.toContain("Check the reconnect behavior.");
    await click("Hide map");
    expect(document.querySelector('[aria-label="Agents in the map"]')).toBeNull();
    await click("Close");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("receives new exchanges while open, preserves the chosen connection, and releases its viewer on close", async () => {
    let mountedViewers = 0;
    let publish: Dispatch<SetStateAction<ThreadCommunication>> | undefined;
    function LiveViewer() {
      const [current, setCurrent] = useState(model);
      const [selection, select] = useState<CommunicationSelection>({ kind: "all" });
      useEffect(() => {
        mountedViewers++;
        publish = setCurrent;
        return () => {
          mountedViewers--;
          publish = undefined;
        };
      }, []);
      return <AgentCommunicationView model={current} selection={selection} onSelect={select} />;
    }
    await act(async () =>
      root.render(<AgentCommunicationDialog>{() => <LiveViewer />}</AgentCommunicationDialog>),
    );
    expect(mountedViewers).toBe(0);
    await click("Agent communication");
    expect(mountedViewers).toBe(1);
    await click("Read connection between Auditor and Recorder");
    await act(async () =>
      publish?.({
        ...model,
        messages: [
          ...model.messages,
          {
            id: "follow-up",
            from: "auditor",
            to: "recorder",
            text: "Confirmed after reconnect.",
            summary: null,
            kind: "message",
            state: "received",
            at: "2026-10-14T20:03:00Z",
          },
        ],
      }),
    );
    const messages = document.querySelector('[aria-label="Messages between agents"]')!;
    expect(messages.textContent).toContain("Confirmed after reconnect.");
    expect(messages.textContent).toContain("What happens if the connection closes?");
    expect(messages.textContent).not.toContain("Check the reconnect behavior.");
    await click("Close");
    expect(mountedViewers).toBe(0);
    expect(publish).toBeUndefined();
    await click("Agent communication");
    expect(mountedViewers).toBe(1);
    await click("Close");
    expect(mountedViewers).toBe(0);
  });
  it("keeps messages readable on a short phone and lets the user expand its map", async () => {
    shortPhone = true;
    await act(async () =>
      root.render(<AgentCommunicationDialog>{() => <Viewer />}</AgentCommunicationDialog>),
    );
    await click("Agent communication");
    expect(document.querySelector('[aria-label="Agents in the map"]')).toBeNull();
    expect(document.querySelector('[aria-label="Messages between agents"]')?.textContent).toContain(
      "Check the reconnect behavior.",
    );
    await click("Show map");
    expect(document.querySelector('[aria-label="Agents in the map"]')).not.toBeNull();
    await click("Hide map");
    expect(document.querySelector('[aria-label="Agents in the map"]')).toBeNull();
  });
  it("opens an empty thread without requiring a setting or an existing exchange", async () => {
    await act(async () =>
      root.render(
        <AgentCommunicationDialog>
          {() => (
            <AgentCommunicationView
              model={{ rootId: "parent", participants: [], messages: [] }}
              selection={{ kind: "all" }}
              onSelect={() => {}}
            />
          )}
        </AgentCommunicationDialog>,
      ),
    );
    await click("Agent communication");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "No recorded communication",
    );
  });
});
