import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { select, queries, pages, refresh } = vi.hoisted(() => ({
  select: vi.fn(),
  queries: vi.fn(),
  pages: new Map(),
  refresh: vi.fn(),
}));
vi.mock("~/state/threads", () => ({ threadEnvironment: { workspaceSelect: {} } }));
vi.mock("~/state/vcs", () => ({
  vcsEnvironment: { listRefs: ({ input }: { input: unknown }) => input },
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => select }));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (input: { cwd: string; cursor?: number }) => {
    queries(input);
    return {
      data: pages.get(`${input.cwd}:${input.cursor ?? 0}`),
      refresh,
      isPending: false,
      error: null,
    };
  },
}));
vi.mock("~/components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));
vi.mock("~/components/ui/menu", () => {
  const box = ({ children, ...props }: { children?: ReactNode }) => (
    <div {...props}>{children}</div>
  );
  return Object.fromEntries(
    [
      "Menu",
      "MenuGroup",
      "MenuGroupLabel",
      "MenuItem",
      "MenuPopup",
      "MenuRadioGroup",
      "MenuRadioItem",
      "MenuTrigger",
    ].map((name) => [name, box]),
  );
});
import { FileWorktreeToolbar } from "./FileWorktreeToolbar";

const environmentId = EnvironmentId.make("selectors");
const threadRef = { environmentId, threadId: ThreadId.make("multi-repo") };
const root = (name: string) => ({
  path: `/${name}`,
  workspaceRoot: `/${name}`,
  label: name,
  branch: "main",
  primary: name === "frontend",
});
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  select.mockReset().mockResolvedValue({ _tag: "Success", value: { cwd: "/backend/task" } });
  queries.mockClear();
  pages.clear();
  for (const name of ["frontend", "backend"])
    pages.set(`/${name}:0`, {
      isRepo: true,
      refs: [
        { name: "main", current: true, worktreePath: `/${name}` },
        { name: "task", current: false, worktreePath: `/${name}/task` },
      ],
      nextCursor: null,
    });
});
afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("repository checkout controls", () => {
  it("sends the selected repository identity and leaves the primary control unchanged", async () => {
    await act(async () => {
      renderer = create(
        <>
          <FileWorktreeToolbar
            environmentId={environmentId}
            threadRef={threadRef}
            root={root("frontend")}
          />
          <FileWorktreeToolbar
            environmentId={environmentId}
            threadRef={threadRef}
            root={root("backend")}
          />
        </>,
      );
    });
    const controls = renderer!.root.findAll(
      (node) => node.type === "div" && node.props["data-file-worktree-selector"],
    );
    const radio = controls[1]!.find(
      (node) => node.type === "div" && typeof node.props.onValueChange === "function",
    );
    await act(async () => {
      radio.props.onValueChange("/backend/task");
    });
    expect(select).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { threadId: threadRef.threadId, workspaceRoot: "/backend", path: "/backend/task" },
    });
    const primary = controls[0]!.find(
      (node) => node.type === "div" && typeof node.props.onValueChange === "function",
    );
    expect(primary.props.value).toBe("/frontend");
    expect(queries).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/backend" }));
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("Multiwork");
  });
  it("loads additional branch pages and selects a branch by repository", async () => {
    pages.set("/backend:0", { ...pages.get("/backend:0"), nextCursor: 200 });
    pages.set("/backend:200", {
      isRepo: true,
      refs: [{ name: "older", current: false, worktreePath: null }],
      nextCursor: null,
    });
    await act(async () => {
      renderer = create(
        <FileWorktreeToolbar
          environmentId={environmentId}
          threadRef={threadRef}
          root={root("backend")}
        />,
      );
    });
    const more = renderer!.root.find(
      (node) => node.type === "div" && node.children.includes("Load more branches"),
    );
    await act(async () => {
      more.props.onClick();
    });
    expect(queries).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/backend", cursor: 200 }));
    const older = renderer!.root.find(
      (node) =>
        node.type === "div" &&
        typeof node.props.onClick === "function" &&
        node.findAll((child) => child.type === "span" && child.children.includes("older")).length >
          0,
    );
    await act(async () => {
      older.props.onClick();
    });
    expect(select).toHaveBeenCalledWith({
      environmentId,
      input: { threadId: threadRef.threadId, workspaceRoot: "/backend", branch: "older" },
    });
  });
});
