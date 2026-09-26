# Fork Changes

This file tracks intentional fork-local changes in `pilshchikov/t3code` that may differ from the
upstream `pingdotgg/t3code` repository. Keep it current when adding, removing, or changing
fork-specific behavior so future upstream syncs are easier to review.

## Project rail beside the sidebar

- A column of project icons sits left of the sidebar on desktop, so switching project is one click
  instead of opening the picker first. Each icon is the project's own icon (`ProjectFavicon`, the
  same component the sidebar rows use), with the project name in a tooltip, the current scope
  marked, an "All projects" entry at the top, and a dot on any project with a running turn, a
  pending approval or a question waiting.
- The rail and the thread sidebar are shown together. Upstream's sidebar panel is `position: fixed`
  at `left: 0`, which covered the rail until the sidebar was collapsed; the panel now starts at
  `--project-rail-width`, which the layout sets to the rail's width while it is visible and to zero
  otherwise. Collapsing the sidebar still hides only the sidebar, leaving the rail in place.
- The rail has its own show and hide buttons, separate from the sidebar toggle: hide from the
  button at the rail's foot, show from a `PanelLeftOpen` button that appears in the sidebar header
  while it is hidden. The choice is remembered per install under
  `t3code:sidebar:project-rail-visible`. Never rendered on mobile, where the sidebar is a sheet.
- On macOS the traffic lights sit over the rail's top, so the first project starts below them
  (`--project-rail-top-inset`, set only for a non-fullscreen desktop window).
- The rail carries `data-app-sidebar`, so it reads the same surface, row and border tokens the
  thread sidebar does instead of the raised card colour, and both columns are one black. Each icon
  sits in a fixed, clipped box so a wide favicon cannot spill onto its neighbours, and the focus
  ring is inset rather than offset, which in a column this narrow would draw on the next project.
- The rail holds the manual project order whatever the sidebar's sort is set to, so an icon keeps
  its place instead of moving as work happens, and dragging one reorders it. Reordering writes the
  same `projectOrder` the sidebar's manual sort reads, through `reorderProjects`. A 4px drag
  threshold keeps a plain click selecting the project.
- Clicking a project sets the sidebar's project scope, the same state the picker writes, so the
  rail and the picker can never disagree. From a settings route it also returns to the thread list.
- The sidebar's logical-project chain (order, grouping, sort) moved into `useSidebarProjectGroups`
  so the rail and the sidebar read one source instead of two copies.
- The project icon picker's default grid grew from 24 to 98 icons; searching still reaches every
  Lucide icon.
- Sources: `apps/web/src/components/sidebar/ProjectRail.tsx`,
  `apps/web/src/components/sidebar/projectRail.logic.ts`,
  `apps/web/src/components/sidebar/useSidebarProjectGroups.ts`,
  `apps/web/src/components/sidebar/projectRailVisibility.ts`,
  `apps/web/src/components/sidebar/SidebarThreadHeader.tsx`,
  `apps/web/src/components/AppSidebarLayout.tsx`, `apps/web/src/projectIconOptions.ts`.
- Validation: web typechecks and the full web suite passes (5,569 tests), including a focused test
  for which projects earn a dot.

## Arcane orb composer buttons

- The composer's send and stop buttons are lit glass spheres with plasma churning inside, drawn by
  a small WebGL fragment shader (domain-warped fbm, two depth layers, fresnel rim and meniscus).
  Appearance settings choose between `Arcane orb` and upstream's `Classic` button, and set the
  accent each orb burns with from a preset row or a colour picker.
- All mounted orbs share one animation loop capped at 30fps. The loop stops when the tab is hidden
  and when no orb is on screen, `prefers-reduced-motion` holds the cloud still, and a canvas
  without WebGL falls back to a static gradient.
- Client settings: `composerActionStyle` (default `orb`), `composerOrbSendColor`,
  `composerOrbStopColor`.
- Sources: `apps/web/src/components/chat/composerOrbRenderer.ts`,
  `apps/web/src/components/chat/ComposerActionOrb.tsx`,
  `apps/web/src/components/chat/ComposerPrimaryActions.tsx`,
  `apps/web/src/components/settings/SettingsPanels.tsx`, `packages/contracts/src/settings.ts`.

## Settled threads drop their worktrees, and expire

- `storageCleanup.worktreeOnSettle` (new, on by default here) removes a thread's worktree as soon
  as the thread settles. The branch, the commits and the conversation stay; the checkout goes. The
  sweep's existing guards still apply, so a dirty tree, an unexpected branch, ignored files beyond
  `node_modules`, a live terminal or a running session all cancel the removal, and a thread that
  leaves the settled list before the sweep finishes keeps its worktree.
- `storageCleanup.settledThreadAfterDays` (new, 14 by default) deletes a settled thread and
  everything stored for it that many days after it settled. Deletion goes through the ordinary
  `thread.delete` command, so sessions stop and attachments are removed exactly as a manual delete
  does. Pinned threads are never swept, nor are threads with a running turn, live session,
  background work or a pending approval. Archived threads are swept like active ones.
- Both rules are editable in Storage settings; the worktree rule is project-scopable like the other
  worktree rules, and a project's rules stored before this release read the settle rule as off.
- Sources: `packages/contracts/src/settings.ts`, `packages/shared/src/projectSettings.ts`,
  `packages/shared/src/serverSettings.ts`, `apps/server/src/storageCleanup.ts`,
  `apps/web/src/components/settings/StorageSettings.tsx`.
- Validation: `ThreadSettlementReactor.test.ts` covers the settle rule (removed, and retained when
  the rule is off) and the retention sweep (expired active and archived threads deleted; recent,
  pinned and running threads kept). Every package typechecks; web, contracts and shared suites
  pass. The storage-cleanup tests need a `TMPDIR` that is not a symlink on macOS
  (`TMPDIR=/private/tmp/... vp test run`), otherwise they fail on `realPath` comparisons.

## Upstream sync, September 25

- Merged 55 upstream commits through `7a12aff471`. The previous fork revision is retained as
  `backup/pre-upstream-sync-20260925` at `c692e67b5d`.
- Upstream's per-thread auto-settle lands whole: its menu items, its `setAutoSettle` action, and
  its migration, which runs as 58 here because the fork already used 54 for usage history. The
  fork's opt-in settlement mode still decides whether a settled thread leaves the inbox.
- `BranchToolbar` takes upstream's required `envMode` instead of the fork's optional override.
  Non-primary workspace rows pass their own root's default mode through the same prop, so the
  multi-directory strip behaves as before.
- Usage buckets carry the resolved transcript directory under both names: upstream's `sourcePath`
  and the fork's `sourceId`, which its per-account rows read. Scanners that report a directory
  without an account leave the fork's label and instance fields unset.
- Attached composer banners inset from the composer's edge again. Upstream declares
  `--chat-composer-drawer-inset` on a shell that wraps both the banner stack and the composer;
  this fork's glass host sits inside the composer, so a banner read no value, its width calc was
  invalid, and it stretched to the composer's full width with a mismatched corner. The variable
  now sits on `[data-chat-composer-stack="true"]`, the nearest element holding both.
- Validation: typecheck passes for every package. Web (5,567), mobile, desktop, contracts, shared
  and client-runtime tests pass.

## Usage limit trends read by day, with a crosshair

- The time axis marks every local midnight with a rule and a date label, so days are
  distinguishable at a glance. Ranges of a day or two add hour ticks; longer ranges thin the
  date labels to about eight across the plot.
- Hovering anywhere in the plot snaps a crosshair to the nearest measurement and shows its exact
  time and remaining percent. The old native `<title>` on a 1.5px dot was unreachable in practice.
- The measurements table groups rows under a heading per day and shows the time of day in each
  row, instead of repeating the full date on every row.
- Sources: `apps/web/src/components/usage/UsageLimitTrends.tsx`,
  `apps/web/src/components/usage/usageLimitHistoryAxis.ts`.

## A fixed, one-line composer on upstream's prompt box

