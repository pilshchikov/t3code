# Organizing threads

Pin a thread from its context menu to keep it in the pinned section above your active work.
`mod+shift+p` pins or unpins the thread you have open. Pinned threads are shown independently of
their project, including when you connect to more than one environment.

To require confirmation before unpinning, enable **Settings → General → Unpin confirmation**. The
confirmation applies to the sidebar controls, thread menus, and the `mod+shift+p` shortcut.

Pinned threads still move to **Settled** when they become inactive. They also move when their pull
request merges if **Auto-settle merged threads** is enabled.

When you un-settle a thread, it returns to the top of the active list so you can find it right
away. Its timestamps do not change. Other threads keep their positions.

Right-click a pull request link in a thread and choose **Link to thread** to show that pull request
in the sidebar. The thread settles when the linked pull request merges if **Auto-settle merged
threads** is enabled. Right-click the same link and choose **Unlink from thread** to remove it.

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

A thread whose pull request merges or closes stays where it is. To have T3 Code file those threads
away for you, turn on **Auto-settle finished threads** in Settings. Threads still settle on their
own after a period of inactivity, which is configured separately.

If reordering is unavailable for one environment, update the T3 Code server running in that
environment. Older servers can still pin and unpin threads, but do not understand synced ordering;
their pinned threads keep the default newest-first order below the ones you have arranged.

## Environment artwork

Dev and Nightly environments can identify themselves with artwork at the top of the sidebar and in
the send button. Choose **Artwork**, **Version pill**, or **None** in Settings under environment
identification. Artwork is recolored to match each built-in theme. Custom themes use the **Version
pill** fallback because their colors are not controlled by T3 Code.

To generate a fresh title from the conversation, open a thread's context menu and choose
**Regenerate title**. While T3 Code is generating it, the action reads **Regenerating…** and cannot
be selected again. The option is hidden when the connected environment needs a server update.
