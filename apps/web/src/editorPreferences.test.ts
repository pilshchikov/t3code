import {
  AuthOrchestrationOperateScope,
  AuthTerminalOperateScope,
  EnvironmentAuthorizationError,
  EnvironmentId,
  DEFAULT_CLIENT_SETTINGS,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { assert, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  settings: {} as typeof DEFAULT_CLIENT_SETTINGS,
  terminal: new Set<string>(),
  allowed: new Set<string>(),
  run: vi.fn(),
  getPreference: vi.fn(),
  setPreference: vi.fn(),
}));

vi.mock("./hooks/useSettings", () => ({
  getClientSettings: () => state.settings,
  useClientSettings: (select: (settings: typeof DEFAULT_CLIENT_SETTINGS) => unknown) =>
    select(state.settings),
  updateClientSettings: vi.fn(),
}));
vi.mock("react", () => ({ useCallback: (callback: unknown) => callback }));
vi.mock("./state/shell", () => ({ shellEnvironment: { openInEditor: "openInEditor" } }));
vi.mock("./state/use-atom-command", () => ({ useAtomCommand: () => state.run }));
vi.mock("./state/session", () => ({
  readEnvironmentScope: (environmentId: string, scope: string) =>
    (scope === AuthOrchestrationOperateScope && state.allowed.has(environmentId)) ||
    (scope === AuthTerminalOperateScope && state.terminal.has(environmentId)),
}));
vi.mock("./hooks/useLocalStorage", () => ({
  getLocalStorageItem: state.getPreference,
  setLocalStorageItem: state.setPreference,
  useLocalStorage: vi.fn(),
}));

import { useOpenInPreferredEditor } from "./editorPreferences";

const primary = EnvironmentId.make("primary");
const secondary = EnvironmentId.make("secondary");

beforeEach(() => {
  state.settings = { ...DEFAULT_CLIENT_SETTINGS };
  state.allowed.clear();
  state.terminal.clear();
  state.run.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.getPreference.mockReset().mockReturnValue(null);
  state.setPreference.mockReset();
});

it("does not use another environment's grant or change preferences when denied", async () => {
  state.allowed.add(primary);
  const open = useOpenInPreferredEditor(secondary, ["vscode"]);
  const result = await open("/work/readme.md");
  assert(result._tag === "Failure");
  const error = Cause.squash(result.cause);
  expect(error).toBeInstanceOf(EnvironmentAuthorizationError);
  expect(error).toMatchObject({ requiredScope: AuthOrchestrationOperateScope });
  expect(state.run).not.toHaveBeenCalled();
  expect(state.getPreference).not.toHaveBeenCalled();
  expect(state.setPreference).not.toHaveBeenCalled();
});

it("checks revocation and regrant when a retained editor callback is invoked", async () => {
  state.allowed.add(secondary);
  const open = useOpenInPreferredEditor(secondary, ["vscode"]);
  state.allowed.delete(secondary);
  expect((await open("/work/readme.md:5"))._tag).toBe("Failure");
  expect(state.run).not.toHaveBeenCalled();

  state.allowed.add(secondary);
  expect(await open("/work/readme.md:5")).toMatchObject({ _tag: "Success", value: "vscode" });
  expect(state.run).toHaveBeenCalledExactlyOnceWith({
    environmentId: secondary,
    input: { cwd: "/work/readme.md:5", editor: "vscode" },
  });
  expect(state.setPreference).toHaveBeenCalledTimes(1);
});

it("uses OpenIDEA by default even with an older saved editor, and preserves a new explicit choice", async () => {
  state.allowed.add(primary);
  state.getPreference.mockReturnValue("vscode");
  const open = useOpenInPreferredEditor(primary, ["cursor", "vscode", "openidea"]);
  expect(await open("/work/project")).toMatchObject({ _tag: "Success", value: "openidea" });
  state.settings = { ...state.settings, preferredEditor: "vscode" };
  expect(await open("/work/readme.md:9:2")).toMatchObject({ _tag: "Success", value: "vscode" });
});
it("only selects a configured custom command and reads its latest arguments at invocation", async () => {
  state.allowed.add(primary);
  state.settings = { ...state.settings, preferredEditor: "custom" };
  const open = useOpenInPreferredEditor(primary, ["custom", "vscode"]);
  expect(await open("/work/project")).toMatchObject({ _tag: "Success", value: "vscode" });
  state.settings = {
    ...state.settings,
    customEditorCommand: { command: "/custom/editor", args: ["--file", "{path}"] },
  };
  expect((await open("/work/a b.md:9:2"))._tag).toBe("Failure");
  state.terminal.add(primary);
  expect(await open("/work/a b.md:9:2")).toMatchObject({ _tag: "Success", value: "custom" });
  expect(state.run).toHaveBeenLastCalledWith({
    environmentId: primary,
    input: {
      cwd: "/work/a b.md:9:2",
      editor: "custom",
      customCommand: state.settings.customEditorCommand,
    },
  });
});
