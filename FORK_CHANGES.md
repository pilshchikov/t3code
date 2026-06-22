# Fork Changes

This file tracks intentional fork-local changes in `pilshchikov/t3code` that may differ from the
upstream `pingdotgg/t3code` repository. Keep it current when adding, removing, or changing
fork-specific behavior so future upstream syncs are easier to review.

## Privacy-Hardened Desktop Startup

- Packaged desktop auto-update checks are disabled by default.
  - Opt in with `T3CODE_ENABLE_AUTO_UPDATE=true`.
  - Source: `apps/desktop/src/app/DesktopConfig.ts`,
    `apps/desktop/src/updates/DesktopUpdates.ts`.
- Provider npm latest-version advisory checks are disabled by default.
  - Opt in with `T3CODE_ENABLE_PROVIDER_VERSION_CHECKS=true`.
  - Source: `apps/server/src/provider/providerMaintenance.ts`.
- Automatic provider background refresh/checks are disabled by default.
  - Opt in with `T3CODE_ENABLE_PROVIDER_AUTO_REFRESH=true`.
  - Explicit/manual provider refresh still works.
  - Source: `apps/server/src/provider/makeManagedServerProvider.ts`.
- Validation performed on the installed macOS build showed a clean startup using only loopback
  sockets between Electron and the local backend after these gates were added.

## File Preview UX

- Editor surface tabs can be hidden from Settings > General.
  - Hidden-tab mode keeps a compact surface switcher and add-surface control, so files, terminals,
    diffs, and browser previews remain reachable without a persistent tab strip.
  - The setting is persisted with the existing client settings.
  - Source: `packages/contracts/src/settings.ts`,
    `apps/web/src/components/RightPanelTabs.tsx`,
    `apps/web/src/components/settings/SettingsPanels.tsx`.
- The file editor has JetBrains-style workspace navigation.
  - Double Shift opens Search Everywhere with All, Classes, Files, Symbols, Actions, and Text
    scopes. Tab and Shift+Tab cycle scopes.
  - File names use the existing fuzzy workspace index. Classes, methods, functions, variables,
    parameters, and text use source-content search through the server workspace index.
  - The Actions scope exposes relevant T3 Code commands, including settings, command palette,
    file explorer, workspace refresh, and tab visibility.
  - Cmd+E opens recent editor files. Recents are persisted per environment and workspace in client
    storage and survive desktop app updates.
  - Cmd-clicking an identifier searches exact workspace definitions/usages. A single target opens
    directly; multiple targets open a searchable chooser and reveal the selected source line.
  - Navigation is source-index based rather than language-server based. It handles common
    declaration forms and exact identifiers across ignored-file-aware workspace content, but does
    not perform full type resolution or overload analysis.
  - Source: `apps/server/src/workspace/WorkspaceSearchIndex.ts`,
    `apps/server/src/workspace/WorkspaceEntries.ts`, `apps/server/src/ws.ts`,
    `apps/web/src/components/files/EditorNavigationDialog.tsx`,
    `apps/web/src/components/files/SymbolNavigationDialog.tsx`,
    `apps/web/src/components/files/FilePreviewPanel.tsx`,
    `apps/web/src/editorNavigationStore.ts`, `packages/contracts/src/project.ts`.

- Markdown preview mode is global across markdown files instead of being tied to one file path.
  - Switching a markdown file to rendered mode applies to other `.md` and `.mdx` files, including
    newly opened or newly created files.
  - The preference is persisted in browser local storage as `t3code.markdownPreviewMode`.
  - Source: `apps/web/src/components/files/FilePreviewPanel.tsx`,
    `apps/web/src/components/files/filePreviewMode.ts`.
- The workspace file tree has explicit expand-all and collapse-all controls.
  - Source: `apps/web/src/components/files/FileBrowserPanel.tsx`.
- File breadcrumbs are navigable.
  - Clicking a project/directory crumb opens a child picker.
  - Selecting a file opens it.
  - Selecting a directory opens the first file under that directory, or reveals the directory in
    the tree if no file exists below it.
  - Cmd-click on a breadcrumb reveals that parent directory in the file tree.
  - Source: `apps/web/src/components/files/FilePreviewPanel.tsx`,
    `apps/web/src/components/files/filePath.ts`.
- Code rendering has a client-side editor theme selector.
  - Settings now include `Editor theme` with `Follow app` plus several dark syntax themes.
  - A custom `JetBrains Dracula Night` theme is registered for a darker Dracula-like editor
    background.
  - The selected theme applies to file previews, editable file views, diffs, and chat code blocks.
  - Source: `packages/contracts/src/settings.ts`, `apps/web/src/lib/diffRendering.ts`,
    `apps/web/src/components/settings/SettingsPanels.tsx`.

## Claude Profiles

- Claude provider instances support a dedicated `Claude config directory` setting.
  - The path is passed directly as `CLAUDE_CONFIG_DIR`, allowing named instances such as
    `Claude Personal` (`~/.claude-personal`) and `Claude Work` (`~/.claude-work`) to keep separate
    authentication and configuration.
  - Named Claude instances appear independently in the existing provider/model selector.
  - The older full `HOME` override remains available as an advanced compatibility option.
  - Source: `packages/contracts/src/settings.ts`,
    `apps/server/src/provider/Drivers/ClaudeHome.ts`.

## Update-Safe Persistence

- Desktop updates reuse stable, version-independent storage locations.
  - Projects, threads, messages, provider session bindings, settings, and attachments remain under
    `~/.t3/userdata`.
  - Electron UI state, drafts, and browser preferences remain under the stable `t3code` user-data
    directory (on macOS, `~/Library/Application Support/t3code`).
  - Regression tests cover app version, update channel, bundle path, and legacy user-data behavior.
  - Source: `apps/desktop/src/app/DesktopEnvironment.ts`,
    `apps/desktop/src/app/DesktopEnvironment.test.ts`,
    `apps/desktop/src/app/DesktopAppIdentity.test.ts`.

## Validation Notes

The fork-local changes above were validated with focused server tests, the full web unit suite,
Chromium component tests, formatting/lint checks, TypeScript checks, and earlier full
desktop/provider checks while preparing the macOS build.
