# Move work between machines

Sync copies a project and its threads from one connected machine to another, so you can stop on a
laptop and continue on a desktop. Both machines must run a T3 Code version that supports sync.

Open the machine menu at the right end of the thread header. It shows the machine the thread runs
on and lists every other connected machine.

## Continue a thread on another machine

To move the thread in view, choose a machine, then **Continue this thread there**. T3 Code syncs
the project and opens the same thread on that machine. The thread keeps its full history.

The agent session itself cannot move. Your first message on the new machine starts a fresh agent
session. T3 Code gives that session the earlier conversation as
[handoff context](./portable-handoffs.md), and tells the agent which machine it came from and which
files were not copied.

A thread that is still working cannot move. Wait for it to finish or stop it first.

To start clean on the other machine instead, choose **New thread there**. To copy without leaving,
choose **Sync project there**.

## What a sync copies

A sync copies:

- The Git history, the branches, and the tags.
- Uncommitted changes and untracked files, for the project folder and for each synced thread's
  worktree.
- The thread in view and every thread of the project that is not settled or archived, with their
  attachments.

A sync does not copy files that Git ignores, such as installed dependencies, build output, and
`.env` files. Reinstall or copy those on the new machine. A project that is not a Git repository
syncs its threads but not its files.

Pull request watches and scheduled automations stay on the machine where you created them.

## Choose where projects go

The first sync of a project asks for a folder on the other machine. The suggestion comes from
**Settings → Storage → Synced projects folder** for that machine, which defaults to `~/t3-sync`.
Later syncs reuse the project's folder. If the other machine already has a checkout of the same
repository as a project, sync uses that checkout.

## What sync never does

Sync does not rewind or rewrite a branch on the receiving machine. It creates missing branches and
fast-forwards branches that are behind.

- If a branch is ahead on the receiving machine, sync leaves that checkout as it is and tells you.
- If a branch has different commits on each machine, sync leaves the checkout as it is and saves
  the other version as a branch named `t3-sync/<machine>/<branch>`.
- If a thread has new messages on both machines, sync changes neither copy. Continue on one of
  them.

Sync never deletes a thread or a message.

## Undo a sync

Before sync replaces a checkout, it saves that checkout, uncommitted and untracked files included.
To put the saved state back, open the machine menu on the receiving machine and choose **Undo last
sync**. Undo restores checkouts and branches. Threads keep the history they received. T3 Code keeps
the last 10 restore points for each project, and an undo can itself be undone.

To get the newer state from another machine without switching to it, choose **Update this machine
from** that machine.
