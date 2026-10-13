# Start a thread on another machine

Sync copies a project's repository from one connected machine to another, so a new thread can run
there against the same files. Both machines must run a T3 Code version that supports sync.

## Pick the machine for a new thread

In a new thread, open the **Run on** picker under the composer and choose a machine. T3 Code syncs
the project to that machine first, then points the thread at it. You can send as soon as the picker
stops showing that it is preparing the machine.

The picker lists every connected machine that supports sync, including machines that do not have
the project yet. Each time you choose a machine, its copy is brought to the current state of the
machine you are leaving.

The first turn after a sync tells the agent which machine the files came from and that files Git
ignores were not copied.

## What a sync copies

A sync copies:

- The Git history, the branches, and the tags.
- The project folder as it stands, with uncommitted changes and untracked files.
- Every worktree of the repository, in the same state.

A sync does not copy files that Git ignores, such as installed dependencies, build output, and
`.env` files. Reinstall or copy those on the other machine. A project that is not the root of a Git
repository cannot be synced.

Threads are not copied. A thread stays on the machine where it ran.

## Choose where projects go

The first sync of a project creates it under **Settings → Storage → Synced projects folder** on the
receiving machine, which defaults to `~/t3-sync`. Later syncs reuse that folder. If the receiving
machine already has a checkout of the same repository as a project, sync uses that checkout.

To pick a different folder for one project, run its first sync from the machine menu in the thread
header. That menu asks for the folder.

Worktrees are created under the receiving machine's worktree location.

## Sync without starting a thread

The machine menu at the right end of the thread header lists the other connected machines. For each
one it can send this machine's files there, get that machine's files here, or sync and open a new
thread there.

## What sync never does

Sync does not rewind or rewrite a branch on the receiving machine. It creates missing branches and
fast-forwards branches that are behind.

- If a branch is ahead on the receiving machine, sync leaves that checkout as it is and tells you.
- If a branch has different commits on each machine, sync leaves the checkout as it is and saves
  the other version as a branch named `t3-sync/<machine>/<branch>`.
- If a turn is running in a checkout on the receiving machine, sync leaves that checkout as it is.

## Undo a sync

Before sync replaces a checkout, it saves that checkout, uncommitted and untracked files included.
To put the saved state back, open the machine menu on the receiving machine and choose **Undo last
sync**. T3 Code keeps the last 10 restore points for each project, and an undo can itself be
undone.
