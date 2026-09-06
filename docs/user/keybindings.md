# Keybindings

Customize shortcuts in **Settings → Keybindings** on web and desktop. That page
also lists the command IDs and defaults available in your version.

## Edit the configuration file

Keybindings live on the environment's machine, in
`~/.t3/userdata/keybindings.json` by default. You can edit this file directly.
It is a JSON array of rules:

```json
[
  { "key": "mod+g", "command": "terminal.toggle" },
  { "key": "mod+shift+g", "command": "terminal.new", "when": "terminalFocus" }
]
```

T3 Code creates the file with its defaults and adds new defaults on later startups.
New defaults do not replace commands you customized. If a new default overlaps one
of your shortcuts, [rule order](#precedence) decides which runs.
Invalid rules are ignored; if the file cannot be parsed, T3 Code uses defaults.

## Rule shape

Each rule requires a `key` shortcut and a `command` ID. An optional `when`
expression restricts when it runs.

Project scripts use `script.{id}.run`, such as `script.test.run`.

## Key syntax

Join modifiers and a key with `+`, such as `mod+shift+d` or `ctrl+l`.
`mod` means Command on macOS and Control elsewhere. Other modifiers are
`cmd` / `meta`, `ctrl` / `control`, `alt` / `option`, and `shift`.

## When conditions

Available context keys are `terminalFocus`, `terminalOpen`, `previewFocus`,
`previewOpen`, and `modelPickerOpen`. Unknown keys evaluate to `false`.

Combine keys with `!` for not, `&&` for and, `||` for or, and parentheses:

`rightPanel.toggle` shows or hides the right panel, and `rightPanel.toggleMaximized` maximizes or
restores it, defaulting to `mod+alt+m`. Pressing the latter while the panel is closed opens and
maximizes it in one step. Both answer wherever you are in the app and whatever has focus, which
makes them safe to bind to a bare key such as `§`; the exception is Settings, where a keypress
belongs to the page you are editing the binding on. Hiding the panel gives up its maximized state,
so it never reopens filling the workspace.

`project.jump.1` through `project.jump.9` scope the sidebar to a project, defaulting to `mod+1`
through `mod+9`. To fill a slot, open the project menu at the top of the sidebar, point at a
project, and press `ctrl+1` through `ctrl+9` (`project.assign.1` and up). The slot's shortcut then
shows on that project's row, and a project answers to one slot at a time. Which project a number
recalls is stored on the device you set it on.

`structure.open` opens the file structure view and defaults to `mod+shift+1`. `thread.jump.1`
through `thread.jump.9` still exist and can be bound, but no longer claim `mod+1` through `mod+9`
by default. A keybindings file written before project slots existed is carried over on startup:
numbered thread jumps become the matching project slots, and a `mod+1` file-structure rule moves to
`mod+shift+1`.

`editor.navigateBack` and `editor.navigateForward` step through the files you have opened in the
editor, returning to the exact line you left. Each defaults to two shortcuts, `ctrl+left` and
`mod+[` for back, `ctrl+right` and `mod+]` for forward, because macOS reserves the `ctrl` pair for
switching desktops.

`rightPanel.close` closes the active right panel tab and defaults to `mod+w`. Press it again to close
the next tab. With the terminal focused, `mod+w` closes the terminal instead, and with nothing left
to close it closes the desktop window as before. Browsers reserve `mod+w` for closing their own tab
and never pass it to the page, so in a browser rebind this command (and `terminal.close`) to a
shortcut the browser leaves alone, such as `alt+w`.

`thread.copyReference` copies the active thread's pull request link, or its thread ID when no pull
request is available. Its default shortcut is `mod+shift+c`, and it does not replace terminal copy
while the terminal has focus.

`thread.settle` settles the active thread or restores it when it is already settled. Its default
shortcut is `mod+shift+s`, and it does not run while the terminal has focus.

`thread.pin` pins the active thread to the pinned section of the sidebar, or unpins it when it is
already pinned. Its default shortcut is `mod+shift+p`, and it does not run while the terminal has
focus. See [Organizing threads](./thread-sidebar.md) for how pinned threads are ordered.

The command palette searches settings, active thread titles, projects, branches, user messages, and
final agent responses across connected environments. A setting result opens its exact control or
section. Message matches show one labeled excerpt while keeping the thread's project, branch, and
machine context visible. Message search begins after two characters and uses SQLite's ASCII
case-insensitive matching.

The full command list and the current defaults are shown in **Settings** → **Keybindings**, which
always matches the build you are running. Use that rather than a copied list.

Note that `chat.new` and `chat.newLocal` both create a thread through the same path. A new thread
inherits the project you were in, along with model and mode selections. Branch, worktree, and
environment mode always come from your configured defaults, not from the thread you were looking
at. To keep a worktree, use the explicit "new thread in this worktree" action in the branch
toolbar. The only difference between the two commands: with the current sidebar and more than one
project, `chat.new` opens a project chooser first.

Background submission from a new thread is the exception. `mod+enter` starts that thread and opens
another new thread with the same workspace mode and base branch. **New worktree** remains selected,
but the new thread does not reuse the worktree created for the thread that just started.

## `when` Conditions

A `when` expression is evaluated against context keys describing the current UI state. The keys
the app supplies today are `terminalFocus`, `terminalOpen`, `previewFocus`, `previewOpen`, and
`modelPickerOpen`. The set is open and grows over time, so treat that as the current list rather
than a fixed one. Any key the running app does not supply evaluates to `false`.

Operators: `!` (not), `&&` (and), `||` (or), and parentheses.

Examples:

- `"when": "terminalFocus"`
- `"when": "terminalOpen && !terminalFocus"`
- `"when": "!terminalFocus"`

## Precedence

The last rule whose key and condition both match wins, even if it belongs to a
different command. Put a more specific rule after a general one when they share
a shortcut.

## Commands with special behavior

`chat.new` may ask you to choose a project when there is more than one.
`chat.newLocal` skips that chooser. Both use your
[new-thread defaults](./thread-sidebar.md#start-a-thread).

## Reserved shortcuts

In the desktop app, `mod+w` closes the focused terminal or the active right-panel
tab. When nothing remains to close, it closes the window. In a browser, `mod+w`
closes the browser tab; rebind `rightPanel.close` and `terminal.close` to an available
shortcut such as `alt+w`.

Many defaults include `!terminalFocus` so they do not intercept terminal input.
Keep that condition when remapping them if you want the same behavior.

## Desktop quit shortcut

Use `Cmd+Q` on macOS or `Ctrl+Q` on Windows and Linux. In the default **Hold** mode,
hold for 1.2 seconds or press twice within 500 milliseconds. Holding requires
keyboard repeat; if repeat is disabled, use two presses or the application menu.

Change **Settings → General → Confirmations → Quit shortcut** to **Direct** for a
single press or **Double press** for two presses only. Choosing **Quit** from the
application menu always quits immediately.
