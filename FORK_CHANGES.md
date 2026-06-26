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
- OS-keychain ("Safe Storage") secret encryption is disabled by default.
  - The local build is ad-hoc signed (no Apple Developer ID), so macOS re-prompts for the Keychain
    "Safe Storage" key on every launch/reinstall (the app's signature changes each rebuild, so even
    "Always Allow" never sticks). To avoid that prompt, `ElectronSafeStorage.isEncryptionAvailable`
    reports `false` without calling Electron; every consumer already degrades gracefully, so no
    Keychain access happens at all. The trade-off is that secrets for saved remote environments
    (bearer tokens, connection catalog) are not persisted.
  - Opt back into real Keychain encryption with `T3CODE_ENABLE_SAFE_STORAGE_KEYCHAIN=true`.
  - Source: `apps/desktop/src/electron/ElectronSafeStorage.ts`.
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
  - With an empty query, the All and Files scopes list the workspace's files (recent files first,
    then the rest of the project, deduped and capped) so there is always something to select
    immediately — previously a freshly opened workspace with no recent files showed an empty dialog
    and you had to type before any file appeared. Typing still narrows via the server `searchEntries`
    index. Regression-guarded by Chromium tests that select a file with and without typing.
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
  - Opening no longer depends on the tree library's selection callback. File-row clicks and Enter
    resolve the row path explicitly and invoke the current `onOpenFile` callback through a live ref.
    This keeps opening reliable after switching between Files and Structure or after auto-reveal
    scrolls the tree.
  - Auto-reveal expands and scrolls to the active file without stealing tree focus.
  - Source: `apps/web/src/components/files/FileBrowserPanel.tsx`.
- Files and directories can be deleted from the workspace tree.
  - Delete/Backspace removes the focused entry after confirmation, and right-click exposes the same
    action in a context menu. Directory deletion is recursive.
  - A workspace-root-safe `projects.deleteEntry` RPC rejects paths outside the workspace and does not
    follow a symlink target outside the workspace. Successful deletion refreshes file and Git state.
  - Source: `apps/web/src/components/files/FileBrowserPanel.tsx`,
    `apps/server/src/workspace/WorkspaceFileSystem.ts`, `apps/server/src/ws.ts`,
    `packages/client-runtime/src/state/projectCommands.ts`, `packages/contracts/src/project.ts`.
- The file tree marks files with working-tree changes (VCS status), colored by real change kind.
  - Markers come from the granular `git.detailedStatus` RPC. Any file with unstaged changes (or an
    untracked/unversioned file) renders in a pale red so it stands out from fully-staged work, which
    keeps its kind color: staged-added green, staged-modified blue, staged-deleted red, staged-renamed
    amber (copy→added, typechange/unmerged→modified, since the tree's palette has no dedicated colors
    for those). This matches the Commit panel's pale-red unversioned treatment. The
    detailed status is a pull query, so the panel
    refreshes it whenever the live `vcsEnvironment.status` stream reports a working-tree change, keeping
    markers current with edits made outside the Commit panel.
  - Source: `apps/web/src/components/files/FileBrowserPanel.tsx`,
    `apps/web/src/components/files/gitChangesState.ts`.
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

## Surface Keyboard Shortcuts

- Function/`Cmd+1` keys toggle the main workspace surfaces, JetBrains-style.
  - `Cmd+1` opens the file **Structure** view (opens the files surface and switches the explorer to
    the outline), `F1` toggles the code-editor (files) surface, `F2` toggles the browser preview,
    `F3` toggles the terminal.
  - `F2`/`F3` reuse the existing `preview.toggle`/`terminal.toggle` commands; `editor.toggle` and
    `structure.open` are new keybinding commands. All four are user-rebindable in Settings →
    Keybindings.
  - Note: `Cmd+1` previously jumped to thread 1 (`thread.jump.1`); it now opens the structure view
    (the new binding wins as the last default). `Cmd+2`–`Cmd+9` still jump to threads, and the
    model-picker number jumps are preserved (the `Cmd+1` binding is gated `!modelPickerOpen`).
  - The explorer's open/view state was lifted from `FilePreviewPanel` local state into a shared
    `explorerViewStore` so it can be driven from the global keyboard handler as well as the panel UI.
  - Source: `packages/contracts/src/keybindings.ts`, `packages/shared/src/keybindings.ts`,
    `apps/web/src/explorerViewStore.ts`, `apps/web/src/components/ChatView.tsx`,
    `apps/web/src/components/files/FilePreviewPanel.tsx`.

## Git Commit Panel

