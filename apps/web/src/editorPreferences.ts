import {
  AuthOrchestrationOperateScope,
  AuthTerminalOperateScope,
  EDITORS,
  EditorId,
  type LaunchEditorInput,
  EnvironmentAuthorizationError,
  EnvironmentId,
} from "@t3tools/contracts";
import {
  mapAtomCommandResult,
  type AtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";
import { getLocalStorageItem, setLocalStorageItem, useLocalStorage } from "./hooks/useLocalStorage";
import { shellEnvironment } from "./state/shell";
import { useAtomCommand } from "./state/use-atom-command";
import { readEnvironmentScope } from "./state/session";

import { getClientSettings, updateClientSettings, useClientSettings } from "./hooks/useSettings";

const LAST_EDITOR_KEY = "t3code:last-editor";

export class PreferredEditorEnvironmentRequiredError extends Schema.TaggedError<PreferredEditorEnvironmentRequiredError>()(
  "PreferredEditorEnvironmentRequiredError",
  {
    targetPath: Schema.String,
  },
) {
  override get message(): string {
    return `Cannot open ${this.targetPath} because no environment is selected.`;
  }
}

export class PreferredEditorUnavailableError extends Schema.TaggedError<PreferredEditorUnavailableError>()(
  "PreferredEditorUnavailableError",
  {
    environmentId: EnvironmentId,
    targetPath: Schema.String,
    availableEditorIds: Schema.Array(EditorId),
  },
) {
  override get message(): string {
    return `No available editor can open ${this.targetPath} in environment ${this.environmentId}.`;
  }
}

function chooseEditor(
  availableEditors: readonly EditorId[],
  preferred: EditorId,
  stored: EditorId | null,
  hasCustom: boolean,
): EditorId | null {
  const available = new Set(availableEditors.filter((id) => id !== "custom" || hasCustom));
  if (available.has(preferred)) return preferred;
  if (stored && available.has(stored)) return stored;
  return EDITORS.find((editor) => available.has(editor.id))?.id ?? null;
}

export function editorLaunchInput(cwd: string, editor: EditorId): LaunchEditorInput {
  const customCommand = getClientSettings().customEditorCommand;
  return { cwd, editor, ...(editor === "custom" && customCommand ? { customCommand } : {}) };
}

export function usePreferredEditor(availableEditors: ReadonlyArray<EditorId>) {
  const [lastEditor, setLastEditor] = useLocalStorage(LAST_EDITOR_KEY, null, EditorId);

  const preferredEditor = useClientSettings((settings) => settings.preferredEditor);
  const customCommand = useClientSettings((settings) => settings.customEditorCommand);
  const effectiveEditor = chooseEditor(
    availableEditors,
    preferredEditor,
    lastEditor,
    customCommand !== null,
  );
  const setPreferredEditor = (editor: EditorId | null) => {
    setLastEditor(editor);
    void updateClientSettings({ preferredEditor: editor ?? "openidea" });
  };
  return [effectiveEditor, setPreferredEditor] as const;
}

function resolvePreferredEditor(availableEditors: readonly EditorId[]): EditorId | null {
  const settings = getClientSettings();
  const stored = getLocalStorageItem(LAST_EDITOR_KEY, EditorId);
  const editor = chooseEditor(
    availableEditors,
    settings.preferredEditor,
    stored,
    settings.customEditorCommand !== null,
  );
  return editor ?? null;
}

export function useOpenInPreferredEditor(
  environmentId: EnvironmentId | null,
  availableEditors: readonly EditorId[],
) {
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, {
    reportFailure: false,
  });
  type OpenInEditorError = AtomCommandFailure<Awaited<ReturnType<typeof openInEditor>>>;

  return async (
    targetPath: string,
  ): Promise<
    AtomCommandResult<
      EditorId,
      | OpenInEditorError
      | PreferredEditorEnvironmentRequiredError
      | PreferredEditorUnavailableError
      | EnvironmentAuthorizationError
    >
  > => {
    if (environmentId === null) {
      return AsyncResult.failure(
        Cause.fail(
          new PreferredEditorEnvironmentRequiredError({
            targetPath,
          }),
        ),
      );
    }
    if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
      return AsyncResult.failure(
        Cause.fail(
          new EnvironmentAuthorizationError({
            requiredScope: AuthOrchestrationOperateScope,
            message: "This connection cannot open an editor on this environment.",
          }),
        ),
      );
    }
    const editor = resolvePreferredEditor(availableEditors);
    if (!editor) {
      return AsyncResult.failure(
        Cause.fail(
          new PreferredEditorUnavailableError({
            environmentId,
            targetPath,
            availableEditorIds: availableEditors,
          }),
        ),
      );
    }
    if (editor === "custom" && !readEnvironmentScope(environmentId, AuthTerminalOperateScope)) {
      return AsyncResult.failure(
        Cause.fail(
          new EnvironmentAuthorizationError({
            requiredScope: AuthTerminalOperateScope,
            message: "This connection cannot run custom commands on this environment.",
          }),
        ),
      );
    }
    setLocalStorageItem(LAST_EDITOR_KEY, editor, EditorId);
    const result = await openInEditor({
      environmentId,
      input: editorLaunchInput(targetPath, editor),
    });
    return mapAtomCommandResult(result, () => editor);
  };
}
