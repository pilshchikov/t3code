# Browse and edit files

The **Files** tab in the right panel shows a project's directories. Opening a file expands the
directories above it and leaves the rest of the tree as you had it; use the collapse button to shut
the tree.

## Switching workspaces

Use the workspace menu above the file tree to browse a live Git worktree or an existing multiwork
copy of the same repository. Multiwork copies come from the configured multiwork directory. The
menu orders worktrees by latest branch commit, newest first, and shows each branch with its absolute
path. Switching here changes only the Files panel; it does not move the thread or check out another
branch for the agent.

## Selecting

Click a file to open it. Shift-click extends the selection to a range, and Command-click (Control
elsewhere) adds or removes a single file, for picking out files that are not next to each other.

## Deleting

Right-click a file or a folder and choose **Delete**. A folder takes its contents with it, and the
confirmation says so. With several files selected, press Backspace to delete all of them at once.

A delete can be undone with the platform's undo shortcut while the file list has focus, or from the
**Undo** action on the toast that confirms it. Undo is only offered when every deleted entry is a
whole text file small enough to hold on to — a folder or a binary cannot be reconstructed — and the
confirmation tells you which of the two it is going to be before you commit.

## Links inside a file

A link in a rendered Markdown file opens against the checkout the document itself was read from. A
plan file read from your project checkout links to files in that checkout, even while the thread
you are in is working in a worktree.

## Open in an editor

OpenIDEA is selected by default when installed. Choose another installed editor in the **Open in**
menu to remember that choice for projects, file links and the editor shortcut.

For another tool, choose **Configure custom command…** in that menu or go to
**Settings → General → Open in**. Enter an executable and one argument per line, then choose
**Save and use command**. `{path}` inserts the path without a line suffix; `{line}` and `{column}`
insert the position, defaulting to 1. `{target}` keeps the complete path and position. The path is
appended when neither path placeholder is present. Arguments do not need shell quoting. To run a
shell script or pipeline, select the shell executable and pass its script as an argument.

Custom commands run through the selected local environment. Remote projects retain their SSH
editor links; OpenIDEA does not currently advertise an SSH editor protocol. **Remove command**
clears the custom command and returns to the OpenIDEA default where available.