- The branch selector has explicit Fetch and Pull controls.
  - Fetch contacts the repository's remote and refreshes remote-tracking refs without moving the
    local branch. It is enabled whenever no branch action is in flight. When the current branch has
    an upstream it fetches that upstream's remote; when it has none (e.g. a freshly created local
    branch) the server falls back to fetching the primary remote (`origin`, else the first
    configured remote), returning a null `upstreamRef`. So the control is never permanently greyed
    out for upstream-less branches. A repository with no remote at all surfaces as a failure toast.
    Covered by `GitVcsDriverCore.test.ts` (with-upstream fetch, no-upstream primary-remote fallback,
    and no-remote failure).
  - Pull uses the existing fast-forward-only operation, so it never creates an implicit merge commit.
    It stays disabled until the current branch has an upstream, since fast-forward needs a tracking
    branch.
  - Source: `apps/web/src/components/BranchToolbarBranchSelector.tsx`,
    `apps/server/src/vcs/GitVcsDriverCore.ts`, `apps/server/src/ws.ts`,
    `packages/client-runtime/src/state/vcs.ts`, `packages/contracts/src/git.ts`.
- The Commit view exposes merge-conflict resolution controls.
  - Unmerged files can use the current side, use the incoming side, or stage the manually edited file
    as resolved. Delete/modify conflicts are handled when one selected side has no file.
  - **Resolve with AI** starts a normal coding-agent turn scoped to the listed unmerged files. The
    model picker is shown whenever conflicts exist, and its selection can optionally be remembered.
    The generated task explicitly stages resolved files but forbids commit, push, reset, merge abort,
    and unrelated-file changes.
  - Source: `apps/web/src/components/files/GitChangesPanel.tsx`,
    `apps/web/src/components/files/gitChangesState.ts`,
    `apps/server/src/vcs/GitVcsDriverCore.ts`, `apps/server/src/git/GitWorkflowService.ts`,
    `apps/server/src/ws.ts`, `packages/client-runtime/src/state/git.ts`,
    `packages/contracts/src/git.ts`.
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
    The two groups are visually separated by a divider, and unversioned file names render in a pale
    red (matching the file tree's untracked color) to stand out from tracked changes.
  - Each row has a discard control (confirmed, since discarding untracked files deletes them). A
    resizable, multi-line commit message box with an "Amend last commit" toggle commits the staged
    index; the button is enabled only when something is staged (or amending) and a message is present.
  - Backed by the git-index RPCs above via a `useGitDetailedStatus` query plus
    stage/unstage/discard/commit mutation helpers. The commands use upstream's supervised,
    environment-scoped client-runtime atoms so they reconnect and report failures consistently with
    the rest of the current web client.
  - The commit message box has an icon-only **Generate commit message** button (tooltip only) that
    drafts a concise one-line message from the staged diff using the system text-generation model
    (`textGenerationModelSelection`) — it returns the generated subject only (no body) so the result
    is a single, comprehensive line you can edit. It is enabled only when something is staged.
    - Server: a git-only `stagedCommitContext` driver capability reads the current index's
      `git diff --cached` summary + patch without modifying it (extracted from `prepareCommitContext`
      so both share one path), `GitManager.generateStagedCommitMessage` runs it through the existing
      `TextGeneration` service, exposed via `GitWorkflowService.generateCommitMessage` and the
      `git.generateCommitMessage` RPC.
    - Client: a `generateCommitMessage` environment command and a `generateGitCommitMessage` helper
      that fills the message box.
  - Clicking a file in the Commit view opens its **diff** (working-tree changes vs HEAD) over the
    editor area — not the editable file — with the selected row highlighted and a close (✕) control.
    Untracked files render as a full-file addition. Backed by a new git-only `git.fileDiff` RPC
    (`GitVcsDriver.fileDiff` → `git diff HEAD -- <path>`, falling back to `--no-index` for untracked),
    a `fileDiff` query atom, and a `CommitFileDiffView` that reuses the app's `@pierre/diffs` renderer
    (`getRenderablePatch` + `AnnotatableCodeView`).
    - Source: `packages/contracts/src/git.ts`, `packages/contracts/src/rpc.ts`,
      `apps/server/src/vcs/GitVcsDriver.ts`, `apps/server/src/vcs/GitVcsDriverCore.ts`,
      `apps/server/src/git/GitWorkflowService.ts`, `apps/server/src/ws.ts`,
      `packages/client-runtime/src/state/git.ts`,
      `apps/web/src/components/files/CommitFileDiffView.tsx`,
      `apps/web/src/components/files/GitChangesPanel.tsx`,
      `apps/web/src/components/files/FilePreviewPanel.tsx`.
  - Source: `apps/web/src/components/files/GitChangesPanel.tsx`,
    `apps/web/src/components/files/gitChangesState.ts`,
    `apps/web/src/components/files/FilePreviewPanel.tsx`,
    `apps/server/src/vcs/GitVcsDriver.ts`, `apps/server/src/vcs/GitVcsDriverCore.ts`,
    `apps/server/src/git/GitManager.ts`, `apps/server/src/git/GitWorkflowService.ts`,
    `apps/server/src/ws.ts`, `packages/client-runtime/src/state/git.ts`,
    `packages/contracts/src/git.ts`, `packages/contracts/src/rpc.ts`,
    `packages/contracts/src/ipc.ts`.

## Multiwork as a first-class workspace mode

- **Multiwork is a thread environment mode**, alongside "Current checkout" (local) and "New
  worktree", selectable from the composer's **Workspace** dropdown. Picking "Multiwork copy" and
  sending a first message makes the system provision an isolated full repo copy and run the agent
  inside it — like a git worktree, but a real decoupled copy.
  - `ThreadEnvMode`/`EnvMode`/`DraftThreadEnvMode`/`SidebarNewThreadEnvMode` gained a `"multiwork"`
    value; the env-mode logic treats multiwork like worktree (an isolated workspace that needs a
    base) via a shared `isIsolatedEnvMode` helper.
  - The first-turn flow reuses the worktree machinery: the thread's `worktreePath`/`branch` fields
    hold the copy and its branch, so the file tree/editor, VCS status, and the **first-turn AI
    branch rename** (which renames the temporary branch into an AI-named one) all work unchanged —
    i.e. the system "decides" the branch from your request, exactly as worktree mode does. Continuing
    an existing thread reuses its copy rather than cloning again.
  - The turn-start bootstrap's `prepareWorktree` gained a `mode: "worktree" | "multiwork"`; when it
    is `"multiwork"` the server provisions via `MultiworkService.create` (clone + branch) instead of
    `git worktree add`, reading the base directory from the `multiworkBaseDirectory` setting.
  - Source: `packages/contracts/src/settings.ts`, `packages/contracts/src/orchestration.ts`,
    `apps/web/src/composerDraftStore.ts`, `apps/web/src/components/BranchToolbar.logic.ts`,
    `apps/web/src/components/BranchToolbarEnvModeSelector.tsx`,
    `apps/web/src/components/BranchToolbarBranchSelector.tsx`,
    `apps/web/src/components/Sidebar.logic.ts`, `apps/web/src/components/ChatView.tsx`,
    `apps/server/src/ws.ts`.

- The GUI can also create isolated, full repo copies ("multiwork") directly and open them as
  projects, mirroring the `multiwork` shell workflow (the owner's alternative to git worktrees).
  - A persisted `multiworkBaseDirectory` setting (Settings → General) controls where copies live;
    empty resolves to `~/workplace/git/multiwork`.
  - Server `MultiworkService` + `multiwork.create` / `multiwork.list` RPCs perform the procedure:
    resolve the source repo toplevel and origin, object-borrowing clone
    (`git clone --reference … --dissociate`, falling back to a plain clone), fetch, then
    `checkout -B <branch>` — continuing an existing remote branch or branching off the default
    branch — and restore git-ignored project context (`.claude`, `CLAUDE.md`, `AGENTS.md`). It is
    additive and git-only; the shared `VcsDriver` contract and `jj` are untouched.
  - The Sidebar project context menu gains "New multiwork copy…", opening a dialog that derives a
    `spilshchikov-<task>` branch from a task name, creates the copy, registers it as a project (via
    the existing `project.create` command), and lists existing copies under the base directory for
    one-click re-adding. The slug is derived client-side (deterministic) rather than via the system
    text-generation model, which only exposes purpose-built commit/PR helpers today.
  - Source: `packages/contracts/src/multiwork.ts`, `packages/contracts/src/settings.ts`,
    `packages/contracts/src/rpc.ts`, `packages/contracts/src/ipc.ts`,
    `apps/server/src/multiwork/MultiworkService.ts`, `apps/server/src/server.ts`,
    `apps/server/src/ws.ts`, `packages/client-runtime/src/state/multiwork.ts`,
    `apps/web/src/state/multiwork.ts`, `apps/web/src/components/Sidebar.tsx`,
    `apps/web/src/components/settings/SettingsPanels.tsx`.
  - Validated with `MultiworkService.test.ts` (offline clone against a local bare remote: fresh
    branch + context restore, continuing an existing remote branch, reuse + list, and the
    not-a-repo failure).

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
