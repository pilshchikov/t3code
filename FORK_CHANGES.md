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
  - Cmd/Ctrl-click on a breadcrumb reveals that parent directory in the file tree.
  - Source: `apps/web/src/components/files/FilePreviewPanel.tsx`,
    `apps/web/src/components/files/filePath.ts`.

## Validation Notes

The fork-local changes above were validated with focused tests, formatting/lint checks for touched
files, TypeScript checks for `apps/web`, and earlier full desktop/provider checks while preparing
the macOS build.
