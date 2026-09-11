# Project settings

Open **Settings → Projects**. The project and machine pickers start at **All projects** and
**All machines**.

Change the default model, workspace, automatic pull, agent browser access, or actions for projects that inherit those values.
Select an individual project to override a default. Reset its row to inherit again. Changing a
default preserves explicit project overrides. Workspace preferences in `t3.json` take precedence
over machine defaults when the project has no explicit workspace override.

Select a machine to limit edits to it. **All machines** writes defaults to connected machines;
offline machines keep their previous values. Mixed values are indicated when selected machines
or checkouts disagree. Browser access changes apply when an agent session next starts.

Project grouping has a client-wide default across machines, with individual checkout overrides.
Shared actions apply to inheriting projects; editing a project's actions creates an independent list.
Reset that list to use shared actions again. Existing project actions are preserved.

Project names, icons, removal, and importing actions from a checkout remain project-specific.
When there are several checkouts, the checkout picker selects which actions, grouping, and project
memories to edit.

## Project memory

Select a project in Settings → Projects and open Project memory. Add an entry with a short name,
a description of when to use it, and its content. Edit reads the full entry; Delete asks for
confirmation. You can also ask an agent to remember a fact for the project.

New threads receive a short memory index on their first message. Agents read relevant entries
through T3 Code's MCP tools rather than loading every memory into every prompt. Updates are
available through those tools immediately, but the initial index is not repeated in an existing
conversation. Memories may become stale, so verify details before using them for consequential work.

Memories stay in the hosting T3 Code database and are shared by the project's threads, including
threads using worktrees or multiwork copies. A separately registered project or another environment
has its own memories. Do not store passwords, API keys, or other secrets.

## Project icons

Choose an icon, emoji, or image from the project to make it easier to recognize. The choice applies
to selected checkouts in the project group and appears on connected clients. Choose **Automatic** to
let T3 Code detect an icon again.

# Customize a project color

A project can carry a color that marks its threads in the sidebar.

1. Open **Settings** and select **Projects**.
2. Select the project.
3. Under **Appearance**, select one of the swatches beside **Project colour**, or **Custom** to
   pick any color.

The color washes the project's threads from the right while the sidebar is showing every project,
and tints the project's own row in the sidebar's project menu. Select **Reset** to clear it.

Project colors are kept on the device you set them on.
