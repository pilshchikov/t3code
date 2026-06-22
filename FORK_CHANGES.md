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

- The editor keeps a back/forward navigation history, like a browser or JetBrains.
  - Back returns to the exact line you jumped from (the clicked identifier's line is captured as the
    origin), not the top of the previous file.
  - Shortcuts: Back is `⌘[` or `Ctrl+←`; Forward is `⌘]` or `Ctrl+→`. The shortcuts only act while the
    editor area owns focus, so chat/composer inputs keep their word navigation. (On macOS, `Ctrl+←/→`
    may be claimed by Mission Control "switch Spaces"; `⌘[`/`⌘]` always work.)
  - The file preview subheader also has Back/Forward arrow buttons, enabled per available history.
  - History is per environment+workspace and lives in the navigation store. The store is the single
    owner of navigation-driven file switches (the preview panel watches `navigationRequest` and opens
    the target file), so symbol jumps, the search dialog, and back/forward all share one code path.
  - Source: `apps/web/src/editorNavigationStore.ts`,
    `apps/web/src/components/files/FilePreviewPanel.tsx`,
    `apps/web/src/components/files/EditorNavigationDialog.tsx`.
- The Cmd-click definition/usage chooser is rendered JetBrains "Find Usages" style.
  - Each row shows the file name, directory, line number, and the source line with every whole-word
    occurrence of the symbol emphasized; a header shows the symbol and the match count.
  - The filter box narrows large result sets, and the keyboard selection scrolls into view.
  - Source: `apps/web/src/components/files/SymbolNavigationDialog.tsx`.
- Cmd-click symbol resolution is more forgiving about tokenization.
  - The clicked token no longer has to be a pristine identifier; a lone identifier is extracted even
    when the grammar attaches adjacent punctuation (`foo(`, `.foo`, `foo,`). Genuinely ambiguous
    multi-identifier tokens are still ignored so navigation never jumps to the wrong symbol. This
    fixes Cmd-click silently doing nothing on many method/class references.
  - Source: `apps/web/src/components/files/FilePreviewPanel.tsx`.
- The Search Everywhere dialog (double Shift) is tightened toward JetBrains density.
  - Narrower popup, faster open animation, and shorter rows/tabs/input. The matched portion of each
    result label is emphasized.
  - Source: `apps/web/src/components/files/EditorNavigationDialog.tsx`,
    `apps/web/src/components/files/SymbolNavigationDialog.tsx`.
- The workspace file tree auto-reveals the file shown in the editor.
  - On open, the tree expands the file's parent directories, scrolls it into view, and highlights
    the row (`data-item-focused`), like JetBrains' "Always Select Opened File". A toolbar toggle
    enables/disables it (persisted, on by default).
  - Source: `apps/web/src/components/files/FileBrowserPanel.tsx`,
    `apps/web/src/components/files/FilePreviewPanel.tsx`.
- Clicking a file in the tree reliably opens it.
  - `useFileTree` constructs the tree once and never re-reads its option callbacks, so the
    `onSelectionChange` handler used to hold a stale `onOpenFile` closure (bound to a since-changed
    active thread/project). After a thread switch or a tree remount, clicks silently no-opped. The
    handler now invokes the callback through a live ref, so it always targets the current thread.
  - Source: `apps/web/src/components/files/FileBrowserPanel.tsx`.
- The file tree marks files with working-tree changes (VCS status).
  - Changed files are colored via the tree's native git-status decoration, fed from the existing
    `useVcsStatus` working-tree data. Current pass marks changed files as modified (blue); add/delete/
    rename distinction arrives with the staging UI.
  - Source: `apps/web/src/components/files/FileBrowserPanel.tsx`.
- The explorer sidebar has a Structure view of the current file, like JetBrains' Structure tool.
  - Lists classes, methods, functions, and top-level declarations with kind badges and nesting,
    derived client-side from the already-loaded file contents (no server round-trip). Clicking a
    symbol scrolls the editor to it. A Files/Structure switch at the top of the sidebar toggles
    between the tree and the outline (persisted). Python and TypeScript/JavaScript have tuned
    extractors; other languages use a generic class/function fallback.
  - Source: `apps/web/src/components/files/fileOutline.ts`,
    `apps/web/src/components/files/FileStructurePanel.tsx`,
    `apps/web/src/components/files/FilePreviewPanel.tsx`.

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

## Git Commit Panel

- The server exposes granular git-index operations, additive and git-only (the shared `VcsDriver`
  contract and the `jj` driver are untouched).
  - New `GitVcsDriver` capabilities: `detailedStatus` (per-file staged/unstaged state + change kind,
    parsed from `git status --porcelain=2 -z`, including untracked and rename/copy origins),
    `stageFiles`, `unstageFiles`, `discardChanges` (reverts tracked paths to HEAD and removes
    untracked ones, with no-HEAD/initial-commit handling), and `commitStaged` (commits the current
    index, splitting the message into subject/body, with optional `--amend`).
  - Exposed through `GitWorkflowService` (gated to git repositories like the other workflow ops) and
    five additive WebSocket RPCs: `git.detailedStatus`, `git.stageFiles`, `git.unstageFiles`,
    `git.discardChanges`, `git.commitStaged`. The stage/unstage/discard RPCs return the refreshed
    detailed status so the client updates in one round trip, and mutations also refresh the VCS
    status stream.
  - Source: `packages/contracts/src/git.ts`, `packages/contracts/src/rpc.ts`,
    `apps/server/src/vcs/GitVcsDriver.ts`, `apps/server/src/vcs/GitVcsDriverCore.ts`,
    `apps/server/src/git/GitWorkflowService.ts`, `apps/server/src/ws.ts`.
  - Validated with `GitVcsDriverCore.test.ts` integration tests covering detailed status,
    stage/unstage/commit round-trips, and discard of tracked + untracked files.
- The explorer sidebar has a JetBrains-style **Commit** view alongside Files and Structure.
  - Lists changed files grouped into Changes (tracked) and Unversioned (untracked) with per-file
    change-kind badges (M/A/D/R/C/T), staged-state checkboxes (checked = fully staged, indeterminate
    = partially staged), and a select-all checkbox per group. Clicking a file opens it in the editor.
  - Each row has a discard control (confirmed, since discarding untracked files deletes them). A
    commit message box with an "Amend last commit" toggle commits the staged index; the button is
    enabled only when something is staged (or amending) and a message is present.
  - Backed by the git-index RPCs above via a `useGitDetailedStatus` query (stale-while-revalidate
    atom) plus stage/unstage/discard/commit mutation helpers. The web RPC client (`wsRpcClient`),
    the `EnvironmentApi` contract, and `environmentApi` wiring were extended with the new methods.
  - Per-file inline diff and AI commit-message prefill are intentionally not included in this pass
    (no per-file diff RPC exists yet, and message generation is currently bundled inside the stacked
    commit action); the existing whole-tree Diff surface remains available separately.
  - Source: `apps/web/src/components/files/GitChangesPanel.tsx`,
    `apps/web/src/components/files/gitChangesState.ts`,
    `apps/web/src/components/files/FilePreviewPanel.tsx`, `apps/web/src/environmentApi.ts`,
    `packages/client-runtime/src/wsRpcClient.ts`, `packages/contracts/src/ipc.ts`.

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
