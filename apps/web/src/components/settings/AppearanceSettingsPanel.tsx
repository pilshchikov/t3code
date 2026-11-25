import {
  resolveSidebarStageBackdropVariant,
  type SidebarStageBackdropVariant,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { ProjectRailGroupStylePicker } from "./ProjectRailGroupStylePicker";
import { ChatCustomWidthControl } from "./ChatCustomWidthControl";
import { cn } from "../../lib/utils";
import type { CSSProperties } from "react";
import { useState } from "react";
import { msg, useGT, useMessages } from "gt-react";
import {
  type ComposerActionStyle,
  DEFAULT_DASHBOARD_LAYOUT,
  type DashboardLayout,
  DEFAULT_COMPOSER_ACTION_STYLE,
  DEFAULT_PROJECT_RAIL_GROUP_STYLE,
  DEFAULT_COMPOSER_ORB_SEND_COLOR,
  DEFAULT_COMPOSER_ORB_STOP_COLOR,
  DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE,
  DEFAULT_UNIFIED_SETTINGS,
  type ChatWidth,
  type HtmlPreviewWidth,
  type EffortDisplay,
  type EnvironmentIdentificationMode,
  MAX_APPEARANCE_CONTRAST,
  MAX_GLASS_OPACITY,
  MAX_PANEL_ANIMATION_DURATION_MS,
  MIN_APPEARANCE_CONTRAST,
  MIN_GLASS_OPACITY,
  MIN_PANEL_ANIMATION_DURATION_MS,
} from "@t3tools/contracts/settings";
import { useCustomThemes } from "../../hooks/useCustomThemes";
import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { ThemeLibrary } from "./ThemeSettings";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { PanelAnimationsPreview } from "./PanelAnimationsPreview";
import { TypographySection } from "./TypographySettings";
import { ThreadDetailsItemsRow } from "./ThreadDetailsItemsRow";

const ENVIRONMENT_IDENTIFICATION_LABELS: Record<EnvironmentIdentificationMode, string> = {
  artwork: msg("Artwork"),
  "nightly-artwork": msg("Nightly artwork"),
  "dev-artwork": msg("Dev artwork"),
  pill: msg("Version pill"),
  none: msg("None"),
};

function environmentIdentificationOptions(
  stageVariant: SidebarStageBackdropVariant | null,
): ReadonlyArray<readonly [EnvironmentIdentificationMode, string]> {
  if (stageVariant === "dev") {
    return [
      ["artwork", msg("Dev artwork")],
      ["nightly-artwork", msg("Nightly artwork")],
      ["pill", msg("Version pill")],
      ["none", msg("None")],
    ];
  }
  if (stageVariant === "nightly") {
    return [
      ["artwork", msg("Nightly artwork")],
      ["dev-artwork", msg("Dev artwork")],
      ["pill", msg("Version pill")],
      ["none", msg("None")],
    ];
  }
  return [
    ["artwork", msg("None")],
    ["nightly-artwork", msg("Nightly artwork")],
    ["dev-artwork", msg("Dev artwork")],
    ["pill", msg("Version pill")],
    ["none", msg("None")],
  ];
}

const CHAT_WIDTH_LABELS: Record<ChatWidth, string> = {
  comfortable: msg("Comfortable"),
  wide: msg("Wide"),
  full: msg("Full", { $context: "chat width" }),
  custom: msg("Custom", { $context: "chat width" }),
};

/**
 * Accent presets. Hues spread far enough apart to be told apart at swatch size; the exact lightness
 * matters less than it looks, since the theme pulls a chosen colour into its own accent band.
 */
const APP_ACCENT_SWATCHES = [
  { hex: "#3b6ef0", label: msg("Blue") },
  { hex: "#0e9488", label: msg("Teal") },
  { hex: "#16a34a", label: msg("Green") },
  { hex: "#c2851b", label: msg("Amber") },
  { hex: "#e0662c", label: msg("Orange") },
  { hex: "#dc2626", label: msg("Red") },
  { hex: "#db2777", label: msg("Pink") },
  { hex: "#7c3aed", label: msg("Violet") },
] as const;

const DEFAULT_APP_ACCENT_HEX = APP_ACCENT_SWATCHES[0].hex;

const ORB_SEND_SWATCHES = [
  { hex: "#8b5cff", label: msg("violet") },
  { hex: "#6d5cff", label: msg("indigo") },
  { hex: "#a855f7", label: msg("purple") },
  { hex: "#5b7cff", label: msg("blue") },
  { hex: "#22b8c8", label: msg("teal") },
  { hex: "#e0761f", label: msg("amber") },
] as const;

const ORB_STOP_SWATCHES = [
  { hex: "#e2323a", label: msg("crimson") },
  { hex: "#c81e2a", label: msg("blood") },
  { hex: "#ff5a45", label: msg("coral") },
  { hex: "#f43f5e", label: msg("rose") },
  { hex: "#d9463d", label: msg("ember") },
  { hex: "#a21caf", label: msg("magenta") },
] as const;

const HTML_PREVIEW_WIDTH_LABELS: Record<HtmlPreviewWidth, string> = {
  chat: msg("Match chat", { $context: "HTML preview width" }),
  wide: CHAT_WIDTH_LABELS.wide,
  full: CHAT_WIDTH_LABELS.full,
};

const EFFORT_DISPLAY_LABELS: Record<EffortDisplay, string> = {
  label: msg("Word", { $context: "show effort as a word" }),
  bars: msg("Bars", { $context: "show effort as bars" }),
};

export function AppearanceSettingsPanel() {
  const searchableSetting = useSearchableSetting();
  const {
    appearanceMode,
    refreshTheme,
    resolvedTheme,
    setAppearanceMode,
    setTheme,
    setThemeHalf,
    theme,
    themeHalves,
  } = useTheme();
  const gt = useGT();
  const m = useMessages();
  const customThemes = useCustomThemes();
  const [isImportThemeOpen, setIsImportThemeOpen] = useState(false);
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const showEnvironmentIdentification = true;
  const environmentStageLabel = useEnvironmentStageLabel();
  const environmentStageVariant = resolveSidebarStageBackdropVariant(environmentStageLabel);
  const environmentIdentificationOptionList =
    environmentIdentificationOptions(environmentStageVariant);
  const environmentIdentificationLabel = m(
    environmentIdentificationOptionList.find(
      ([value]) => value === settings.environmentIdentificationMode,
    )?.[1] ?? ENVIRONMENT_IDENTIFICATION_LABELS[settings.environmentIdentificationMode],
  );
  const effectiveEnvironmentIdentificationMode = useEnvironmentIdentificationMode();
  const themeHidesEnvironmentArtwork =
    effectiveEnvironmentIdentificationMode === "pill" &&
    resolveSidebarStageBackdropVariant(
      environmentStageLabel,
      settings.environmentIdentificationMode,
    ) !== null;
  const environmentIdentificationDescription = themeHidesEnvironmentArtwork
    ? environmentStageVariant
      ? gt("Only built-in themes show artwork, so this theme shows the version pill.")
      : gt("Only built-in themes show artwork.")
    : environmentStageVariant
      ? gt("Choose how Dev and Nightly environments are identified.")
      : gt("Show Dev or Nightly artwork in the sidebar header.");
  const glassOpacityRatio =
    (settings.glassOpacity - MIN_GLASS_OPACITY) / (MAX_GLASS_OPACITY - MIN_GLASS_OPACITY);
  const glassOpacitySliderStyle = {
    "--settings-slider-progress": `${glassOpacityRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - glassOpacityRatio}rem`,
  } as CSSProperties;
  const appearanceContrastRatio =
    (settings.appearanceContrast - MIN_APPEARANCE_CONTRAST) /
    (MAX_APPEARANCE_CONTRAST - MIN_APPEARANCE_CONTRAST);
  const appearanceContrastSliderStyle = {
    "--settings-slider-progress": `${appearanceContrastRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - appearanceContrastRatio}rem`,
  } as CSSProperties;
  const panelAnimationDurationRatio =
    (settings.panelAnimationDurationMs - MIN_PANEL_ANIMATION_DURATION_MS) /
    (MAX_PANEL_ANIMATION_DURATION_MS - MIN_PANEL_ANIMATION_DURATION_MS);
  const panelAnimationDurationSliderStyle = {
    "--settings-slider-progress": `${panelAnimationDurationRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - panelAnimationDurationRatio}rem`,
  } as CSSProperties;

  return (
    <SettingsPageContainer>
      <SettingsSection id="appearance" title={gt("Colors & themes")} variant="plain" hideTitle>
        <div id={searchableSetting("theme").id}>
          <ThemeLibrary
            appearanceMode={appearanceMode}
            customThemes={customThemes}
            initialAppearance={resolvedTheme}
            refreshTheme={refreshTheme}
            isImportOpen={isImportThemeOpen}
            setAppearanceMode={setAppearanceMode}
            setTheme={setTheme}
            setThemeHalf={setThemeHalf}
            theme={theme}
            themeHalves={themeHalves}
            onImportOpenChange={setIsImportThemeOpen}
          />
        </div>
      </SettingsSection>

      <SettingsSection id="appearance-interface" title={gt("Interface")}>
        <SettingsRow
          {...searchableSetting("dashboard-layout")}
          description={gt(
            "Choose how On deck shows running threads and unread results across projects and environments.",
          )}
          resetAction={
            settings.dashboardLayout !== DEFAULT_DASHBOARD_LAYOUT ? (
              <SettingResetButton
                ariaLabel={gt("Reset dashboard layout to default")}
                onClick={() => updateSettings({ dashboardLayout: DEFAULT_DASHBOARD_LAYOUT })}
              />
            ) : null
          }
          control={
            <Select
              value={settings.dashboardLayout}
              onValueChange={(value) =>
                value && updateSettings({ dashboardLayout: value as DashboardLayout })
              }
            >
              <SelectTrigger aria-label={gt("Dashboard layout")}>
                <SelectValue>
                  {settings.dashboardLayout === "projects"
                    ? gt("Project lanes")
                    : gt("Status board")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="board">{gt("Status board")}</SelectItem>
                <SelectItem value="projects">{gt("Project lanes")}</SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...searchableSetting("setting-accent-color")}
          description={gt(
            "The colour of primary buttons, the focus ring, and the send action. Overrides the accent of whichever theme is active; clear it to hand that back.",
          )}
          resetAction={
            settings.accentColor !== null ? (
              <SettingResetButton
                ariaLabel={gt("Reset accent colour to default")}
                onClick={() => updateSettings({ accentColor: null })}
              />
            ) : null
          }
          control={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {APP_ACCENT_SWATCHES.map((swatch) => (
                <button
                  key={swatch.hex}
                  type="button"
                  aria-label={m(swatch.label)}
                  aria-pressed={settings.accentColor === swatch.hex}
                  className={cn(
                    "size-5 cursor-pointer rounded-full border transition-transform",
                    settings.accentColor === swatch.hex
                      ? "scale-110 border-foreground"
                      : "border-border/70 hover:scale-110",
                  )}
                  style={{ backgroundColor: swatch.hex }}
                  onClick={() => updateSettings({ accentColor: swatch.hex })}
                />
              ))}
              <label className="ms-1 inline-flex cursor-pointer items-center gap-1 text-xs text-secondary-label">
                <input
                  type="color"
                  className="size-5 cursor-pointer rounded-full border border-border/70 bg-transparent p-0"
                  value={settings.accentColor ?? DEFAULT_APP_ACCENT_HEX}
                  aria-label={gt("Custom accent colour")}
                  onChange={(event) => updateSettings({ accentColor: event.target.value })}
                />
                {gt("Custom", { $context: "custom colour" })}
              </label>
            </div>
          }
        />

        <SettingsRow
          {...searchableSetting("setting-appearance-contrast")}
          description={gt("Adjust the contrast of text, borders, and controls.")}
          resetAction={
            settings.appearanceContrast !== DEFAULT_UNIFIED_SETTINGS.appearanceContrast ? (
              <SettingResetButton
                ariaLabel={gt("Reset contrast to default")}
                onClick={() =>
                  updateSettings({
                    appearanceContrast: DEFAULT_UNIFIED_SETTINGS.appearanceContrast,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-3 sm:w-52">
              <output
                className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                htmlFor="appearance-contrast"
              >
                {settings.appearanceContrast}%
              </output>
              <input
                aria-label={gt("Contrast")}
                className="settings-slider min-w-0 flex-1"
                id="appearance-contrast"
                max={MAX_APPEARANCE_CONTRAST}
                min={MIN_APPEARANCE_CONTRAST}
                onChange={(event) => {
                  const appearanceContrast = Number(event.currentTarget.value);
                  if (
                    Number.isInteger(appearanceContrast) &&
                    appearanceContrast >= MIN_APPEARANCE_CONTRAST &&
                    appearanceContrast <= MAX_APPEARANCE_CONTRAST
                  ) {
                    updateSettings({ appearanceContrast });
                  }
                }}
                step={5}
                style={appearanceContrastSliderStyle}
                type="range"
                value={settings.appearanceContrast}
              />
            </div>
          }
        />

        <SettingsRow
          {...searchableSetting("setting-glass-opacity")}
          description={gt("Higher values make menus, dialogs, and the composer more solid.")}
          resetAction={
            settings.glassOpacity !== DEFAULT_UNIFIED_SETTINGS.glassOpacity ? (
              <SettingResetButton
                ariaLabel={gt("Reset glass opacity to default")}
                onClick={() =>
                  updateSettings({ glassOpacity: DEFAULT_UNIFIED_SETTINGS.glassOpacity })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-3 sm:w-52">
              <output
                className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                htmlFor="glass-opacity"
              >
                {settings.glassOpacity}%
              </output>
              <input
                aria-label={gt("Glass opacity")}
                className="settings-slider min-w-0 flex-1"
                id="glass-opacity"
                max={MAX_GLASS_OPACITY}
                min={MIN_GLASS_OPACITY}
                onChange={(event) => {
                  const glassOpacity = Number(event.currentTarget.value);
                  if (
                    Number.isInteger(glassOpacity) &&
                    glassOpacity >= MIN_GLASS_OPACITY &&
                    glassOpacity <= MAX_GLASS_OPACITY
                  ) {
                    updateSettings({ glassOpacity });
                  }
                }}
                step={5}
                style={glassOpacitySliderStyle}
                type="range"
                value={settings.glassOpacity}
              />
            </div>
          }
        />

        <SettingsRow
          {...searchableSetting("composer-action-style")}
          description={gt(
            "Arcane orb replaces the send and stop buttons with a lit glass sphere whose plasma keeps moving while it is on screen.",
          )}
          resetAction={
            settings.composerActionStyle !== DEFAULT_COMPOSER_ACTION_STYLE ? (
              <SettingResetButton
                ariaLabel={gt("Reset composer buttons to default")}
                onClick={() =>
                  updateSettings({ composerActionStyle: DEFAULT_COMPOSER_ACTION_STYLE })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.composerActionStyle}
              onValueChange={(value) =>
                updateSettings({ composerActionStyle: value as ComposerActionStyle })
              }
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={gt("Composer buttons")}
              >
                <SelectValue>
                  {settings.composerActionStyle === "orb" ? gt("Arcane orb") : gt("Classic")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="orb">
                  {gt("Arcane orb")}
                </SelectItem>
                <SelectItem hideIndicator value="classic">
                  {gt("Classic")}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        {settings.composerActionStyle === "orb" ? (
          <SettingsRow
            {...searchableSetting("composer-orb-colors")}
            description={gt("The accent each orb burns with: send on the left, stop on the right.")}
            resetAction={
              settings.composerOrbSendColor !== DEFAULT_COMPOSER_ORB_SEND_COLOR ||
              settings.composerOrbStopColor !== DEFAULT_COMPOSER_ORB_STOP_COLOR ? (
                <SettingResetButton
                  ariaLabel={gt("Reset orb colours to default")}
                  onClick={() =>
                    updateSettings({
                      composerOrbSendColor: DEFAULT_COMPOSER_ORB_SEND_COLOR,
                      composerOrbStopColor: DEFAULT_COMPOSER_ORB_STOP_COLOR,
                    })
                  }
                />
              ) : null
            }
            control={
              <div className="flex flex-col items-end gap-2">
                {(
                  [
                    {
                      key: "composerOrbSendColor",
                      label: gt("Send", { $context: "orb colour row" }),
                      value: settings.composerOrbSendColor,
                      swatches: ORB_SEND_SWATCHES,
                    },
                    {
                      key: "composerOrbStopColor",
                      label: gt("Stop", { $context: "orb colour row" }),
                      value: settings.composerOrbStopColor,
                      swatches: ORB_STOP_SWATCHES,
                    },
                  ] as const
                ).map((row) => (
                  <div key={row.key} className="flex flex-wrap items-center justify-end gap-1.5">
                    <span className="me-1 text-xs text-secondary-label">{row.label}</span>
                    {row.swatches.map((swatch) => (
                      <button
                        key={swatch.hex}
                        type="button"
                        aria-label={gt("{row} orb {colour}", {
                          row: row.label,
                          colour: m(swatch.label),
                        })}
                        aria-pressed={row.value === swatch.hex}
                        className={cn(
                          "size-5 cursor-pointer rounded-full border transition-transform",
                          row.value === swatch.hex
                            ? "scale-110 border-foreground"
                            : "border-border/70 hover:scale-110",
                        )}
                        style={{ backgroundColor: swatch.hex }}
                        onClick={() => updateSettings({ [row.key]: swatch.hex })}
                      />
                    ))}
                    <input
                      type="color"
                      className="size-5 cursor-pointer rounded-full border border-border/70 bg-transparent p-0"
                      value={row.value}
                      aria-label={gt("Custom {row} orb colour", { row: row.label })}
                      onChange={(event) => updateSettings({ [row.key]: event.target.value })}
                    />
                  </div>
                ))}
              </div>
            }
          />
        ) : null}

        {showEnvironmentIdentification ? (
          <SettingsRow
            {...searchableSetting("environment-identification")}
            description={environmentIdentificationDescription}
            resetAction={
              settings.environmentIdentificationMode !== DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE ? (
                <SettingResetButton
                  ariaLabel={gt("Reset environment identification to default")}
                  onClick={() =>
                    updateSettings({
                      environmentIdentificationMode: DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE,
                    })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={settings.environmentIdentificationMode}
                onValueChange={(value) => {
                  if (
                    value === "artwork" ||
                    value === "nightly-artwork" ||
                    value === "dev-artwork" ||
                    value === "pill" ||
                    value === "none"
                  ) {
                    updateSettings({ environmentIdentificationMode: value });
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-40"
                  aria-label={gt("Environment identification")}
                >
                  <SelectValue>{environmentIdentificationLabel}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {environmentIdentificationOptionList.map(([value, label]) => (
                    <SelectItem hideIndicator key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        ) : null}

        <SettingsRow
          {...searchableSetting("diff-color-scheme")}
          description={gt("Choose colors for additions and deletions, including change counts.")}
          resetAction={
            settings.diffColorScheme !== DEFAULT_UNIFIED_SETTINGS.diffColorScheme ? (
              <SettingResetButton
                ariaLabel={gt("Reset diff colors to default")}
                onClick={() =>
                  updateSettings({ diffColorScheme: DEFAULT_UNIFIED_SETTINGS.diffColorScheme })
                }
              />
            ) : null
          }
          control={
            <div className="w-full sm:w-40">
              <Select
                value={settings.diffColorScheme}
                onValueChange={(value) => {
                  if (value === "red-green" || value === "blue-orange")
                    updateSettings({ diffColorScheme: value });
                }}
              >
                <SelectTrigger size="sm" className="w-full min-w-0" aria-label={gt("Diff colors")}>
                  <span
                    aria-hidden="true"
                    className={
                      settings.diffColorScheme === "blue-orange"
                        ? "flex shrink-0 flex-row-reverse gap-1"
                        : "flex shrink-0 gap-1"
                    }
                  >
                    <span className="size-2 rounded-full bg-diff-deletion" />
                    <span className="size-2 rounded-full bg-diff-addition" />
                  </span>
                  <SelectValue>
                    {settings.diffColorScheme === "blue-orange"
                      ? gt("Blue & orange")
                      : gt("Red & green")}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="red-green">{gt("Red & green (default)")}</SelectItem>
                  <SelectItem value="blue-orange">{gt("Blue & orange")}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          }
        />

        <SettingsRow
          {...searchableSetting("composer-context")}
          description={gt(
            "Keep branch and worktree controls below the composer after a thread starts.",
          )}
          resetAction={
            settings.persistComposerContextStrip !==
            DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip ? (
              <SettingResetButton
                ariaLabel={gt("Reset composer context to default")}
                onClick={() =>
                  updateSettings({
                    persistComposerContextStrip:
                      DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.persistComposerContextStrip}
              onCheckedChange={(checked) =>
                updateSettings({ persistComposerContextStrip: Boolean(checked) })
              }
              aria-label={gt("Keep composer context visible in active threads")}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("chat-width")}
          description={gt(
            "Set the maximum width of messages and the composer. The column is centered; smaller widths leave larger side margins.",
          )}
          resetAction={
            settings.chatWidth !== DEFAULT_UNIFIED_SETTINGS.chatWidth ||
            settings.chatCustomWidthPx !== DEFAULT_UNIFIED_SETTINGS.chatCustomWidthPx ? (
              <SettingResetButton
                ariaLabel={gt("Reset chat width to default")}
                onClick={() =>
                  updateSettings({
                    chatWidth: DEFAULT_UNIFIED_SETTINGS.chatWidth,
                    chatCustomWidthPx: DEFAULT_UNIFIED_SETTINGS.chatCustomWidthPx,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full flex-col gap-2 sm:w-44">
              <Select
                value={settings.chatWidth}
                onValueChange={(value) => {
                  if (
                    value === "comfortable" ||
                    value === "wide" ||
                    value === "full" ||
                    value === "custom"
                  )
                    updateSettings({ chatWidth: value });
                }}
              >
                <SelectTrigger size="sm" className="w-full min-w-0" aria-label={gt("Chat width")}>
                  <SelectValue>{m(CHAT_WIDTH_LABELS[settings.chatWidth])}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="comfortable">{gt("Comfortable (default)")}</SelectItem>
                  <SelectItem value="wide">{gt("Wide")}</SelectItem>
                  <SelectItem value="full">{gt("Full")}</SelectItem>
                  <SelectItem value="custom">{gt("Custom (pixels)")}</SelectItem>
                </SelectPopup>
              </Select>
              {settings.chatWidth === "custom" ? (
                <ChatCustomWidthControl
                  value={settings.chatCustomWidthPx}
                  onChange={(chatCustomWidthPx) => updateSettings({ chatCustomWidthPx })}
                />
              ) : null}
            </div>
          }
        />
        <SettingsRow
          {...searchableSetting("html-preview-width")}
          description={gt(
            "Let HTML previews in a chat grow wider than its messages, which stay centered.",
          )}
          resetAction={
            settings.htmlPreviewWidth !== DEFAULT_UNIFIED_SETTINGS.htmlPreviewWidth ? (
              <SettingResetButton
                ariaLabel={gt("Reset HTML preview width to default")}
                onClick={() =>
                  updateSettings({ htmlPreviewWidth: DEFAULT_UNIFIED_SETTINGS.htmlPreviewWidth })
                }
              />
            ) : null
          }
          control={
            <div className="w-full sm:w-40">
              <Select
                value={settings.htmlPreviewWidth}
                onValueChange={(value) => {
                  if (value === "chat" || value === "wide" || value === "full")
                    updateSettings({ htmlPreviewWidth: value });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full min-w-0"
                  aria-label={gt("HTML preview width")}
                >
                  <SelectValue>
                    {m(HTML_PREVIEW_WIDTH_LABELS[settings.htmlPreviewWidth])}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="chat">{gt("Match chat (default)")}</SelectItem>
                  <SelectItem value="wide">{m(HTML_PREVIEW_WIDTH_LABELS.wide)}</SelectItem>
                  <SelectItem value="full">{m(HTML_PREVIEW_WIDTH_LABELS.full)}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          }
        />
        <ThreadDetailsItemsRow />
        <SettingsRow
          {...searchableSetting("effort-display")}
          description={gt(
            "Show reasoning effort in the composer as its name, such as High, or as bars.",
          )}
          resetAction={
            settings.effortDisplay !== DEFAULT_UNIFIED_SETTINGS.effortDisplay ? (
              <SettingResetButton
                ariaLabel={gt("Reset effort display to default")}
                onClick={() =>
                  updateSettings({ effortDisplay: DEFAULT_UNIFIED_SETTINGS.effortDisplay })
                }
              />
            ) : null
          }
          control={
            <div className="w-full sm:w-40">
              <Select
                value={settings.effortDisplay}
                onValueChange={(value) => {
                  if (value === "bars" || value === "label")
                    updateSettings({ effortDisplay: value });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full min-w-0"
                  aria-label={gt("Effort display")}
                >
                  <SelectValue>{m(EFFORT_DISPLAY_LABELS[settings.effortDisplay])}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="label">{gt("Word (default)")}</SelectItem>
                  <SelectItem value="bars">{m(EFFORT_DISPLAY_LABELS.bars)}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          }
        />
        <SettingsRow
          {...searchableSetting("math-rendering")}
          description={gt(
            "Typeset LaTeX math, such as $x^2$ or \\[x^2\\], in messages and Markdown previews. The composer keeps TeX source editable.",
          )}
          resetAction={
            settings.mathRenderingEnabled !== DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled ? (
              <SettingResetButton
                ariaLabel={gt("Reset math rendering to default")}
                onClick={() =>
                  updateSettings({
                    mathRenderingEnabled: DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.mathRenderingEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ mathRenderingEnabled: Boolean(checked) })
              }
              aria-label={gt("Render math")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection id="appearance-project-rail" title={gt("Project rail")}>
        <SettingsRow
          {...searchableSetting("project-rail-group-style")}
          description={gt(
            "How groups look in the project rail, in both the short and the named view.",
          )}
          resetAction={
            settings.projectRailGroupStyle !== DEFAULT_PROJECT_RAIL_GROUP_STYLE ? (
              <SettingResetButton
                ariaLabel={gt("Reset project group style to default")}
                onClick={() =>
                  updateSettings({ projectRailGroupStyle: DEFAULT_PROJECT_RAIL_GROUP_STYLE })
                }
              />
            ) : null
          }
        >
          <ProjectRailGroupStylePicker
            value={settings.projectRailGroupStyle}
            onChange={(projectRailGroupStyle) => updateSettings({ projectRailGroupStyle })}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection id="motion" title={gt("Motion")}>
        <SettingsRow
          {...searchableSetting("panel-animations")}
          description={gt("Set how fast panels open and close.")}
          control={
            <div className="grid w-full grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 sm:w-auto sm:grid-cols-[7rem_13rem] sm:gap-4">
              <PanelAnimationsPreview durationMs={settings.panelAnimationDurationMs} />
              <div className="flex w-full items-center gap-3">
                <output
                  className="min-w-16 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                  htmlFor="panel-animation-duration"
                >
                  {settings.panelAnimationDurationMs} ms
                </output>
                <input
                  aria-label={gt("Panel animation duration")}
                  className="settings-slider min-w-0 flex-1"
                  id="panel-animation-duration"
                  max={MAX_PANEL_ANIMATION_DURATION_MS}
                  min={MIN_PANEL_ANIMATION_DURATION_MS}
                  onChange={(event) => {
                    const panelAnimationDurationMs = Number(event.currentTarget.value);
                    if (
                      Number.isInteger(panelAnimationDurationMs) &&
                      panelAnimationDurationMs >= MIN_PANEL_ANIMATION_DURATION_MS &&
                      panelAnimationDurationMs <= MAX_PANEL_ANIMATION_DURATION_MS
                    ) {
                      updateSettings({ panelAnimationDurationMs });
                    }
                  }}
                  step={25}
                  style={panelAnimationDurationSliderStyle}
                  type="range"
                  value={settings.panelAnimationDurationMs}
                />
              </div>
            </div>
          }
          resetAction={
            settings.panelAnimationDurationMs !==
            DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs ? (
              <SettingResetButton
                ariaLabel={gt("Reset panel animations to default")}
                onClick={() =>
                  updateSettings({
                    panelAnimationDurationMs: DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs,
                  })
                }
              />
            ) : null
          }
        />
      </SettingsSection>

      <TypographySection />
    </SettingsPageContainer>
  );
}
