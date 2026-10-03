import { useState } from "react";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "../ui/number-field";
import { ScopedSwitch } from "./ScopedSwitch";
import { SettingsRow, SettingResetButton } from "./settingsLayout";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

function ThresholdField({
  value,
  min,
  max,
  label,
  onChange,
}: {
  value: number | null;
  min: number;
  max: number;
  label: string;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <NumberField
      value={draft}
      min={min}
      max={max}
      step={1}
      size="sm"
      onValueChange={setDraft}
      onValueCommitted={(next) => {
        if (next === null || !Number.isInteger(next) || next < min || next > max) {
          setDraft(value);
          return;
        }
        onChange(next);
      }}
    >
      <NumberFieldGroup>
        <NumberFieldInput aria-label={label} placeholder="Mixed" />
      </NumberFieldGroup>
    </NumberField>
  );
}

export function IdleCompactionSettings() {
  const settings = useScopedSettings();
  const update = useUpdateScopedSettings();
  const mixedMinutes = useScopedSettingsMixed(["idleCompactionMinutes"]);
  const mixedTokens = useScopedSettingsMixed(["idleCompactionTokens"]);
  return (
    <>
      <SettingsRow
        id="idle-compaction"
        title="Compact idle threads"
        serverScoped
        settingKeys={["idleCompactionEnabled"]}
        description="Compact large Claude and Codex sessions after all agent work finishes. Waits for monitors, commands, subagents, queued messages, and questions. Off by default; the server must stay running."
        resetAction={
          settings.idleCompactionEnabled ? (
            <SettingResetButton
              label="idle compaction"
              onClick={() => update({ idleCompactionEnabled: false })}
            />
          ) : null
        }
        control={
          <ScopedSwitch
            settingKeys={["idleCompactionEnabled"]}
            checked={settings.idleCompactionEnabled}
            aria-label="Compact idle threads"
            onCheckedChange={(value) => update({ idleCompactionEnabled: Boolean(value) })}
          />
        }
      />
      <SettingsRow
        title="Idle time before compaction"
        serverScoped
        settingKeys={["idleCompactionMinutes"]}
        description="Minutes since the last work finished, from 1 to 1,440. Reading the thread does not reset this timer."
        resetAction={
          settings.idleCompactionMinutes !== DEFAULT_SERVER_SETTINGS.idleCompactionMinutes ? (
            <SettingResetButton
              label="idle compaction timeout"
              onClick={() =>
                update({ idleCompactionMinutes: DEFAULT_SERVER_SETTINGS.idleCompactionMinutes })
              }
            />
          ) : null
        }
        control={
          <ThresholdField
            key={mixedMinutes ? "mixed" : settings.idleCompactionMinutes}
            value={mixedMinutes ? null : settings.idleCompactionMinutes}
            min={1}
            max={1440}
            label="Idle minutes before compaction"
            onChange={(value) => update({ idleCompactionMinutes: value })}
          />
        }
      />
      <SettingsRow
        title="Context token threshold"
        serverScoped
        settingKeys={["idleCompactionTokens"]}
        description="Compact when reported context reaches this token count. Sessions without reported usage are skipped."
        resetAction={
          settings.idleCompactionTokens !== DEFAULT_SERVER_SETTINGS.idleCompactionTokens ? (
            <SettingResetButton
              label="idle compaction token threshold"
              onClick={() =>
                update({ idleCompactionTokens: DEFAULT_SERVER_SETTINGS.idleCompactionTokens })
              }
            />
          ) : null
        }
        control={
          <ThresholdField
            key={mixedTokens ? "mixed" : settings.idleCompactionTokens}
            value={mixedTokens ? null : settings.idleCompactionTokens}
            min={1000}
            max={10000000}
            label="Context tokens before idle compaction"
            onChange={(value) => update({ idleCompactionTokens: value })}
          />
        }
      />
    </>
  );
}
