import { useState } from "react";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "../ui/number-field";
import { ScopedSwitch } from "./ScopedSwitch";
import { SettingsRow, SettingResetButton, SettingsSection } from "./settingsLayout";
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
  const gt = useGT();
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
        <NumberFieldInput aria-label={label} placeholder={gt("Mixed")} />
      </NumberFieldGroup>
    </NumberField>
  );
}

export function IdleCompactionSettings() {
  const gt = useGT();
  const settings = useScopedSettings();
  const update = useUpdateScopedSettings();
  const mixedMinutes = useScopedSettingsMixed(["idleCompactionMinutes"]);
  const mixedTokens = useScopedSettingsMixed(["idleCompactionTokens"]);
  return (
    <SettingsSection id="automatic-compaction" title={gt("Automatic compaction")}>
      <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">
        {gt(
          "Set global defaults here, or select a project above to override individual values. The indicator beside each setting shows where its value comes from and which projects override it.",
        )}
      </p>
      <SettingsRow
        id="idle-compaction"
        title={gt("Enable automatic compaction")}
        serverScoped
        settingKeys={["idleCompactionEnabled"]}
        description={gt(
          "Compact large Claude and Codex sessions between replies. Off by default; the server must stay running. Active replies, queued messages, and unanswered questions always wait.",
        )}
        resetAction={
          settings.idleCompactionEnabled ? (
            <SettingResetButton
              ariaLabel={gt("Reset idle compaction")}
              onClick={() => update({ idleCompactionEnabled: false })}
            />
          ) : null
        }
        control={
          <ScopedSwitch
            settingKeys={["idleCompactionEnabled"]}
            checked={settings.idleCompactionEnabled}
            aria-label={gt("Enable automatic compaction")}
            onCheckedChange={(value) => update({ idleCompactionEnabled: Boolean(value) })}
          />
        }
      />
      <SettingsRow
        id="idle-compaction-background"
        title={gt("Allow background work to continue")}
        serverScoped
        settingKeys={["idleCompactionAllowBackgroundWork"]}
        description={gt(
          "Keep native monitors, background commands, and provider subagents running during compaction. Turn off to wait until all work finishes. T3-managed delegated tasks and other pending tools still wait.",
        )}
        resetAction={
          !settings.idleCompactionAllowBackgroundWork ? (
            <SettingResetButton
              ariaLabel={gt("Reset compaction with background work")}
              onClick={() => update({ idleCompactionAllowBackgroundWork: true })}
            />
          ) : null
        }
        control={
          <ScopedSwitch
            settingKeys={["idleCompactionAllowBackgroundWork"]}
            checked={settings.idleCompactionAllowBackgroundWork}
            aria-label={gt("Allow background work during compaction")}
            onCheckedChange={(value) =>
              update({ idleCompactionAllowBackgroundWork: Boolean(value) })
            }
          />
        }
      />
      <SettingsRow
        id="idle-compaction-timeout"
        title={gt("Idle time before compaction")}
        serverScoped
        settingKeys={["idleCompactionMinutes"]}
        description={gt(
          "Minutes since the last reply finished (1–1,440). Output from allowed background work does not reset the timer. Otherwise it waits for all work to finish. Reading the thread does not reset it.",
        )}
        resetAction={
          settings.idleCompactionMinutes !== DEFAULT_SERVER_SETTINGS.idleCompactionMinutes ? (
            <SettingResetButton
              ariaLabel={gt("Reset idle compaction timeout")}
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
            label={gt("Idle minutes before compaction")}
            onChange={(value) => update({ idleCompactionMinutes: value })}
          />
        }
      />
      <SettingsRow
        id="idle-compaction-tokens"
        title={gt("Context token threshold")}
        serverScoped
        settingKeys={["idleCompactionTokens"]}
        description={gt(
          "Compact when reported context reaches this token count. Sessions without reported usage are skipped.",
        )}
        resetAction={
          settings.idleCompactionTokens !== DEFAULT_SERVER_SETTINGS.idleCompactionTokens ? (
            <SettingResetButton
              ariaLabel={gt("Reset idle compaction token threshold")}
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
            label={gt("Context tokens before idle compaction")}
            onChange={(value) => update({ idleCompactionTokens: value })}
          />
        }
      />
    </SettingsSection>
  );
}
