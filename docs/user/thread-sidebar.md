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

Pin a thread from its menu to keep it above your active work.

Right-click a pull request link in a thread and choose **Link to thread** to show that pull request
in the sidebar. With the finished-pull-request policy selected, that linked request can settle the
thread. Right-click the same link and choose **Unlink from thread** to remove it.
On web and desktop, you can also drag files from your computer onto any thread row:
the thread opens and the files are attached in its composer, ready for
your next message. The same per-message file limits apply as when attaching
files directly; see [Attach files](./composer.md#attach-files).

On web and desktop, pinning or unpinning a thread keeps the sidebar at your current
scroll position instead of following the thread to its new place in the list.

Pinning does not prevent automatic settlement. Settling a thread removes its pin.

On web and desktop, drag a thread between sections to change its state. Drag a thread up into
the pinned section to pin it at the spot you drop it; drag a pinned thread down into the active
list to unpin it. Dragging a thread onto the **Settled** header settles it, and dragging a settled
thread into the active list un-settles it. A snoozed thread can be dragged out of the snoozed
shelf, which wakes it, but threads cannot be dragged into the shelf because snoozing needs a wake
time. Dragging a pinned thread out of the pinned section does not ask for unpin confirmation.
Pinned and active boundary labels appear only while dragging, without moving the rows. The
other rows slide aside to show where the thread will land. When you cross into another section,
the dragged thread shows the action the drop performs, with its icon: **Pin**, **Unpin**,
**Settle**, **Un-settle**, or **Wake**. Its status and hover actions hide during the drag. A pinned
thread keeps its pin only while it stays in the pinned section; once it leaves, the badge takes
over. Reordering within the same section shows no badge. When there are no pins, drag to the top
edge to pin a thread. Section labels stay readable for the whole drag, and the section the
thread is over takes the accent color. Section labels also
identify empty sections and a collapsed settled shelf.

Drag within the pinned section to change its synced order. On web and desktop, dragging
within the active section preserves this fork's device-local inbox arrangement. New threads
keep their default position above arranged work. On mobile, **Move up** and **Move down**
write server-synced positions; those do not replace a device-local web or desktop arrangement.

On web and desktop, the list also animates section changes made with thread actions such as
**Pin**, **Settle**, and **Snooze**. These transitions respect your system's reduced-motion
preference. While dragging, rows follow the insertion gap without replaying a second transition
after the drop.

Pinning and snoozing preserve active positions. The settled shelf uses settlement time.
Cross-section dragging and synced ordering require server support; update an older server
if those actions are unavailable.

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
Choose **Settle thread** from its menu to move finished work out of the active list
without deleting the conversation. **Un-settle thread** restores it to active work
and prevents automatic settlement until new activity resumes the usual rules.
Manually settling an idle thread dismisses unanswered async questions without
sending an answer or restarting the agent.

By default, environments settle inactive threads after three days and settle
threads whose pull request merged. A closed pull request can also settle an idle
thread. Work in progress, pending questions or approvals, and live background work
prevent automatic settlement. An open pull request does not prevent inactivity
settlement, but an old closed or merged pull request does not settle work you
resumed after it closed.

Change these rules in **Settings → General**. They continue to run when your apps
are closed. On web and desktop, choose an environment at the top to change only
its rules, or **All environments** to update connected environments together.
Mixed values show where the selected environments disagree. Mobile applies these
rules to connected environments that support shared settings. Offline environments
and older servers keep their previous values. Changing a rule does not reopen
already settled threads.

## Link a pull request

The server finds the PR for each unsettled thread's saved branch, even when your
apps are closed. Settled threads keep their saved links. Update the server if
automatic branch links do not appear.

On web and desktop, right-click a pull request link in a thread and choose
**Link to thread** to select a different PR. Use **Unlink from thread** on the
same link to return to the branch PR, if one exists.
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