- The prompt starts one line tall (`min-h-[1lh]` instead of upstream's `min-h-19.5`) and grows
  with its text. Upstream's composer is otherwise untouched.
- A timeline scroll never rests the composer: `canScrollCollapseComposer` is always false, so the
  height stays put. Upstream's gesture code and the Settings switch stay in place, always
  ineligible, so the next sync has nothing to reconstruct.
- Sources: `apps/web/src/components/ComposerPromptEditorTiptap.tsx`,
  `apps/web/src/components/chat/ChatComposer.tsx`.

## The app's own context menu everywhere

- `localApi.contextMenu.show` always renders the in-app menu, on desktop too. The native Electron
  menu is the operating system's look and drops the icons and section headers the items carry.
  `close` dismisses that menu on every surface.
- Source: `apps/web/src/localApi.ts`.

## The sidebar project picker keeps the height you drag it to

- The grip sits on the popup's bottom edge, under the slot hint. Dragging it resizes the whole
  popup between 120px and 720px of list, since upstream's 23rem popup cap is lifted to the space
  the positioner reports. A double click returns it to 288px, and the height is remembered per
  browser or desktop install under `t3code:sidebar:project-picker-height`.
- Source: `apps/web/src/components/Sidebar.tsx`.

## Upstream sync, September 24: the composer returns to upstream

- Merged 111 upstream commits through `f26ee083fe`. The previous fork revision is retained as
  `backup/pre-upstream-sync-20260924` at `a1a19ca69e`.
- The prompt box is upstream's again, by request. `ChatComposer`, both prompt editors, the banner
  stack, the stash badge and menu, the tasks badge, the command menu, the footer layout, the
  focus and multiline hooks, and `composerScrollGesture.ts` are taken from upstream as-is. The
  fork's compact layout, pen placeholder, one-line minimum height, inline stash chip, tasks
  drawer, and the removal of scroll resting are all gone.
- Scrolling a conversation rests the composer again, on by default, with upstream's
  **Collapse composer on scroll** switch back in Settings → General. `timelineOverflows` is
  passed to the composer again, and the composer's banner items keep the fork's `urgent`
  ordering flag through a local type in `ChatView.tsx`.
- Kept around the prompt box: the multi-directory workspace chips and the multiwork picker in
  `BranchToolbar*`, the fork's glass composer shell, and the project memory and script controls.
- Upstream now ships Claude Opus 5.5 in its own manifest with the same slug, badge, profile and
  minimum CLI version, so the fork's entry is dropped in favor of theirs. Upstream keeps Opus 5
  out of `currentModels`, which is their call, not a fork change.
- `mod+[` and `mod+]` stay on the fork's editor history. Upstream bound them to its new
  `navigation.back` and `navigation.forward`; those commands remain rebindable, without a
  default chord.
- Upstream's new `shadcn/no-restyle`, `no-arbitrary-values`, `no-raw-colors` and
  `require-static-classes` rules report as warnings for `apps/web/src/**` in this fork. The
  fork's own panels predate them and produce about 210 findings; leaving them as errors would
  bury the 15 that were already failing.
- Validation: typecheck passes for every package. Web (5,540), mobile (1,711), desktop,
  contracts, shared and client-runtime tests pass.

## Claude Opus 5.5 in the bundled model manifest (superseded by upstream, September 24)

- `claude-opus-5-5` is a current Claude model with a `new` badge, ahead of Claude Opus 5, which
  stays current rather than moving to legacy. Claude Code 2.1.280 is the minimum version: its
  baked-in catalog is where the slug, the 1M context window, and fast mode were confirmed.
- Its profile matches Opus 5 except that reasoning defaults to Medium, which is the model's own
  default. Thinking cannot be disabled on Opus 5.5, so effort is the only control.
- `updatedAt` moves forward so a disk cache written by an older manifest is dropped. This fork
  keeps remote manifest refreshes behind `T3CODE_ENABLE_PROVIDER_VERSION_CHECKS`, so the bundled
  file is what the app actually reads. Upstream has not added the model yet.
- Source: `apps/server/src/provider/model-manifest.json`.

## The desktop composer never rests on a timeline scroll (reverted, September 24)

- Scrolling a conversation no longer shrinks the prompt. The wheel and scroll-key gestures, their
  eligibility tracking, and `composerScrollGesture.ts` are removed, so nothing can set the
  desktop resting state. Successive attempts to make the shrink-and-restore tween behave still
  moved the prompt out from under the caret, and the reclaimed row was not worth it.
- `composerCollapseOnScroll` stays in the settings schema so stored values decode, but no client
  reads it and its Settings → General switch is gone. An inherited `true` cannot bring the
  behavior back.
- The phone's collapsed composer row is a separate path and still works. `timelineOverflows` is no
  longer passed to the composer, since only the scroll gesture consumed it.
- Sources: `apps/web/src/components/chat/ChatComposer.tsx`,
  `apps/web/src/components/ChatView.tsx`, `apps/web/src/components/settings/SettingsPanels.tsx`,
  `packages/contracts/src/settings.ts`.

## Composer text stability (reverted, September 24)

- Compact and expanded desktop composer layouts keep the same prompt line height and top inset;
  only the space beneath the prompt contracts. The prompt follows the surface resize without a
  second position animation. The Tiptap editor uses the same one-line minimum height and
  attributes at initialization and on updates.
- Icon-only placeholders resolve to a stable accessibility label, so unrelated chat activity does
  not reapply editor attributes and move the prompt text.
- The height transition no longer observes and retargets itself from body resize events during
  its tween.

## Upstream sync, September 21

- Merged 166 upstream commits through `1de563c149`, after saving the fork at
  `backup/pre-upstream-sync-20260921` (`5db36e9bf7`). This was a source merge only: no app
  install, restart, or push.
- Kept the fork's mobile and desktop composer layout, multi-directory and multiwork controls,
  project-slot shortcuts, multiple-PR panel, file/tree caches, separate Claude accounts,
  retained usage totals, project memory, agent workspace tools, and settled-worktree cleanup.
  Upstream's forced-new-worktree flow now disables previous-worktree and multiwork reuse.
- Adopted upstream's provider tooling, PR viewed-file tracking, text and diff improvements,
  sidebar undo actions, device-update UI, and Effect dependency update. Fork migration IDs
  through 56 remain stable; upstream's PR viewed-file migration runs as 57.
- Reconciled upstream's Claude home semantics with per-account configuration and the fork's
  transcript-history retention. Media previews check metadata only to recognize directories
  without transferring image or video bytes.
- Validation: contracts, shared, client-runtime, server, web, desktop, and mobile typechecks;
  focused migration, usage, multiwork, project-memory, PR, worktree-cleanup, file-cache,
  keyboard, and composer tests. Targeted lint completed with warnings only.

## Mobile web sidebar continuity and navigation

- `ChatView.tsx` always keeps the mobile composer expanded, including existing threads and after
  focus loss or sending. Its compact expanded layout stays directly editable without an extra tap;
  desktop scroll-to-collapse behavior is unchanged.
- The project scope survives drawer unmounts and reloads through `useSidebarProjectScope.ts`.
  The existing snapshot-readiness guard still prevents clearing an offline project's scope.
- `SidebarThreadHeader.tsx` and `Sidebar.tsx` put a labeled project picker below search, with
  48px mobile targets and 24px project icons (40px/20px on desktop).
- Active-thread dragging now writes server order keys, matching native mobile and other browsers.
  `useSidebarOrderMigration.ts` migrates legacy local arrangements with a persisted retry plan;
  existing server arrangements take precedence. Older servers retain local ordering.
- `AppSidebarLayout.tsx` installs mobile-only edge gestures from `ui/sidebarSwipe.ts`. Vertical
  scrolling, editing, browser-back edges, dialogs, and horizontally scrolling content are excluded.
- Validation: focused project-scope remount, swipe, order migration, and sidebar drag tests;
  web typecheck and targeted formatting/lint. These changes affect mobile web and desktop's shared
  frontend; native mobile already consumes server order keys.

## Upstream sync, September 17

- Merged 35 upstream commits through `6d1d549441`. The previous fork revision is retained as
  `backup/pre-upstream-sync-20260917` at `eaa02c1238`. Upstream added no migrations.
- The composer now uses upstream's Tiptap editor, with rich text on by default and a switch in
  Settings → General. The pen placeholder and one-line minimum height moved into
  `ComposerPromptEditorTiptap.tsx`, whose placeholder accepts an icon again.
- Review diffs use upstream's contract. `files` holds complete numstat counts, untracked files
  included, and a `file` request returns one file's patch with its rename source. The fork keeps
  two optional inputs for its overview request: `sourceKind` returns one source and
  `includePatch: false` skips patch bodies. The fork's `path` input, `patchOmitted` flag, and
  24-file untracked cap are gone. Sources: `packages/contracts/src/review.ts`,
  `apps/server/src/vcs/GitVcsDriverCore.ts`.
- `DiffPanel.tsx` keeps the fork's left file tree, one-file view, and directory picker. With the
  tree hidden, files load progressively through upstream's `useReviewFilePatches` instead of one
  patch capped at 120 KB. The header's file-tree toggle now drives that tree, and the separate
  reopen button is gone. The toggle previously controlled upstream's removed right-side tree.
- Approval prompts take upstream's layout. That restores provider-specific options, labels,
  warnings, and MCP app access details, which an earlier merge had replaced with four fixed
  buttons.
- Upstream's tooltips on the composer environment and workspace controls (#11787) are not
  merged. The fork's compact toolbar, multiwork selector, tasks drawer, and stash menu are unchanged.
- The timeline combines upstream's grouped thought and tool activity and remembered reading
  positions with the fork's work-log folding, first and terminal assistant messages, and inline
  turn plans. Settlement reacts to PR link, sync, and session-end events, still only when the
  fork's opt-in settlement mode is enabled.
- Adopted as upstream: the diff panel opens on the working tree, and diff files start collapsed
  when no preference is saved. Also adopted: checkpoint fsync, sparse-checkout, and placeholder
  fixes, the theme picker shortcuts `mod+alt+a` and `mod+alt+shift+a`, searchable keybindings,
  folder drops as path chips, and OpenCode Go, Cursor, and Grok limits.
- `docs/user/appearance.md` is upstream's page plus the fork's accent color and glass opacity
  sections. The previous merge had mixed Android text into the accent section.
- Validation: typecheck passes for every package. Web (5,288 tests), desktop, contracts,
  client-runtime, shared, and mobile review and thread tests pass. The full server suite has 32
  failures in 12 files, and every one also fails on `backup/pre-upstream-sync-20260917`:
  Antigravity provider timeouts, Codex and npm maintenance detection, Claude home terminal
  defaults, the multiwork bootstrap tests, and the SSH helper test. `vp check` still reports 15
  lint errors that predate this merge, all in fork files: native `title` tooltips and a
  restricted `GitMergeIcon` import.

## Upstream sync and queued follow-ups, September 16

- Merged 99 upstream commits through `052c7ae53e`, including client-side follow-up queues,
  Queue/Steer selection and send-shortcut controls, background worktree setup, project cloning,
  custom snoozes, native provider slash commands, project monograms, PR presentation updates,
  provider thinking traces, worktree checkout performance, and desktop/mobile reliability fixes.
- Preserved the fork's compact desktop and mobile-web composer, multi-directory chips, multiwork,
  project notes and agent workspace tools, multiple-PR overview, collapsible images, file/tree
  caches, stable colored usage accounts, limit-history polling, and macOS shortcut safeguards.
- Existing fork migration numbers remain stable. Upstream's thread-title-state migration is 56;
  tests use the fork's remapped migration boundaries so existing databases are never silently
  reinterpreted. OpenCode keeps fork skill content while applying upstream's bounded CLI output.
- Focused typechecks and regression tests cover queue/steer, keybindings, worktree setup,
  multiwork, project notes, settled-worktree cleanup, multiple PRs, file caches, usage history,
  migrations, and OpenCode inventory. This sync does not push, rebuild, reinstall, or restart.

## Active-provider limit trends, September 14

- Trend charts connect measurements (including quota resets), using dashed bridges across gaps,
  and group account cards under provider headings without merging Personal and Work histories.
- A server-owned scheduler requests fresh provider limits at the first active thread, about every
  30 seconds while busy, and when the last thread finishes. Concurrent threads share the account's
  polling clock and in-flight request; a finish during a probe queues one final check. Startup
  subscriptions are acquired before session seeding to avoid missing short turns.
- Provider snapshot updates are recorded immediately, with 30-second history buckets and a
  30-second 24-hour view. Idle collection and 90-day retention remain. Explicit Claude refreshes
  bypass its capability cache, and cached usage keeps its original measurement timestamp.

## File preview and directory cache, September 14

- Open text-file tabs retain their editor/Markdown surfaces while inactive or while the right
  panel is closed. Files tabs also retain expanded folders and scroll state. Closing a file tab
  releases its query snapshot; media/live pages stop when hidden. Closed panels are inert and
  relinquish native titlebar drag regions.
- Activation, window focus, watcher startup and file changes validate an opaque disk revision
  (device/inode, size, modification and change times). Metadata-only reads do not transfer file
  contents. Unchanged previews stay intact; changed files refresh in the background. Outstanding
  checks cannot discard a newer unsaved edit or refresh a retired tab.
- File trees use cached shallow directory listings with a one-minute idle TTL, refreshed in the
  background. Only the root and visible expanded directories are listed/watched; collapsed
  subtrees are not recursively scanned. Breadcrumb menus load individual directories on demand.
  Explicit file search remains bounded and server-side. Cached descendants cannot recreate a
  deleted parent, and recent-file navigation does not mistake unlisted subtrees for deleted files.

## Upstream sync and thread PR overview, September 14

- Merged 26 upstream commits through `01e05c1526`. The previous fork revision is retained as
  `backup/pre-upstream-sync-20260914` at `db9373c735`.
- Adopted upstream worktree setup progress and cancellation, response streaming settings,
  optional local desktop environment, and release archive runtime management. Upstream removed
  its compact sidebar experiment; the fork's thread ordering, accents, project shortcuts, and
  drag styling remain. Compact composers and the pen placeholder are unchanged.
- Multiwork setup reports clone preparation or reuse through the new progress stream. Cancelling
  setup closes its setup terminal but never sends a multiwork clone to Git worktree removal.
  Sources: `apps/server/src/ws.ts` and the bootstrap tests in `server.test.ts`.
- The existing right-panel Pull requests tab now groups all attached PRs by host and repository,
  preserves stack relationships, shows source and target branches, and summarizes open, merged,
  closed, unknown, and attention-needed PRs. Branch totals count names separately per repository.
  Unknown snapshots are not counted as open; overlapping failure signals count once per PR.
- Clicking a multi-PR badge opens the overview directly. Single PRs still open their detail view.
  Rows wrap in narrow panels and expose their action menu on touch screens. Unlinking uses the
  full repository identity, so identical PR numbers in different repositories remain separate.
  Sources: `components/pullRequest/ThreadPullRequestsPanel.tsx`, `threadPullRequestsOverview.ts`,
  and `components/ThreadStatusIndicators.tsx`. Applies to desktop, web, and mobile web; native
  mobile keeps upstream's existing PR interface and shares the unchanged attachment API.
- Validation covers five attached PRs across repositories, stacks, status aggregation, account
  ordering, project notes, MCP PR/workspace tools, setup progress, and scoped typechecks.
  This update does not reinstall or restart the running app.

## Upstream sync, September 13

- Merged 102 upstream commits through `c07575f573`. The fork checkpoint is `495b2e6c7a`,
  retained as `backup/pre-upstream-sync-20260913`.
- Kept compact desktop and mobile-web composers, the pen placeholder, opaque notices,
  directory chips, collapsible images, account colors and ordering, usage trends, project notes,
  agent workspace and PR tools, Git history, privacy defaults, and opt-in thread settlement.
- Upstream project-scoped settings now include the fork's settlement mode. Browser and device
  overrides use upstream resolution while MCP credentials retain memory and workspace access.
  Project action imports retain their configured working directory.
- Registered upstream message context as migration 55, after fork usage history at 54.
  Upgrade tests cover existing project notes and usage observations as well as an already-present
  context column. Sources: `apps/server/src/persistence/Migrations.ts` and migration tests.
- Retained the fork file browser and multiwork roots in `components/files/FileBrowserPanel.tsx`
  and `FilePreviewPanel.tsx`. Integrated upstream attachment, audio, and table previews. File
  watches register before the initial ready event and include nested directories.
- Combined upstream rename and staged-deletion previews with bounded overview patches and lazy
  per-file loading in `apps/server/src/vcs/GitVcsDriverCore.ts`. Upstream context chips and
  streaming rendering coexist with the fork's one-line editor minimum and work-log folding.
- Usage scanning includes upstream account-home discovery and deduplication while retaining
  per-account labels and the fork's separate Claude process-home and config-directory settings.
  Large Codex sub-agent totals still include provider-reported cumulative cached input. This
  upstream revision does not establish a fix for those totals.
- Validation uses focused regression tests and scoped typechecks. No browser checks, live-data
  writes, app reinstall, restart, or push are part of this merge.

## Usage limit trends, September 13

- Usage → Limits → Trends shows separate, consistently ordered account charts with configured
  accents on desktop and mobile web. It supports 24h/7d/30d/90d ranges, measurement tables,
  multi-environment reads, and explicit gaps at resets or missing measurements.
- A server collector samples the existing provider and hub readings at startup and every five
  minutes. It keeps observation timestamps, skips failed probes, and stores bounded five-minute
  buckets in SQLite migration 54 (`usage_limit_history`). Rows expire after 90 days. Read-only
  authenticated RPC queries downsample long ranges and cap responses at 20,000 points.
- Sources: `usage/UsageLimitHistory.ts`, `usage/UsageLimitHistoryCollector.ts`,
  `components/usage/UsageLimitTrends.tsx`, and `packages/contracts/src/usageLimitHistory.ts`.
  Focused tests cover persistence, retention, sampling, identity, chart gaps, and account order.
  Native mobile has the shared RPC available but no trends screen yet.

## Minimal composer placeholder, September 13

- The web/desktop composer and mobile web layouts use a small pen icon instead of normal
  empty-input instructions, including the collapsed mobile row. Approval, project selection,
  connection, and question guidance remain available. The icon does not intercept editor clicks.
- Source: `apps/web/src/components/chat/ChatComposer.tsx`. Validation: web typecheck and focused
  composer editor tests.

## Settled worktree retention, September 13

- The server checks at startup and hourly for T3-managed Git worktrees whose owning threads
  have been settled without newer activity for at least seven days. It checks visible and
  archived threads, configured project directories, provider sessions, and terminal activity.
  Shared active checkouts, dirty or locked worktrees, standalone clones, and external paths
  are retained. Idle sessions and terminal tabs in an eligible checkout are closed.
- Cleanup uses `git worktree remove` without force, retaining branch refs, checkpoints, and
  conversation records. Existing resume behavior recreates the checkout from its saved branch.
  Multiwork clone cleanup is excluded. Sources: `orchestration/SettledWorktreeCleanup.ts` and
  its focused Git integration tests.

## Agent workspace selection, September 13

- Agent guidance names the existing PR link/list/unlink tools, including explicit detachment and
  multiple repositories per thread. Full URLs identify each repository in multi-directory
  projects; stack listings include ordered URLs as well as numbers. Regression coverage
  distinguishes identical PR numbers in different repositories.
- Internal MCP exposes `thread_workspace_inspect`, `thread_workspace_create`, and
  `thread_workspace_select`, scoped to the authenticated thread and its project. Agents can
  create worktrees or multiwork copies, select existing checkouts, or return to the project
  root through normal thread metadata events. No force checkout or removal tools are exposed.
- The first substantive message includes brief workspace guidance when these tools are available.
  It favors task worktrees for implementation while respecting project notes, existing task
  checkouts, and explicit user choices. Agents must use the returned cwd during the current turn;
  the provider restarts in the selected directory on its next turn. Mid-turn selections also
  redirect checkpoint capture and status refresh, with a baseline prepared before editing.
- Sources: `apps/server/src/mcp/toolkits/workspace.ts`, `McpProviderSession.ts`,
  `project/ThreadWorkspaceInstructions.ts`, `project/ProjectMemory.ts`, and the provider/checkpoint
  reactors. Server-side behavior applies across web, desktop, mobile, and remote connections.

## Composer notices, September 12

- The Files tree names its primary root after the project, rather than its generated checkout
  directory. Additional roots use configured labels when present; actual checkout paths remain
  visible beneath the names. Source: `apps/web/src/components/files/FilePreviewPanel.tsx`.

- Composer banners use opaque backgrounds so chat text cannot show through. The resume
  compaction reminder puts its title and token count inline, wrapping on narrow screens while
  keeping actions visible. Applies to web and desktop, including mobile web.
  Sources: `ComposerBannerStack.tsx`, `ChatView.tsx`, and `apps/web/src/index.css`.

## Automatic worktree base and project notes, September 11

- Mobile web uses one continuous composer frame with full-width controls, removing the inset
  lower outline and overlap. Ordinary placeholders are hidden in collapsed and expanded phone
  layouts; the collapsed input retains its tap target. Desktop drawer styling is unchanged.

- New-worktree sends no longer stop with "Select a base branch" when the refs query is still
  loading. The composer keeps an explicit branch choice, otherwise uses the current checkout and
  finally `HEAD`; the agent can start and read project context without an extra blocking prompt.
  Source: `apps/web/src/components/ChatView.tsx` and `BranchToolbar.logic.ts`.
- Project memories are named as project notes in the agent instructions and settings. They remain
  stored by `project_id`, are available to every thread in that project, and retain on-demand MCP
  reads so full note content is not copied into every prompt. Cross-thread persistence has a
  regression test.

## Upstream sync, September 10

- Merged 117 upstream commits through `57aee3e19f`. The pre-merge fork checkpoint is
  `7690b027b3`, also retained as `backup/pre-upstream-20260910`.
- Kept project memory, multiwork provisioning and selectors, compact mobile/composer layouts,
  directory chips, collapsible chat images, account colors and stable account ordering,
  per-account usage, Git history, privacy defaults, and opt-in automatic settlement.
- Integrated upstream device and pull-request MCP tools alongside memory. Memory list parameters
  use an object-only schema compatible with the updated Effect MCP server. Provider credentials
  retain thread/project isolation and explicit capability checks.
- Registered upstream's multi-PR migration as 53, after this fork's memory migration 52.
  Upgrade tests verify memory contents survive and legacy PR links are backfilled.
  Sources: `apps/server/src/persistence/Migrations.ts` and migration tests.
- Multi-PR settlement uses upstream link snapshots with the fork's settlement modes. Usage pools
  retain stable account order even when reset times differ; upstream missing-window columns and
  unknown-cost reporting remain available. Sources: `ThreadSettlementReactor.ts`,
  `ThreadSettlementPolicy.ts`, `packages/shared/src/usageLimits.ts`, and `usageMerge.ts`.
- Right-click still closes panel tabs. Shift-right-click opens upstream's extended menu.
  Compact icon tabs and Git history remain available alongside device tabs and PR stacks.
- Validation uses scoped typechecks and focused tests only. No browser verification, live-data
  writes, app reinstall, or restart is part of this merge.

## Multi-directory composer chips, September 9

- Multi-directory projects use one horizontally scrollable row of colored directory chips in
  `apps/web/src/components/BranchToolbar.tsx`, in both expanded and collapsed composer layouts.
  Each chip opens its directory's path, color, workspace mode, branch, and agent guidance controls.
  Directory ordering and primary-directory permissions remain unchanged. Single-directory layout
  is unchanged. This applies to web, desktop, and mobile web, not the native mobile client.
- Validation: 76 toolbar logic tests and the web typecheck pass. Targeted lint reports existing
  toolbar warnings. Browser verification awaits permission. No reinstall performed for this change.

## Project memory and multiwork selectors, September 8

- Restored multiwork first-send provisioning after the upstream merge disconnected the UI mode
  from the clone service. Draft workspace selectors and the Files workspace selector list existing
  copies filtered by repository origin. File browsing does not change the agent's checkout.
- Reusing a multiwork leaves its branch, dirty files, unpushed commits, and local guidance alone.
  New copies preserve remote-tracked guidance and restore only missing context files. These rules
  follow the owner's multiwork skill. Sources: `MultiworkService.ts`, `ws.ts`, `ChatView.tsx`,
  `BranchToolbar.tsx`, `BranchToolbarEnvModeSelector.tsx`, and `files/filePreviewRoots.ts`.
- Project memories live in the T3 database under migration 52, not in checkout files. The first
  non-compaction user message gets a short manual and names/descriptions. Later messages do not
  repeat the index; MCP lists summaries, reads full entries on demand, and saves short entries.
  Tokens grant access only to their thread's project; memory access does not grant browser access.
- Web/desktop and mobile web Project Settings can add, read, edit, and delete memories. Separate
  project records on other environments retain separate memories. Native mobile receives the same
  server-side agent context and MCP tools; its settings UI is unchanged.
  Sources: `project/ProjectMemory.ts`, `mcp/toolkits/memory.ts`, `ProjectMemorySettings.tsx`,
  `packages/contracts/src/projectMemory.ts`, and `ProviderCommandReactor.ts`.
- Validation: memory persistence/isolation, first-message indexing with queued prompts, MCP
  capability separation, safe clone reuse, Files options, editor failure/confirmation behavior,
  and multiwork bootstrap have focused regression tests. No live-data writes or reinstall.

## Upstream sync, September 7

- Mobile web hides the ordinary prompt placeholder, preserving approval and question guidance.
  Multiple workspace roots use the horizontally scrollable compact context strip on mobile,
  retaining directory, branch, mode, and guidance controls without stacked rows.
  Sources: `ChatComposer.tsx` and `BranchToolbar.tsx`.
- Pooled limit bars keep alphabetical account order across all windows, with Personal before
  Work, rather than sorting segments by reset time. The reset schedule stays chronological.
  Shared web/desktop/mobile logic: `packages/shared/src/usageLimits.ts`; regression coverage in
  `usageLimits.test.ts` checks different window reset orders and refreshed balances.
- Merged 169 missing upstream commits through `8588d7f63`, including pooled subscription limits,
  account load balancing, cross-platform window capture, sidebar drag transitions, searchable
  project scopes, provider fixes, and composer scroll/layout fixes.
- Used upstream's Usage page and pooled Limits view as requested. Provider account badges retain
  configured accents; the fork's hourly breakdown still includes all 24 hours in chronological
  order. The old separate account-limit panel no longer replaces the upstream Limits tab.
- Used upstream's scroll-driven resting composer, multiline detection, and control relocation.
  The fork keeps a one-line minimum editor, tighter padding, a 40px expansion reservation, and
  an inline stash chip whose small menu does not expand the prompt. Attached banners use the
  fork's seam-covering glass rules.
- Audited overlapping fork changes after resolving conflicts. Restored file/video attachment
  uploads and retry guards, project-slot menu behavior, device-local inbox order, and section-sign
  shortcut recording around the new upstream paths. Preserved collapsible screenshots, inline
  turn plans, root-aware file panels, branch drift tracking, and default-off privacy/startup gates.
- Preserved all installed fork migration IDs through 49. Incoming branch-PR and active-order
  migrations run as 50 and 51. An upgrade regression test starts at 49 and checks that existing
  thread timestamps and multiple workspace roots survive.
- Kept the fork's Never default and open-PR protection for inactivity settlement. PR-bearing
  threads wait for a successful lookup; threads without a branch or saved PR can still settle
  before network work. Slow post-turn PR refresh runs separately from checkpoint processing.
- Backup: `backup/pre-upstream-sync-20260907` at `9ae821264`.
  No app rebuild, reinstall, restart, live-data writes, or push was performed.
- Validation: 1,307 focused tests across 47 files pass. Web, server, desktop, contracts, shared,
  and client-runtime native TypeScript checks pass; mobile passes `tsc`. Targeted lint has
  warnings but no errors. No browser or computer-use verification was performed.

## Upstream sync and collapsible chat images, September 5

- Merged all 350 missing commits from `upstream/main` through `ab67795dd`. The sync includes
  streaming timeline reuse, deferred attachment URLs and diff workers, hidden-terminal rendering
  fixes, bounded server history, provider updates, prompt history, citations, and usage-limit banners.
- Reconciled those changes around the fork's compact composer and stash chip, inline turn plans,
  multi-directory file navigation, uncached file reads, account-specific usage and limits, branch
  drift handling, and default-off provider checks, updates, keychain access, and automatic settlement.
  Restored missing row-level attachment loading and citation wiring after the fork-first merge.
- Web and desktop chat images have Hide image / Show image controls. Hiding a screenshot removes
  the preview without deleting the message. The choice survives virtualized row remounts and signed
  asset URL renewal during the current client session. Inline badges and icons stay unchanged.
  Sources: `apps/web/src/components/chat/CollapsibleChatImage.tsx`,
  `apps/web/src/components/ChatMarkdown.tsx`, and
  `apps/web/src/components/chat/MessagesTimeline.tsx`.
- Regression tests cover image hide/restore, turn-plan preservation during streaming, file-path
  case sensitivity, manual and signal-triggered uncached reads, and the fork's provider/settlement
  opt-ins. Checkpoint tests now observe the upstream pull-request invalidation service.
- Validation: 1,041 focused tests pass across web, server, desktop, contracts, shared helpers, and
  client runtime. Web, server, desktop, contracts, shared, and client-runtime native TypeScript
  checks pass. Mobile passes `tsc`;
  `tsgo` still reports React Navigation route typing errors. Targeted lint has warnings but no
  errors. No browser verification, app rebuild, reinstall, restart, or push was performed.
- `backup/pre-upstream-sync-20260905` preserves the pre-merge fork, including the composer and Astra
  changes committed before the merge.

## Composer spacing and GPT-6 Astra, September 4

- The web and desktop composer collapses to one row without hidden editor padding. Expanded
  drafts start at one line and grow with their text. Attached banners and the context strip
  overlap their backdrop edges to cover fractional-pixel seams.
- Stashed prompts use an inline chip and a small floating menu. Opening the chip preserves the
  collapsed composer. Sources: `apps/web/src/components/chat/ChatComposer.tsx`,
  `ComposerStashBadge.tsx`, `ComposerStashMenu.tsx`, `apps/web/src/components/ComposerPromptEditor.tsx`,
  and `apps/web/src/index.css`.
- Integrated upstream `bc03c3640` and `bfef973d9`: GPT-6 Astra is a current Codex model, and successful
  catalog refreshes remove retired models. Sources: `apps/server/src/provider/model-manifest.json`
  and `apps/server/src/provider/Layers/ProviderRegistry.ts`, with upstream regression coverage.
- Validation: 14 composer tests, four Codex inventory tests, ten manifest tests, and web/server
  typechecks pass. The broader registry run hits a startup-probe assertion outside these changes.
  Browser layout verification has not been run.

## Upstream merge policy

- Fork behavior wins when an upstream change touches the same feature. Merge upstream fixes and new
  code paths around the fork's defaults instead of restoring upstream behavior.
- Review persisted settings as well as source defaults. A changed schema default does not replace a
  value already written by an older build.
- Trace new alternate paths through the same fork policy. Linked pull requests, branch-discovered
  pull requests, desktop, web, and mobile must all use the same settlement rule.
- Add a regression test for each conflict found during an upstream sync. Do not rely on conflict
  resolution alone when Git can merge both versions cleanly.

## Privacy-Hardened Desktop Startup

- Packaged desktop auto-update checks are disabled by default.
  - Opt in with `T3CODE_ENABLE_AUTO_UPDATE=true`.
  - Source: `apps/desktop/src/app/DesktopConfig.ts`,
    `apps/desktop/src/updates/DesktopUpdates.ts`.
- Provider npm latest-version advisory checks are disabled by default.
  - Opt in with `T3CODE_ENABLE_PROVIDER_VERSION_CHECKS=true`.
  - The hosted model-classification manifest added upstream uses the same gate. Without the opt-in,
    provider checks use the bundled manifest or an existing disk cache and make no manifest request.
  - Source: `apps/server/src/provider/providerMaintenance.ts`,
    `apps/server/src/provider/ModelManifest.ts`.
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

## Multi-directory Projects

- A project can retain several filesystem roots, including a root that is also used by another
  project. The lightweight shell snapshot preserves the complete root list so live chat surfaces do
  not fall back to the primary directory after an update.
- Composer workspace and branch controls render one aligned stacked row per root. Root badges use a
  stable project palette; clicking a badge opens the predefined color picker and persists the
  selection in project metadata.
- Files renders every root across the full available height, titles sections with their directory
  names, and supports collapsing roots and dragging the horizontal dividers to rebalance their
  heights. Each tree toolbar also has a one-click collapse-all-directories control beside Refresh.
  Ignored entries remain visible with muted styling, and open file tabs are keyed by both root and
  relative path.
- Diffs exposes a directory selector for working-tree and branch comparisons and a collapsible
  directory-tree navigator for changed files instead of relying on a flat sequence of file headers.
  The tree/detail divider is draggable and persisted; selecting a tree file renders that file alone
  in the adjacent diff viewer.
- Each directory's branch row has an Agent guidance button. Its note is persisted with that
  directory, appears only in the configuration dialog, and is injected as private context on every
  agent turn. This supports different branch policies across directories (for example, commit
  directly to `main` in a private repo versus creating a task branch for larger work).
- Source: `packages/contracts/src/orchestration.ts`,
  `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`,
  `apps/web/src/components/BranchToolbar.tsx`, `apps/web/src/components/DiffPanel.tsx`,
  `apps/web/src/components/files/FileBrowserPanel.tsx`,
  `apps/web/src/components/files/FilePreviewPanel.tsx`, `apps/web/src/rightPanelStore.ts`.
- Validation: focused projection snapshot, right-panel, diff-file action, and file-preview tests;
  web typecheck.

## Git History Surface

- The thread right panel includes a Git History surface alongside Files, Diff, Terminal, and the
  other workspace tools.
  - Multi-directory projects can switch repositories from the surface header.
  - The current branch's latest 100 commits render as a dense graph-style timeline with merge
    markers, refs/tags, author, relative date, and short SHA.
  - Selecting a commit shows its complete message, author/date/SHA, changed files, per-file line
    statistics, aggregate additions/deletions, and binary-file indicators.
  - Commit-list/details and changed-files/diff columns are independently resizable and persisted.
    Changed files use the same hierarchical navigator and split/unified diff renderer as the Diff
    surface, with one selected file displayed at a time.
  - History and commit details use bounded, read-only Git RPCs and cached client query atoms; Git
    commands never run in the renderer.
- Source: `packages/contracts/src/git.ts`, `packages/contracts/src/rpc.ts`,
  `apps/server/src/git/GitHistory.ts`, `apps/server/src/git/GitWorkflowService.ts`,
  `packages/client-runtime/src/state/git.ts`, `apps/web/src/components/GitHistoryPanel.tsx`,
  `apps/web/src/components/RightPanelTabs.tsx`, `apps/web/src/rightPanelStore.ts`.

## Focused File Editing

- Undo/redo is routed directly to the editable file surface while its code editor has focus, so
  Cmd/Ctrl+Z cannot mutate the unfocused chat composer. Shift+Cmd/Ctrl+Z routes to editor redo.
- Source: `apps/web/src/components/files/FilePreviewPanel.tsx`,
  `apps/web/src/components/files/fileEditorUndo.ts`.

## Project File Tree Expansion

- The workspace file tree starts fully collapsed and expansion is opt-in, instead of rendering every
  directory open on mount. On a large workspace this is the difference between flattening tens of
  thousands of rows into the virtualizer and flattening the top level.
  - The tree's state is now a set of **expanded** directories rather than collapsed ones, so the
    empty initial state is the closed tree. `allDirectoryPaths` (a full-tree walk run on every
    rebuild purely to feed collapse-all) is gone, replaced by `ancestorDirectories`, which walks one
    path.
  - Opening a file expands exactly its ancestor directories and closes everything else, so the tree
    always shows where the current file lives and nothing more.
  - The collapse-all button now collapses everything **except** the path to the open file, rather
    than shutting the tree completely. Its label reads "Collapse all, keeping the open file".
  - Expansion no longer resets when the entries query refreshes. The reveal effect used to depend on
    the rebuilt directory list, so any refresh re-collapsed the tree under the user.
  - The diff file tree (`DiffFilesTreeNavigator`) deliberately keeps its expanded default: it lists
    only changed files, so a collapsed default would just add clicks.
  - Source: `apps/web/src/components/files/NativeProjectFileTree.tsx`,
    `apps/web/src/components/files/FileBrowserPanel.tsx`.
  - Validated with `nativeProjectFileTree.test.ts` (ancestor derivation, top-level entries, Windows
    separators and empty segments).

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

- `editor.navigateBack` / `editor.navigateForward` walk the editor's back/forward history.
  - Defaults are `ctrl+left` / `ctrl+right` plus `mod+[` / `mod+]`, both gated `!terminalFocus`.
    The `ctrl` pair is the requested one; macOS binds `ctrl+left`/`ctrl+right` to Mission Control
    spaces by default, so the `mod` pair ships alongside as the one that always reaches the app.
  - **This re-wires an orphaned feature.** `apps/web/src/editorNavigationStore.ts` and its tests
    survived, but every reference to the store was dropped in `57ce5ccc9` ("fix: reconcile upstream
    merge integration"), leaving back/forward dead since 2026-08-11 while the store still shipped.
  - History is recorded from one place, the active file surface in `ChatView`, so the file tree,
    markdown links, the file picker, and symbol jumps all feed the same history rather than each
    call site maintaining its own. Replaying a step lands on the entry just moved to, which
    `recordActiveLocation` already treats as a no-op, so back/forward never appends to history.
  - Source: `packages/contracts/src/keybindings.ts`, `packages/shared/src/keybindings.ts`,
    `apps/web/src/components/ChatView.tsx`, `apps/web/src/editorNavigationStore.ts`.

- `rightPanel.toggleMaximized` defaults to `mod+alt+m` here, where upstream ships the command with
  no default, and the fork's handler does more than upstream's.
  - Pressing it while the right panel is closed opens **and** maximizes in one go, so the shortcut
    never reads as a dropped key. It is a no-op in the sheet layout, which has no maximized state.
  - The fork originally shipped this as `rightPanel.maximize`; see the 2026-08-15 upstream sync
    below for the rename and the config migration it required.
  - Source: `packages/contracts/src/keybindings.ts`, `packages/shared/src/keybindings.ts`,
    `apps/web/src/components/ChatView.tsx`.

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
  - The thread's `worktreePath`/`branch` fields hold the copy and its branch, so the file tree/editor
    and VCS status follow it. New multiwork branches use `spilshchikov-<task>-<unique suffix>`;
    existing copies retain their current branch. Continuing a thread reuses its copy.
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
  - The current UI creates and reuses copies through the thread Workspace selector. The Files
    workspace selector also lists matching copies for browsing. This replaces the older sidebar
    copy dialog after the upstream sync; opening a copy as a separate project remains possible
    through the normal directory picker.
  - Source: `packages/contracts/src/multiwork.ts`, `packages/contracts/src/settings.ts`,
    `packages/contracts/src/rpc.ts`, `packages/contracts/src/ipc.ts`,
    `apps/server/src/multiwork/MultiworkService.ts`, `apps/server/src/server.ts`,
    `apps/server/src/ws.ts`, `packages/client-runtime/src/state/multiwork.ts`,
    `apps/web/src/state/multiwork.ts`, `apps/web/src/components/Sidebar.tsx`,
    `apps/web/src/components/settings/SettingsPanels.tsx`.
  - Validated with `MultiworkService.test.ts` (offline clone against a local bare remote: fresh
    branch + context restore, continuing an existing remote branch, reuse + list, and the
    not-a-repo failure).

## Resumable agent sessions (Claude Code / Codex)

- The server discovers existing CLI coding-agent sessions for a repo so they can be continued in t3,
  round-tripping with the CLIs (continuing writes back to the same on-disk session, so Claude Code →
  t3 → Claude Code stays one conversation).
  - `ResumableSessionDiscovery` (`apps/server/src/sessions/ResumableSessionDiscovery.ts`) scans, for a
    given cwd:
    - **Claude**: every configured Claude instance's config dir (`$CLAUDE_CONFIG_DIR`/`~/.claude`
      plus each `claudeAgent` provider instance's `configDir`, labeled by its display name) at
      `projects/<cwd-with-non-alphanumerics-as-dashes>/<session-id>.jsonl`. The session id is the
      filename; resume cursor is that id (the Claude Agent SDK resumes by session id).
    - **Codex**: `$CODEX_HOME`/`~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl`, newest-first and
      bounded, matched to the repo by the `session_meta` header's `cwd`. Resume cursor is
      `{ threadId: <id> }` (Codex `thread/resume`). Legacy rollouts without a `cwd` are skipped.
    - Each row carries title (first real user prompt, or a Claude `summary` fallback), `updatedAt`,
      message count, and a best-effort `active`/`idle` status from file mtime (the CLIs persist no
      definitive running/awaiting/completed flag, so live "background agent" state is approximated by
      recency rather than true attach).
  - Exposed over `sessions.listResumable` (`packages/contracts/src/resumableSessions.ts`, `rpc.ts`,
    `ipc.ts`, `ws.ts`, read scope), merged across providers and sorted by recency.
  - **Resume seam**: `thread.turn.start` gained an optional `resumeSession` seed
    (`packages/contracts/src/orchestration.ts`); the decider forwards it on
    `thread.turn-start-requested`, and `ProviderCommandReactor.ensureSessionForThread` honors it only
    on a thread's first (fresh) provider-session start — so a new t3 thread attaches to the chosen
    on-disk CLI session. Existing-thread turns are unaffected.
  - Source: the files above plus `apps/server/src/orchestration/decider.ts`,
    `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`, `apps/server/src/server.ts`.
  - Validated with `ResumableSessionDiscovery.test.ts` (Claude + Codex header/prompt/count parsing,
    project-dir encoding) and a manual run against the real `~/.claude*`/`~/.codex` stores.
- The project sidebar surfaces these sessions under a collapsible "Resume from CLI" group beneath
  each expanded project's own threads.
  - The list scans on demand — it mounts (and hits the disk) only when the user expands the group,
    not on every sidebar render. Rows show the session title, source provider/instance, relative
    time, and a green dot for recently-active sessions.
  - Clicking a row mints a fresh draft thread for the project, presets the model picker to the
    session's provider instance (using the model recovered from the session, so routing matches the
    resume cursor), and stashes a one-off resume seed keyed by the draft. The seed is consumed by the
    composer on that thread's first turn (`thread.turn.start.resumeSession`) and then cleared, so the
    new thread attaches to the existing CLI session and the conversation round-trips.
  - The model slug is also discovered per session (`ResumableSession.model`, parsed from the Claude
    assistant events / Codex `session_meta`) to drive the picker preset.
  - Source: `apps/web/src/components/sidebar/ResumeSessionsSection.tsx`,
    `apps/web/src/resumeSeedStore.ts`, `apps/web/src/hooks/useHandleNewThread.ts` (a `forceNew` +
    `onDraftCreated` option), `apps/web/src/components/ChatView.tsx` (turn-start seed),
    `apps/web/src/components/Sidebar.tsx`,
    `packages/client-runtime/src/state/projectCommands.ts` (the `listResumableSessions` query atom).

## Claude Profiles

- Claude provider instances support a dedicated `Claude config directory` setting.
  - The path is passed directly as `CLAUDE_CONFIG_DIR`, allowing named instances such as
    `Claude Personal` (`~/.claude-personal`) and `Claude Work` (`~/.claude-work`) to keep separate
    authentication and configuration.
  - Named Claude instances appear independently in the existing provider/model selector.
  - The older full `HOME` override remains available as an advanced compatibility option.
  - Upstream later reused the old `homePath` field for `CLAUDE_CONFIG_DIR`. This fork keeps the two
    controls separate: `configDir` sets `CLAUDE_CONFIG_DIR`, while `homePath` sets process `HOME`.
    Provider-session, status-probe, and text-generation tests use `configDir` so a future merge
    cannot silently swap those meanings again.
  - Source: `packages/contracts/src/settings.ts`,
    `apps/server/src/provider/Drivers/ClaudeHome.ts`,
    `apps/server/src/provider/Layers/ClaudeAdapter.test.ts`,
    `apps/server/src/provider/Layers/ProviderRegistry.test.ts`,
    `apps/server/src/textGeneration/ClaudeTextGeneration.test.ts`.

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

## Upstream Sync 2026-08-13

- Merged `upstream/main` (27 commits, merge base `f0b57ca23`) with `-X ours`, so fork-local code
  wins any conflicting hunk. Backup of the pre-merge tip: branch `backup/pre-upstream-sync-20260813`.
- Only two files conflicted: `apps/web/src/components/BranchToolbar.tsx` and
  `apps/web/src/hooks/useHandleNewThread.ts`. Every upstream-added line was checked against the
  merged tree afterwards; two upstream hunks were deliberately not carried over:
  - `apps/web/src/components/chat/ChatComposer.tsx` — upstream's model-picker alignment tweak
    (`-ms-3.5`/`ps-3.5` on the footer scroller, `triggerClassName="-ms-2.5"`, #6252) has no landing
    site because the fork rewrote that footer for stacked multi-root rows.
  - Nothing else. `BranchToolbar`'s conflict resolved to identical content, so upstream's composer
    resize motion (#6209) is intact.
- Upstream's new right-panel launcher (#6258) reads `action.shortcut` on every surface entry, which
  broke the fork-only Git History entry. It now carries `shortcut: "G"`
  (`apps/web/src/components/RightPanelTabs.tsx`); the letter was free alongside B/T/F/D/P/A.
- One upstream line was grafted back by hand after the conflict resolution dropped it:
  `carryComposerContentTo(draftId)` in `useHandleNewThread`, where the fork's
  `options?.onDraftCreated?.(…)` occupies the same hunk. Without it the upstream "keep the typed
  prompt when a draft changes repo" feature (#6393) was half-landed — `DraftHeroHeadline` passes
  `carryComposerContent: true` and hits exactly that path.

## Upstream Sync 2026-08-15

- Merged `upstream/main` (137 commits, merge base `6bc6cb6be`) with `-X ours`. Backup of the
  pre-merge tip: branch `backup/pre-upstream-sync-20260815`.
- **Right panel maximize converged on upstream's name.** Upstream shipped the same feature two days
  after the fork did (#5091). The fork's `rightPanel.maximize` was renamed to upstream's
  `rightPanel.toggleMaximized` so their tests and docs apply unchanged, while keeping the fork's
  `mod+alt+m` default and its open-and-maximize-in-one-press behavior. Two upstream expectations are
  therefore deliberately not carried:
  - `apps/server/src/keybindings.test.ts`'s `assert.isFalse(defaultsByCommand.has(…))`, since the
    fork does ship a default for it.
  - `docs/user/keybindings.md`'s "It has no default shortcut" sentence, rewritten to document
    `mod+alt+m` and the editor back/forward defaults.
  - Migration: an existing `keybindings.json` naming the old command becomes an invalid entry, and
    one invalid entry makes the server skip the **entire** startup default sync
    (`apps/server/src/keybindings.ts`, `syncDefaultKeybindingsOnStartup`). The live config was
    migrated in place with a `.bak-20260815` copy alongside it.
- Half-landed upstream work that `-X ours` left broken, caught by typecheck and grafted back:
  - `activeRepositoryRoot` in `DiffPanel.tsx` and `useRemoteOpenState` in `FilePreviewPanel.tsx`,
    both used but with their definitions dropped.
  - The `RemoteOpenTargets` mock layer in `apps/server/src/server.test.ts`.
- Upstream fixes the fork's own code had silently missed:
  - `diffFileActions.ts` computed `workspaceFilePath` and then opened the raw `filePath`, so a
    nested project's diff opened the wrong path (#6174). It now opens the resolved path while
    keeping the fork's workspace-root argument. Upstream's new test asserts the unkeyed surface id;
    the fork keys file surfaces by root, so that expectation was adapted rather than the behavior.
  - `markdown-clipboard.ts` gained upstream's copy-verbatim-inside-`<pre>` branch (#5069), placed
    ahead of the fork's Slack table transform.
- `apps/server/src/vcs/GitVcsDriverCore.ts`: upstream turned `runGit`'s fourth parameter from an
  `allowNonZeroExit` boolean into an `ExecuteGitOptions` object. The fork's five git-index call
  sites now pass `{ allowNonZeroExit: true }`.
- `docs/user/providers-claude.md` was restored. It went missing in the 2026-08-13 sync while
  `README.md`, `docs/README.md`, `docs/user/install.md`, and `docs/user/providers-codex.md` all kept
  linking to it. The 08-13 audit only compared files present in the tree, so a wholly absent file
  slipped through; this sync's audit checks for missing files too.

## Provider account limits

- The fork's account-limit service and versioned snapshots remain available for compatibility.
  They key readings by environment and provider instance, preserve Claude account isolation,
  normalize streamed usage windows, and avoid attributing ambiguous Codex transcripts.
- The September 7 sync adopts upstream's pooled Usage → Limits UI and provider probes. It
  deduplicates accounts across environments and hubs and keeps native provider account badges
  and configured accents. Do not restore the old panel over that tab in future merges.
- Sources: `apps/server/src/usage/AccountLimitsService.ts`,
  `apps/server/src/usage/accountLimitsNormalize.ts`,
  `apps/web/src/components/usage/UsageLimits.tsx`,
  `apps/web/src/components/usage/UsageLimitsPooled.tsx`.

## Recent file and panel freshness fixes

- An open text-file preview performs a fresh server read before displaying content and subscribes to
  filesystem invalidations only while that file is visible. Closing the preview stops the watcher;
  external edits then refresh the active file without polling every workspace file.
- Diff previews fetch the selected file on demand and bound the initial untracked-file overview, so
  large worktrees do not spawn one diff process per file before the user selects anything.
- Right-panel tabs are selected with a left click and closed only with a right click; the close icon
  and accidental middle-click closing path were removed. The composer collapse state is a transient
  scroll gesture and resets when changing threads rather than collapsing on thread open.
- Source: `apps/server/src/workspace/WorkspaceFileSystem.ts`,
  `apps/web/src/components/files/projectFilesQueryState.ts`, `apps/web/src/components/DiffPanel.tsx`,
  `apps/web/src/components/RightPanelTabs.tsx`, `apps/web/src/components/ChatView.tsx`.

## Review panel driven by a file list rather than one large patch

- The review diff overview now asks the server for the changed-file list alone (`includePatch:
false`) and fetches a patch only for the file on screen. `git diff --numstat -z` produces that
  list, so it is complete even when a patch would have hit the 120 KB preview cap. Untracked files
  are listed from `ls-files --others`; their line counts are reported as unknown rather than guessed,
  because counting them means reading every file.
- The changed-files tree renders from that list instead of from the parsed patch, so an empty,
  truncated, or failed patch empties only the code column. Previously a patch the parser could not
  use hid the whole panel, which is what made Working tree and Branch changes look empty.
- Selecting a file and rendering the "all files stacked" view (the tree hidden) each have their own
  query, and the panel's +/- totals come from the file list rather than from whichever patch happens
  to be loaded.
- Source: `packages/contracts/src/review.ts`, `apps/server/src/vcs/GitVcsDriverCore.ts`,
  `apps/web/src/components/DiffPanel.tsx`.

## Branch remote state, fetch, and pull

- Every local ref in the branch picker carries its upstream, ahead and behind counts, and whether
  the upstream is gone. They come from `for-each-ref`'s `%(upstream:track)` in the existing snapshot
  command, so listing refs costs no extra process. Rows show a blue down arrow for commits to pull
  and a green up arrow for commits not yet pushed.
- The picker has a fetch button that fetches and prunes the primary remote (`scope: "remote"`), which
  is what refreshes the counts of branches other than the checked-out one. A fetch now invalidates
  the cached ref list.
- A branch that is behind gets a pull button. The checked-out branch pulls with `--ff-only`; any
  other local branch fast-forwards through `git fetch <remote> <branch>:<branch>`, which git itself
  refuses when the update is not a fast-forward.
- A refused fast-forward is reported as `status: "diverged"` instead of as a command failure. The
  toast offers to open a fresh thread whose prompt states the branch, the upstream, the two counts,
  and git's own message, and asks the agent to choose between a rebase and a merge and to walk
  through each conflict.
- Source: `packages/contracts/src/git.ts`, `apps/server/src/vcs/GitVcsDriverCore.ts`,
  `apps/server/src/git/GitWorkflowService.ts`, `apps/server/src/ws.ts`,
  `packages/client-runtime/src/state/vcs.ts`, `apps/web/src/components/BranchToolbar.logic.ts`,
  `apps/web/src/components/BranchToolbarBranchSelector.tsx`.

## Branch drift follows a project checkout too

- A thread working in the project checkout, not a dedicated worktree, now adopts the branch it
  finished a turn on, the same way a worktree thread already did. A dedicated worktree still has to
  belong to exactly one thread before its branch is adopted; a project checkout has no such
  ambiguity. Without this a `git checkout` by the agent left the thread's recorded branch stale, and
  the client only attributes pull-request state to a thread whose recorded branch matches the
  checked-out one, so the thread silently lost its PR.
- Source: `apps/server/src/orchestration/Layers/CheckpointReactor.ts`.

## Sidebar thread arrangement

- Inbox rows can be dragged into any order, reusing the drag machinery the pinned block already had.
  The arrangement is client-local and persisted in `localStorage`; it never reaches the server,
  because it is a view preference rather than thread state.
- Threads the arrangement has never seen keep the slot the ordinary sort gave them, so a new thread
  still arrives at the top instead of sinking below a stale arrangement.
- Source: `apps/web/src/sidebarThreadOrderStore.ts`, `apps/web/src/components/Sidebar.tsx`.

## Composer and right-panel shortcut fixes

- The global shortcut listener registers once and dispatches through a ref. It used to re-register
  on every dependency change, which moved it behind listeners mounted later (the right-panel surface
  launcher, the composer), so a configured shortcut such as `§` reached the panel only sometimes.
- A character bound to a command is never inserted as text, whether or not a thread is open, and the
  `beforeinput` fallback covers any single character rather than only `§` inside the composer. macOS
  delivers the section-sign key to an editable surface as text input without a matching keydown on
  some layouts.
- Toggling a right panel whose tabs were all closed opens it on the Files surface instead of showing
  an empty shell, and reopening restores the surface that was selected before it was hidden. The
  maximize flag is keyed by the same thread as the panel state; keying it by the route desynced the
  two whenever a draft became a thread.
- Source: `apps/web/src/components/ChatView.tsx`, `apps/web/src/rightPanelStore.ts`.

## Composer density and the stash badge

- The editor must apply both `containerClassName` and `placeholderClassName`. The resting
  layout uses them to give the editor available row width and clip the placeholder to one line.
  Dropping these bindings makes an empty editor shrink and its placeholder spill over the toolbar.
- The editor starts at one line and grows with its text. The compact composer uses a single prompt
  row, and the expanded view keeps tighter padding than upstream.
- Losing focus alone does not collapse the prompt, and multiline drafts remain readable. The
  scroll-driven resting layout this section described is now removed, as recorded above.
- Stashes use an inline chip in the footer or relocated controls. The chip anchors a small floating
  menu; opening it does not expand the prompt.
- Sources: `apps/web/src/components/chat/ChatComposer.tsx`,
  `apps/web/src/components/ComposerPromptEditor.tsx`,
  `apps/web/src/components/composerFooterLayout.ts`.

## Resizable columns stretch their panes

- `ResizableColumns` put each pane in a flex item that never grew, so a pane was as wide as its own
  longest line and the rest of the column was clipped. Dragging the divider moved the split without
  the Git history commit description or diff reflowing into the space. Both panes now stretch.
- Source: `apps/web/src/components/ui/resizable-columns.tsx`.

## A finished pull request no longer settles its thread

- Upstream settled a thread the moment its change request closed, and settled a merged one unless
  `sidebarAutoSettleOnMerge` was off. One switch now governs both terminal states and defaults to
  off, so a merged or closed pull request leaves the thread in the inbox until it is settled by
  hand. Turning the switch on restores the upstream behaviour for both states.
- Mobile reads the same preference and defaults it the same way.
- Older upstream builds persisted `true` as their default. Client hydration resets that inherited
  value to `false`; the settings UI records later choices explicitly, so a deliberate opt-in stays
  enabled. This migration also covers pull requests linked directly to a thread.
- Source: `packages/client-runtime/src/state/threadSettled.ts`, `packages/contracts/src/settings.ts`,
  `apps/web/src/hooks/useSettings.ts`, `apps/web/src/components/settings/SettingsPanels.tsx`,
  `apps/mobile/src/features/threads/threadListV2.ts`.

## Claude settings keep account isolation

- Upstream's **Auto-compact after** field appears alongside the fork's `CLAUDE_CONFIG_DIR` field.
  The last merge kept both schema fields but resolved the form order to the fork-only list, which
  left the new control after the ordered fields and produced contradictory tests.
- Source: `packages/contracts/src/settings.ts`,
  `apps/web/src/components/settings/ProviderSettingsForm.test.ts`.

## Manual settlement shortcut remains available

- `mod+shift+s` settles or restores the active thread while the terminal is not focused. The merge
  had the web handler and documentation but dropped the default binding from the shared list because
  it landed beside the fork's numbered project-slot bindings.
- Source: `packages/shared/src/keybindings.ts`, `apps/server/src/keybindings.test.ts`,
  `apps/web/src/components/ChatView.tsx`, `docs/user/keybindings.md`.

## Thread and project accent colours

- Right-clicking a thread offers a Colour submenu: ten muted tones or none. The colour enters the
  card from the left as a gradient that gives out by 29% of the width, over a two-pixel rule on the
  leading edge. The tail fades to transparent rather than to a fixed dark, so the same colour reads
  correctly on either theme.
- A project takes a colour in its settings, from the same ten or any custom colour. It marks that
  project's threads from the right, and only while the sidebar is showing every project: scoped to
  one project it would paint every row alike and say nothing. Both gradients combine on one card.
- The project's colour also washes its row in the sidebar's project scope menu and the trigger that
  shows the current scope.
- Colours are stored per device alongside the sidebar thread arrangement. They describe one
  person's view of the work rather than the state of a thread or a project, so nothing crosses the
  wire. Nothing is coloured until you colour it.
- Source: `apps/web/src/lib/accentColors.ts`, `apps/web/src/accentColorStore.ts`,
  `apps/web/src/components/threadActionMenu.logic.ts`, `apps/web/src/components/Sidebar.tsx`,
  `apps/web/src/hooks/useThreadActionMenu.ts`,
  `apps/web/src/components/settings/ProjectSettingsPanel.tsx`.

## Open on the host as its own button

- The pull-request panel puts "Open on GitHub" (or GitLab, Bitbucket, Azure DevOps) beside the merge
  action rather than only inside the overflow menu. It is the action most reached for after the
  merge, and a menu entry made it a two-step.
- Source: `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx`,
  `apps/web/src/components/pullRequest/pullRequestLinkContextMenu.ts`.

## Numbered project slots on mod+1..9

- `mod+1`..`mod+9` scope the sidebar to a project rather than jumping to the Nth thread. Hovering a
  project in the scope menu and pressing `ctrl+1`..`ctrl+9` puts it in that slot; the slot is shown
  on the row afterwards, and a project answers to one slot at a time. The file structure view moved
  from `mod+1` to `mod+shift+1`, since a slot shadowed by another binding is worse than a longer
  chord.
- `thread.jump.*` remains a bindable command, just not a default. A config written against the old
  bindings is migrated on startup: numbered thread jumps become the matching project slots and a
  `mod+1` file-structure rule moves to `mod+shift+1`. Without the migration the backfill would
  refuse to add the new defaults, because the rules being replaced already claim those shortcuts.
- Which project a number recalls is stored per device: it is a habit built at one desk, not a
  property of the project.
- Source: `packages/contracts/src/keybindings.ts`, `packages/shared/src/keybindings.ts`,
  `apps/server/src/keybindings.ts`, `apps/web/src/projectSlotStore.ts`,
  `apps/web/src/components/Sidebar.tsx`.

## Usage account identity and colours

- Usage sources keep the configured provider instance so transcript attribution remains distinct
  for separate accounts. The September 7 sync deliberately adopts upstream's historical chart
  presentation and pooled limits UI instead of the fork's separate account spend cards.
- Native account badges in pooled limits reuse configured provider accents. The fork's
  past-24-hours breakdown keeps every hour in chronological order.
- Each pooled account segment uses its configured accent for the remaining fill, reset hatching,
  and name marker, with the provider color as fallback. A persistent colored edge identifies
  exhausted accounts too. Narrow-screen legend rows use the same colors and keep account names.
- Sources: `packages/contracts/src/usage.ts`, `apps/server/src/usage/UsageService.ts`,
  `packages/shared/src/usageMerge.ts`, `apps/web/src/components/usage/UsageLimitsPooled.tsx`,
  `apps/web/src/components/usage/UsagePage.tsx`.

## Deleting from the file tree

- Right-clicking a file or a folder in the Files tree offers to delete it, which previously needed a
  multi-select and a toolbar button. Folders had no context menu at all before. A folder's menu drops
  the two items that mean nothing for it (copy mention, add to chat), and the confirmation says when
  a folder takes its contents with it.
- Backspace (or Delete) removes the selected entries while the file list has focus, and the delete
  can be taken back with the platform's undo chord or the toast's Undo. Shift-click ranges and
  Cmd-click toggles were already there and now feed both.
- Undo restores from contents read just before the delete. It is offered only when every entry in
  the set is a whole text file under 8 MB in total: a folder, a binary, or a file too large to have
  been read in one piece cannot be reconstructed, and a partial restore reads as a working undo
  while quietly leaving work behind. The confirmation says which of the two it is going to be.
- The undo entry is scoped to the directory it was taken from, and the panel takes focus after a
  delete so the chord still has somewhere to land once the rows unmount.
- Source: `apps/web/src/components/files/FileBrowserPanel.tsx`,
  `apps/web/src/components/files/NativeProjectFileTree.tsx`,
  `packages/client-runtime/src/state/projectCommands.ts`.

## Revealing a file keeps the rest of the tree open

- Opening a file expanded its ancestors by replacing the expanded set, so opening something in one
  directory shut every directory the reader had opened elsewhere. The reveal now adds its ancestors
  to what is already open. Collapsing the tree stays the collapse button's job.
- Source: `apps/web/src/components/files/NativeProjectFileTree.tsx`.

## A configurable app accent

- Appearance takes an accent colour: eight presets or any colour from the platform picker. It drives
  primary buttons, the focus ring, the send action and the update pill, all of which derive from
  `--primary`. Unset by default, which leaves the stock blue exactly where it was.
- A chosen colour keeps its hue and chroma but is pulled into the lightness band the stock accent
  occupies, separately per appearance, since that band is what everything painted on the accent was
  contrast-checked against. The label colour is then picked for readability on the result, so a pale
  yellow and a deep navy both stay legible. A grey, having no hue to preserve, is placed at the
  standard lightness rather than left to dissolve into the surface.
- Stored as hex and parsed again at the point it reaches the document, so neither the settings file
  nor the runtime can put arbitrary CSS into a custom property. It is written as an inline property
  on the root element; theme palettes only ever set `--app-theme-*`, so the two do not fight, and an
  explicit accent wins over the active theme's until it is cleared.
- Source: `packages/contracts/src/settings.ts`, `apps/web/src/themePalette.ts`,
  `apps/web/src/routes/__root.tsx`, `apps/web/src/components/settings/SettingsPanels.tsx`.

## Dragging a thread plays once

- Auto-animate sits on the thread list, so the drop's reorder was FLIPped through as a fresh
  animation: the row travelled back to where it started and then replayed, by itself, the move the
  pointer had just made. It is held off for the commit that lands the new order and switched back on
  a frame after that has painted, so a drag now reads as one movement.
- Sortable rows also opted out of dnd-kit's own layout animation. The drop commits the order itself,
  so the row is already where it belongs by the time dnd-kit would animate it there.
- The dragged card lifts instead of fading: a shadow and a faint accent ring on the card rather than
  80% opacity on the row, since the card being moved is the one that most needs to stay readable.
  Its `content-visibility` is pinned while it moves, which stops a long drag blanking the card as it
  crosses out of view.
- Source: `apps/web/src/components/Sidebar.tsx`.

## Markdown links open against the document's own checkout

- A link inside a previewed markdown file opened a file surface with no workspace root, so the panel
  fell back to the thread's checkout. Reading a document from the project while the thread runs in a
  worktree therefore produced dead links: the path was correct, the tree it was looked up in was
  not. The surface now carries the root the link was resolved against, which is the root the
  document itself was read from.
- The basename lookup behind a bare `notes.md` link searched the document's directory rather than
  its workspace root. The entry index is keyed by root, so a document in a subdirectory found
  nothing to disambiguate with.
- Source: `apps/web/src/components/ChatMarkdown.tsx`.

- Chat file links are resolved against the complete multi-directory project, not only the thread's
  primary checkout. Absolute links select the configured root that contains the file. Relative
  links may start with a directory basename or its configured label, which is stripped before the
  file tab opens. Every relative path, including a path such as `yb-cli/internal/file.go` with no
  project-directory prefix, is checked against every root on click. Bare filenames use the same
  lookup, with the active checkout first. This resolution happens while opening the link, so old
  chat messages gain the corrected behavior without being rewritten. External host files remain
  absolute and read-only.
- The selected file tab stores both the relative path and its owning workspace root. This prevents
  the file viewer from asking the primary directory to read a path owned by a secondary directory.
- Source: `apps/web/src/components/ChatMarkdown.tsx`, `apps/web/src/markdown-links.ts`,
  `apps/web/src/workspaceBasenameLookup.ts`. Regression coverage:
  `apps/web/src/markdown-links.test.ts`, `apps/web/src/workspaceBasenameLookup.test.ts`.

## The right panel's shortcuts answer from anywhere

- They are owned by one listener mounted at the app root, ahead of everything else, instead of by
  whichever chat view happened to be mounted. That is what made a bare printable binding — `§` on a
  Mac ISO layout — work on some routes and type itself into a field on others, and it is why it
  sometimes lost to a listener registered later. Settings is the one exception: it is where the
  binding is read and edited, so a keypress there belongs to the page.
- The key is claimed whether or not there is a thread to act on. A binding that types itself in some
  places and not others is worse than one that occasionally does nothing.
- Maximize moved from chat-view state into the panel store, where the rest of the panel's state
  already lives, so the same listener can own both shortcuts.
- Hiding a panel now gives up its maximized state, in every direction and by every route out
  (toggle, close, closing the last tab). A panel hidden while maximized used to come back filling
  the workspace, which left the chat column at zero width — the chat looked blank until switching
  threads changed the key the stale flag hung on.
- Source: `apps/web/src/components/RightPanelShortcuts.tsx`, `apps/web/src/rightPanelStore.ts`,
  `apps/web/src/components/ChatView.tsx`, `apps/web/src/routes/__root.tsx`.

- The macOS ISO section-sign key is treated as one physical shortcut pair across Electron versions.
  Plain `§` toggles the right panel. Shift on that key, which macOS emits as `±`, toggles the
  panel's maximized state and toggles it back. The matcher accepts `§`, `±`, and Electron's
  `Unidentified` key value with the physical key code. The `beforeinput` fallback reconstructs the
  missing Shift state from `±`, so neither character reaches the chat editor.
- Regression coverage: `apps/web/src/keybindings.test.ts` exercises keydown and modifier-less text
  input for both commands.

## User documentation for the fork's behaviour

- `docs/user/` now covers what this fork changed for a reader: numbered project slots and the
  keybinding migration that lands them, the app-wide right-panel shortcuts, inbox drag ordering and
  thread colours, a finished pull request no longer settling its thread, the per-account usage
  breakdown, branch ahead/behind with fetch and pull, and file-tree selection, deletion and undo.
- Two pages are new, `appearance.md` and `files.md`, both listed in `docs/README.md`.
- Source: `docs/README.md`, `docs/user/keybindings.md`, `docs/user/thread-sidebar.md`,
  `docs/user/project-settings.md`, `docs/user/usage.md`, `docs/user/source-control.md`,
  `docs/user/appearance.md`, `docs/user/files.md`.

## Upstream sync: 2026-08-20

- Rebased the fork's merge base forward from `d484735c6` to upstream `main` at `8824f8f24`.
- Preserved the fork's multi-directory projects, per-account Claude usage limits, file-tree selection and deletion, markdown-link roots, app-wide right-panel shortcuts, prompt collapse, thread colours, and right-click-only tab closing while integrating the upstream web, server, desktop, mobile, contracts, and runtime changes.
- Kept the account-limit implementation from PR #5739 (`54d006d52`); that PR is not an ancestor of current upstream `main`, so its behavior was reconciled explicitly rather than relying on the upstream branch to contain it.
- Added focused merge validation for the composer, thread actions, status indicators, right-panel tabs, usage attribution, and thread-settlement rules. The resolved merge is intentionally left uncommitted so it can be reviewed before it is recorded or pushed.

## Upstream sync audit: 2026-08-26

- Audited merge `7f25b7c35`, whose parents are the fork at `3166b39d55` and upstream at
  `b0a028126`. The audit covered every file changed on both sides, not only Git's conflict list.
- Preserved the fork's pull-request settlement policy across branch-discovered and linked pull
  requests. Old upstream-persisted `true` values now migrate to the fork default until the user
  explicitly enables the setting.
- Kept automatic hosted model-manifest requests behind
  `T3CODE_ENABLE_PROVIDER_VERSION_CHECKS=true`, matching the fork's existing network policy.
- Reconciled Claude settings so `configDir` remains the account-isolation control while `homePath`
  remains the advanced process `HOME` override. Upstream's auto-compaction control appears beside
  both instead of replacing either one.
- Restored upstream's manual settlement shortcut without taking back the fork's `mod+1..9` project
  slots.
- Repaired the migration number collision. Migration 41 runs both additive changes on a fresh
  database, and compatibility migrations 43 and 44 repair databases created from either history.

## Upstream sync: Codex 0.150 compatibility

- Merged upstream `main` through `d3c24a14b` in merge commit `87d9027dc`, while preserving the
  fork's existing behavior and restoring all in-progress local work afterward.
- Included upstream's Codex 0.150 protocol compatibility fix. Generated schemas now accept the new
  multi-agent tools, the `interrupted` tool-call status, and completed subagent activity events.
- Included upstream's static active-list behavior for restored threads: explicitly un-settling a
  thread re-anchors it at the top without allowing ordinary activity to reorder the sidebar.
- Moved upstream's new `ProjectionThreadsUnsettledAt` migration from 43 to 45. IDs 43 and 44 remain
  reserved for this fork's existing migration-collision compatibility repairs.
- Kept finished pull requests from settling threads unless the user explicitly enables
  **Auto-settle finished threads**; the new upstream paths do not bypass that fork policy.
- Imported upstream's release/preview workflow improvements and v0.0.35 package metadata without
  building, installing, restarting, or otherwise touching the currently running app.

## Upstream sync: 2026-08-28

- Merged upstream `main` through `0bbecfabf` in merge commit `a370f51a7`, then restored the
  fork's staged in-progress work. The pre-merge tree remains recoverable from
  `backup/pre-upstream-sync-20260828` and the `pre-upstream-sync-20260828-fork-work` stash.
- Reconciled upstream's exclusive thread-settling policy with the fork rule. Automatic settling is
  now one explicit choice — **Never**, **Pull request merged or closed**, or **Inactivity** — and
  defaults to **Never**. Missing or malformed pull-request timestamps keep a thread active.
- Kept migration IDs 43 and 44 reserved for the fork's compatibility repairs and retained
  `ProjectionThreadsUnsettledAt` as migration 45.
- Preserved multi-directory projects, account-specific Claude usage, account limits, markdown links
  rooted in the document checkout, project scripts/actions, right-panel behavior, typography,
  branch controls, and the fork's provider/network defaults while integrating upstream Codex 0.150
  plans, OpenCode child-session support, provider catalogs, mobile themes, preview fixes, and
  provider/settings improvements.
- Repaired clean-merge semantic collisions found by typechecking: appearance contrast, account-limit
  RPC imports, provider skill menus, mobile settlement state, usage attribution including Grok,
  OpenCode output bounds, analytics test wiring, and provider-refresh compatibility.

## Fork guarantee audit: 2026-09-01

- Added a host filesystem subscription for every visible workspace tree. Directory and file
  changes now arrive through `projects.watchEntries`, are coalesced before crossing RPC, and
  invalidate the Files tree, Git status, Working tree / Branch changes, and the Commit view. This
  does not depend on Claude, Codex, or another provider reporting a `file_change` or
  `command_execution` activity event; those events remain a supplemental refresh path.
- Workspace file contents and full tree listings do not use the client query cache. Their query
  atoms retain no previous value, have a zero idle TTL, and deliberately render an empty loading
  state while each disk request is in flight. Opening a file, reopening the Files surface, toggling
  the right panel, or pressing Refresh therefore completes a new server read before any contents or
  entries are shown. The non-Git tree fallback also refreshes its filesystem index before every
  listing instead of returning an older index snapshot.
- A visible file keeps its narrower per-file watcher, while each visible tree has a root watcher, so
  content rewrites and directory membership changes trigger another uncached read without relying
  on provider activity events. Image URLs and open per-file commit diffs retain their own mutation
  refresh behavior.
- The Files panel now maps the project's primary directory slot to the thread's active checkout or
  worktree. Previously, passing the project's multi-directory configuration replaced that active
  root with the original checkout, so an agent could update a worktree while Files repeatedly read
  an older same-named file from the main checkout. Secondary project directories keep their
  configured roots.
- The file tree has its own worktree dropdown. It reads Git's live worktree list, shows the branch
  and absolute path for each checkout, orders them by latest branch commit, and switches only the
  Files panel root without changing the thread workspace or checking out a branch for the agent.
- Workspace selector synchronization cannot mutate a started thread. Only an explicit pointer or
  keyboard item choice may detach a worktree. An intentional switch to **Current checkout** now
  stores that checkout's real branch together with the null worktree path, preventing a thread from
  advertising its old worktree branch while Files and the next agent use the main checkout.
- Kept editable-file optimistic contents authoritative until their save settles, then applies any
  pending external refresh. Multi-directory pending state is keyed by workspace root as well as
  relative path, so the same file name in two roots cannot suppress the wrong refresh.
- Restored the documented editor surfaces deleted or orphaned by merge reconciliation: Search
  Everywhere, symbol navigation, back/forward history, clickable breadcrumb navigation, Files /
  Structure / Commit explorer switching, and per-file Commit diffs. The restored integration uses
  the current multi-root, resizable explorer and current diff renderer rather than reverting those
  newer fork changes.
- Restored the persisted **Editor tabs** preference and its Settings/Search Everywhere controls.
  Hidden-tab mode retains compact surface icons and the add-surface control.
- Restored the default-off `T3CODE_ENABLE_SAFE_STORAGE_KEYCHAIN` gate so ad-hoc local builds do not
  touch macOS Safe Storage unless explicitly opted in.
- Audited every repository path named in this file; all documented source paths are present.
- Source for the filesystem subscription:
  `apps/server/src/workspace/WorkspaceEntries.ts`, `apps/server/src/ws.ts`,
  `packages/contracts/src/project.ts`, `packages/contracts/src/rpc.ts`,
  `packages/client-runtime/src/state/projectCommands.ts`,
  `packages/client-runtime/src/state/runtime.ts`,
  `apps/web/src/components/files/projectFilesQueryState.ts`,
  `apps/web/src/components/files/filePreviewRoots.ts`,
  `apps/web/src/components/files/FilePreviewPanel.tsx`,
  `apps/web/src/components/BranchToolbar.logic.ts`,
  `apps/web/src/components/BranchToolbarEnvModeSelector.tsx`,
  `apps/web/src/components/DiffPanel.tsx`, and
  `apps/web/src/components/files/GitChangesPanel.tsx`.

## Upstream sync: Claude Fable 5.1 and server-side settlement

- Merged upstream `main` through `163d50846`, including Claude Fable 5.1, manifest-driven Claude
  model discovery, provider and chat performance fixes, Electron 43 preview fixes, and the new
  thread-reference shortcut.
- Claude Fable 5.1 is bundled as `claude-fable-5-1` and requires Claude Code 2.1.257. The installed
  CLI already meets that boundary.
- Kept remote model-manifest requests behind `T3CODE_ENABLE_PROVIDER_VERSION_CHECKS=true`. The
  bundled Claude catalog works without that opt-in; future manifest-only model additions require
  the opt-in or another fork build.
- Adopted upstream's server-side settlement reactor so web, desktop, and mobile use one projected
  state. Preserved the fork's exclusive policies: **Never**, **When PR merges or closes**, and
  **After inactivity**. **Never** remains the default.
- Preserved per-account Claude usage attribution while integrating append-only transcript scans,
  and preserved the fork's project slots, thread colours, composer stack, multi-directory files,
  and app-wide right-panel behavior.
- A recovery branch named `backup/pre-fable-5-1-upstream-sync-20260901` points to the pre-merge tip.

## Upstream sync: 2026-09-02

- Synced `upstream/main` at `0681d8549` (upstream v0.0.38), including the latest pull-request,
  provider-skill, desktop-prerequisite, chat timeline, error-report, and performance fixes.
- Resolved the merge manually with fork behavior taking priority wherever the same code path was
  touched. In particular, multi-directory roots, fresh file reads and listings, worktree-aware
  files and diffs, right-click-only tab closing, the `§` shortcut, prompt/live-follow behavior,
  per-account Claude usage and limits, and default-off automatic settlement remain fork behavior.
- Reconciled upstream's newer timeline presentation and attachment/media paths with the fork's
  work-log grouping and live activity rows. Failed tool activity remains visible and selected file
  diffs remain on-demand so large worktrees do not eagerly load every file.
- Restored the fork's test-only atom reset and made updater tests opt in explicitly to the otherwise
  disabled auto-update path. The product default remains privacy-safe and opt-in.
- Validation for this sync: all package TypeScript checks pass with zero errors; focused web
  timeline, markdown-link, and file-freshness tests pass (160 tests); desktop updater tests pass.

## Upstream sync: 2026-09-03

- Merged `upstream/main` through `617edab65`, covering 169 upstream commits since the prior merge.
  The sync includes Antigravity provider support, browser profiles and cookie import, provider
  limit refreshes, project icons and auto-pull, diff-tree and preview improvements, current Codex
  compatibility, and the latest chat, settings, desktop, and performance fixes.
- Reconciled the merge semantically after the fork-first Git merge. Multi-directory projects,
  worktree-aware fresh file reads, multi-root markdown links, the `§` and `Shift+§` right-panel
  shortcuts, right-click-only tab closing, the compact project/composer strip, and the fork's
  thread-settlement policy remain authoritative.
- Kept per-account Claude and Codex limits while accepting the new provider-neutral limit event
  shape. Canonical 300-minute and 10,080-minute windows map back to the fork's 5h and weekly rows,
  and raw provider payloads remain available for account-specific parsing.
- Reserved migration IDs 43 through 45 for the fork and assigned the incoming upstream migrations
  IDs 46 through 49, avoiding collisions for both existing and newly created databases.
- Repaired timeline integration so completed activity remains present-tense while a turn is still
  active, single completed tool calls render directly, and the fork's activity presentation still
  receives upstream tool identity, browser, and image metadata.
- Validation for this sync: the complete workspace TypeScript check passes. Full web (3,712 tests),
  mobile (1,183 tests), relay (209 tests), and contracts (339 tests) suites pass with bounded
  concurrency. Focused server and fork regression coverage passes for settlement, per-account
  limits, bootstrap cleanup, entrypoint handling, Antigravity discovery, keybindings, multi-root
  links, file freshness, tabs, branches, and timeline behavior.

## Validation Notes

The fork-local changes above were validated with focused server tests, the full web unit suite,
Chromium component tests, formatting/lint checks, TypeScript checks, and earlier full
desktop/provider checks while preparing the macOS build.
