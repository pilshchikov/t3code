# Organizing threads

Pin a thread from its context menu to keep it in the pinned section above your active work.
`mod+shift+p` pins or unpins the thread you have open. Pinned threads are shown independently of
their project, including when you connect to more than one environment.

To require confirmation before unpinning, enable **Settings → General → Unpin confirmation**. The
confirmation applies to the sidebar controls, thread menus, and the `mod+shift+p` shortcut.

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

When you un-settle a thread, it returns to the top of the active list so you can find it right
away. Its timestamps do not change. Other threads keep their positions.

Right-click a pull request link in a thread and choose **Link to thread** to show that pull request
in the sidebar. With the finished-pull-request policy selected, that linked request can settle the
thread. Right-click the same link and choose **Unlink from thread** to remove it.

On web and desktop, drag a pinned thread to change its position. On mobile, open the thread's menu
and choose **Move up** or **Move down**. The order is stored by the server and appears on your
other connected devices.

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

## Panel motion

The main sidebar, right panel, and terminal drawer open and close immediately by default. Under
**Settings → Appearance → Motion**, move the **Panel animations** slider above 0 ms to add motion.
The duration can be set up to 400 ms. Clicking the preview replays all three panel transitions; at
0 ms, it snaps between the same open and closed states.

## Environment icons

When you are connected to more than one environment, every thread that lives somewhere other than
the machine you are on wears a small icon for that machine at the end of its row: a server, a cloud
VM, a desktop, a laptop, a Mac mini, or a Mac Studio. In the hosted web app and the mobile app,
where every environment is remote, each row wears its machine so you can tell them apart at a
glance. The same icon appears wherever an environment is named: the thread tooltip, the command
palette, the "Run on" picker, the pull request server filter, the provider settings device tabs,
and the environment lists under **Settings → Connections**. On mobile it appears in the thread
lists, the archive, the new-task environment picker, and the Environments and storage settings.

Servers pick the icon themselves from the hardware they run on. A Mac reports its model, a Linux
machine reports its chassis type and whether it is a virtual machine, and anything without a usable
signal shows a generic server. To override it, open **Settings → Connections** and choose an icon
for that environment; **Automatic** goes back to what the server detected. The choice is stored on
that server, so every device that connects to it sees the same icon.

## Environment artwork

Dev and Nightly environments can identify themselves with artwork at the top of the sidebar and in
the send button. Choose **Artwork**, **Version pill**, or **None** in Settings under environment
identification. Artwork is recolored to match each built-in theme. Custom themes use the **Version
pill** fallback because their colors are not controlled by T3 Code.

To generate a fresh title from the conversation, open a thread's context menu and choose
**Regenerate title**. While T3 Code is generating it, the action reads **Regenerating…** and cannot
be selected again. The option is hidden when the connected environment needs a server update.
