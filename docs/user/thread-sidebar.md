# Working with threads

Use a new thread for a separate task. Choose **New worktree** when its code changes
need a separate branch and working directory.

## Start a thread

Pinned threads can still move to **Settled** when the selected automatic settlement policy applies.
Their pin order remains intact if they return to the active list.

Each environment owns one automatic settlement policy. The server checks it even when no web,
desktop, or mobile client is connected. The default is **Never**, so threads move only when you
settle them manually. **When PR merges or closes** settles a thread only when the finished pull
request is not older than the user's latest activity. **After inactivity** uses the configured day
count and keeps threads with open pull requests active. Active work, pending input, and live
background work always keep the thread active. Change the policy in **Settings > General**. A
settings change affects future settlement and does not reopen a settled thread.

The change is written to every environment you are
connected to at that moment. An environment that is offline keeps its old value. When a connected
environment holds a different value, **Settings > General** shows a warning that names it. Choose
**Apply to all** to write your current values to every connected environment. The same applies to
the new-thread workspace mode and the source control writing style.

Pin a thread from its menu to keep it above your active work. Drag pinned threads
to reorder them on web and desktop, or use **Move up** and **Move down** on mobile.
The order syncs across devices.

Right-click a pull request link in a thread and choose **Link to thread** to show that pull request
in the sidebar. With the finished-pull-request policy selected, that linked request can settle the
thread. Right-click the same link and choose **Unlink from thread** to remove it.

## Settle finished work

Threads in the inbox below the pinned section can be dragged into any order too. That arrangement
is kept on the device you set it on rather than shared, and a thread the arrangement has not seen
before still arrives at the top rather than below it.

## Colors

Right-click a thread and choose **Colour** to mark it with one of ten muted colors, or **No
colour** to clear it. The color enters the card from the left and fades out across it.

A project can carry a color of its own, set in its settings. It marks that project's threads from
the right, and only while the sidebar is showing every project — scoped to one project it would
paint every row alike. A thread with its own color shows both at once, one from each side. Nothing
is colored until you color it, and colors are kept on the device you set them on.

## Finished pull requests

A thread whose pull request merges or closes stays where it is under the default policy. Select
**When PR merges or closes** in Settings if those events should settle threads automatically.

If reordering is unavailable for one environment, update the T3 Code server running in that
environment. Older servers can still pin and unpin threads, but do not understand synced ordering;
their pinned threads keep the default newest-first order below the ones you have arranged.

By default, environments settle inactive threads after three days and settle
threads whose pull request merged. A closed pull request can also settle an idle
thread. Work in progress, pending questions or approvals, and live background work
prevent automatic settlement. An open pull request does not prevent inactivity
settlement, but an old closed or merged pull request does not settle work you
resumed after it closed.

Change these rules in **Settings → General**. They continue to run when your apps
are closed. Changes apply to connected environments that support shared settings;
offline environments and older servers keep their previous values. If connected
environments disagree, **Apply to all** copies your current settings to those named
in the warning. Changing a rule does not reopen already settled threads.

## Link a pull request

On web and desktop, right-click a pull request link in a thread and choose
**Link to thread**. Use **Unlink from thread** on the same link to remove it.
The linked pull request participates in automatic settlement.

## Find and reference work

On web and desktop, open the command palette with `Cmd/Ctrl+K` to search threads
across connected environments. Message search starts after two characters and
includes your messages and final agent responses.

Use **Settings → Keybindings** to find or customize shortcuts for searching files
and copying a thread reference. A copied reference uses the thread's pull request
link when available, otherwise its thread ID. See [keybindings](./keybindings.md)
for custom configuration.

## Inspect agent work

On web and desktop, use **Agents** to follow work delegated to subagents.

Expand a tool call in the conversation to see its full command and output.
Summaries shorten shell wrappers and can still describe the latest call after it
finishes; the call's own result shows its status.
