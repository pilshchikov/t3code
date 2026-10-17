import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { userEvent } from "vite-plus/test/browser";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
  entries: [] as Array<{ name: string; description: string; updatedAt: string }>,
}));
vi.mock("../../state/projectMemory", () => ({
  projectMemory: { list: () => null, read: state.read, save: state.save, remove: state.remove },
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: state.entries,
    error: null,
    isPending: false,
    refresh: state.refresh,
  }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
import { ProjectMemorySettings } from "./ProjectMemorySettings";

const environmentId = EnvironmentId.make("test");
const projectId = ProjectId.make("test-project");
let root: Root;
let container: HTMLDivElement;

async function render() {
  await act(async () =>
    root.render(<ProjectMemorySettings environmentId={environmentId} projectId={projectId} />),
  );
}
function buttons(label: string) {
  return [...container.querySelectorAll("button")].filter(
    (element) => element.textContent === label,
  );
}
async function click(label: string, index = 0) {
  const target = buttons(label)[index];
  expect(target, `button ${label}`).toBeDefined();
  await act(async () => target!.click());
}
const editor = () => container.querySelector("textarea");
const alert = () => container.querySelector('[role="alert"]');
async function submit() {
  await act(async () => container.querySelector("form")!.requestSubmit());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.entries = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("loads content for editing and preserves the draft when saving fails", async () => {
  state.entries = [{ name: "hosts", description: "Before deployment", updatedAt: "today" }];
  state.read.mockResolvedValue({
    _tag: "Success",
    value: { ...state.entries[0], content: "Inventory location" },
  });
  await render();
  await click("Edit");
  expect(editor()?.value).toBe("Inventory location");
  await act(async () => {
    await userEvent.clear(editor()!);
    await userEvent.type(editor()!, "Updated location");
  });
  state.save.mockResolvedValue({ _tag: "Failure" });
  await submit();
  expect(editor()?.value).toBe("Updated location");
  expect(alert()?.textContent).toBe("Could not save memory.");
  state.save.mockResolvedValue({ _tag: "Success", value: {} });
  await submit();
  expect(state.save).toHaveBeenLastCalledWith({
    environmentId,
    input: {
      projectId,
      name: "hosts",
      description: "Before deployment",
      content: "Updated location",
    },
  });
  expect(state.refresh).toHaveBeenCalledOnce();
  expect(editor()).toBeNull();
});

it("requires confirmation before deleting a memory", async () => {
  state.entries = [{ name: "hosts", description: "Before deployment", updatedAt: "today" }];
  await render();
  await click("Delete");
  expect(state.remove).not.toHaveBeenCalled();
  await click("Cancel");
  expect(state.remove).not.toHaveBeenCalled();
  await click("Delete");
  state.remove.mockResolvedValue({ _tag: "Success" });
  await click("Delete", 1);
  expect(state.remove).toHaveBeenCalledWith({ environmentId, input: { projectId, name: "hosts" } });
  expect(state.refresh).toHaveBeenCalledOnce();
});
