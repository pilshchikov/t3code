import { useState } from "react";
import type { CustomEditorCommand } from "@t3tools/contracts";
import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { SettingsRow, SettingsSection } from "./settingsLayout";

export function CustomEditorSettings() {
  const config = useClientSettings((settings) => settings.customEditorCommand);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (next: CustomEditorCommand | null) => {
    setSaving(true);
    setError(null);
    try {
      await updateClientSettings({
        customEditorCommand: next,
        preferredEditor: next === null ? "openidea" : "custom",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the command.");
    }
    setSaving(false);
  };
  return (
    <CustomEditorForm
      key={JSON.stringify(config)}
      config={config}
      saving={saving}
      error={error}
      save={save}
    />
  );
}

function CustomEditorForm({
  config,
  saving,
  error,
  save,
}: {
  config: CustomEditorCommand | null;
  saving: boolean;
  error: string | null;
  save: (next: CustomEditorCommand | null) => Promise<void>;
}) {
  const [command, setCommand] = useState(config?.command ?? "");
  const [args, setArgs] = useState(config?.args.join("\n") ?? "{path}");
  return (
    <SettingsSection id="open-in" title="Open in">
      <p className="px-4 py-3 text-sm text-muted-foreground">
        OpenIDEA is the default when installed. Choose another editor from any Open in menu. A
        custom command runs on the selected local environment; remote projects keep their SSH editor
        options.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save({ command: command.trim(), args: args === "" ? [] : args.split(/\r?\n/) });
        }}
      >
        <SettingsRow
          title="Custom command"
          description="Executable name or full path, without quotes. For example: open"
        >
          <Input
            aria-label="Custom editor executable"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="/path/to/your/editor"
          />
        </SettingsRow>
        <SettingsRow
          title="Arguments"
          description="One argument per line. Use {path}, {line}, {column}, or {target} (path with position). The path is added if omitted. For example: -a, OpenIDEA, and {path} on separate lines."
        >
          <Textarea
            aria-label="Custom editor arguments"
            value={args}
            onChange={(event) => setArgs(event.target.value)}
          />
        </SettingsRow>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2 px-4 pb-4">
          <Button
            type="button"
            variant="outline"
            disabled={saving || config === null}
            onClick={() => void save(null)}
          >
            Remove command
          </Button>
          <Button type="submit" disabled={saving || command.trim().length === 0}>
            {saving ? "Saving…" : "Save and use command"}
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}
