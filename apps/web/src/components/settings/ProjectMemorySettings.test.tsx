import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { ReactElement } from "react";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";

const state = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
  entries: [] as Array<{ name: string; description: string; updatedAt: string }>,
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { ...actual, useState: reactHookHarness.useState };
});
vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});
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
vi.mock("../ui/button", () => ({ Button: "button" }));
vi.mock("../ui/input", () => ({ Input: "input" }));
vi.mock("../ui/textarea", () => ({ Textarea: "textarea" }));
import { ProjectMemorySettings } from "./ProjectMemorySettings";

const environmentId = EnvironmentId.make("test");
const projectId = ProjectId.make("test-project");
const render = () => {
  hooks.beginRender();
  return ProjectMemorySettings({ environmentId, projectId });
};
function find<P>(
  root: ReactElement,
  match: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<P> {
  let found: ReactElement<P> | undefined;
  visitElements(root, (element) => {
    if (match(element)) found = element as ReactElement<P>;
    return false;
  });
  if (!found) throw new Error("Element not found");
  return found;
}
const click = (root: ReactElement, text: string) =>
  find<{ onClick: () => unknown }>(
    root,
    (element) => element.type === "button" && element.props.children === text,
  ).props.onClick();
const submit = (root: ReactElement) =>
  find<{ onSubmit: (event: { preventDefault: () => void }) => Promise<void> }>(
    root,
    (element) => element.type === "form",
  ).props.onSubmit({ preventDefault: vi.fn() });

beforeEach(() => {
  hooks.reset();
  vi.clearAllMocks();
  state.entries = [];
});

it("loads content for editing and preserves the draft when saving fails", async () => {
  state.entries = [{ name: "hosts", description: "Before deployment", updatedAt: "today" }];
  state.read.mockResolvedValue({
    _tag: "Success",
    value: { ...state.entries[0], content: "Inventory location" },
  });
  await click(render(), "Edit");
  let panel = render();
  const editor = find<{ value: string; onChange: (event: { target: { value: string } }) => void }>(
    panel,
    (element) => element.type === "textarea",
  );
  expect(editor.props.value).toBe("Inventory location");
  editor.props.onChange({ target: { value: "Updated location" } });
  panel = render();
  state.save.mockResolvedValue({ _tag: "Failure" });
  await submit(panel);
  panel = render();
  expect(find<{ value: string }>(panel, (element) => element.type === "textarea").props.value).toBe(
    "Updated location",
  );
  expect(
    find<{ children: string }>(panel, (element) => element.props.role === "alert").props.children,
  ).toBe("Could not save memory.");
  state.save.mockResolvedValue({ _tag: "Success", value: {} });
  await submit(panel);
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
  expect(() => find(render(), (element) => element.type === "textarea")).toThrow();
});

it("requires confirmation before deleting a memory", async () => {
  state.entries = [{ name: "hosts", description: "Before deployment", updatedAt: "today" }];
  click(render(), "Delete");
  expect(state.remove).not.toHaveBeenCalled();
  click(render(), "Cancel");
  expect(state.remove).not.toHaveBeenCalled();
  click(render(), "Delete");
  state.remove.mockResolvedValue({ _tag: "Success" });
  await click(render(), "Delete");
  expect(state.remove).toHaveBeenCalledWith({ environmentId, input: { projectId, name: "hosts" } });
  expect(state.refresh).toHaveBeenCalledOnce();
});
