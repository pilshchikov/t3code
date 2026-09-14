# Settings and project overrides

The Settings breadcrumb ends with the environment and project a change applies to. They start
at **All environments** and **All projects** and stay selected as you move between categories or
search for a setting.

Preferences saved on this device, such as appearance, confirmations and browser profiles, always
show and ignore the selection. Everything else is stored on a server. Choose one environment to
edit its settings, or leave **All environments** to edit every connected environment at once.
Offline environments keep their current values; this is a bulk edit, not a synced global default.

Choose a project to override settings for it on the selected environments. A layers icon beside
each server row's title shows where the value comes from: the built-in default, the environment,
or a project override. Click it to see that chain on every selected environment. An override can
be reset to inherit again. Settings that cannot be overridden by a project are shown read-only
while a project is selected.

When the selected environments disagree, the control shows **Mixed** in place of a value and the
layers icon turns amber. Picking a value applies it to every selected environment.

Changing an environment value never touches a project's own override. When projects override the
setting you are editing, the layers icon counts them and the chain lists each one with its value:
click a project to jump to it, or **Reset all** to make those projects follow the environment
again.

Providers and diagnostics are per machine: they show one environment at a time, the primary
one until you pick another. Every other setting fans out to the selection.

## Defaults and inheritance

General contains the model and workspace for new threads. Integrations controls agent browser
access. Source Control contains automatic pull, the default pull request merge method and text
generation. The same rows edit environment defaults or project overrides depending on the
project crumb.

The Project category, shown while a project is selected, holds the project's name, icon, actions,
checkouts and removal. Actions belong to a project: editing them creates the project's own list
on each selected environment, and reset returns to the environment's shared list. A project's
`t3.json` actions can be imported there.

For workspace mode, a project's `t3.json` preference applies when the project has no override.
Browser access changes apply when an agent session next starts.

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

Select the project and open Project to choose an icon, emoji, or image. The choice applies to
every checkout in the project group and appears on connected clients. Choose **Automatic** to let
T3 Code detect an icon again.

# Customize a project color

In Source Control, enable **Automatically pull** to keep the default-branch checkout up to date
with its configured upstream. Choose an environment to set the default or a project to override it.

A project can carry a color that marks its threads in the sidebar.

1. Open **Settings** and select **Projects**.
2. Select the project.
3. Under **Appearance**, select one of the swatches beside **Project colour**, or **Custom** to
   pick any color.

The color washes the project's threads from the right while the sidebar is showing every project,
and tints the project's own row in the sidebar's project menu. Select **Reset** to clear it.

Project colors are kept on the device you set them on.
