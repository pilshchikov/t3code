# Server updates

## Launcher ownership and compatibility

A [stable launcher](../../apps/server/src/serviceLauncher.ts) owns the runtime selected by systemd,
launchd, or Task Scheduler and is the only runtime writer of durable service state. Server children
request updates over inherited IPC and never rewrite their service definition. Foreground CLI
processes do not self-update.

Remote updates replace only the server child, not the launcher, so every existing background service
lags behind after a launcher-protocol bump. Keep new server runtimes compatible with the previous
launcher protocol unless impossible, and validate protocol compatibility during preflight.

Installations use exact versions and stage/preflight before publishing an immutable runtime so
restarts never depend on npm cache eviction or a moving tag.

## Commit boundary and database rollback

1. Record the pending update durably (atomic rename + fsync) before stopping the old child.
2. Refuse the update if a database snapshot will not fit on disk. After the old child exits, snapshot
   SQLite (main, WAL, SHM) once per update so failed trial migrations are reversible without down
   migrations. Never overwrite that snapshot on retry. Files outside SQLite (such as attachments)
   are outside this rollback boundary.
3. Start the new runtime as a trial. It must finish migrations, acquire fallible dependencies, bind
   HTTP, and hold long-running roots at the activation gate before reporting `prepared`.
4. Only after the launcher commits the new version durably and replies `committed` may the child
   release activation gates and accept work. A failed or timed-out trial stops and restores the
   snapshot before booting the old version.

## Client acknowledgement

An accepted update RPC is only pending. Clients correlate the launcher's update ID with the
reconnected ready state to distinguish commit from rollback. Desktop updates use a two-phase handoff
(prepare token while connected, commit after receiving it) because installing stops the bundled
backend.

## Desktop SSH fork payloads

macOS desktop packages carry a self-contained CLI archive. Its SHA-256 fingerprint is the
`serverBuildId`, because a fork can change without changing its semver. Desktop SSH stages this
immutable payload under `runtime/forks` and never resolves it from the public release feed.
A reconnect must reuse a healthy running server, keeping its runner file intact. Activation is an
explicit update action. Only a matching default-home environment and its recorded managed PID/port
can be replaced. The SSH updater preserves the old runner and a stopped SQLite snapshot, then
restores them if the trial misses readiness. Systemd/launchd services and external servers retain
their existing owners. The desktop verifies the descriptor and the renderer waits for the requested
build after reconnecting. A transport reconnect alone is insufficient evidence of success.

## Recovering interrupted threads

- On startup, retire effects tied to the lost process before admitting new work.
- Persist restart-continuation intent in the durable outbox and wait for activation before running
  it so slow providers never delay readiness or the launcher's commit boundary.
- Cap consecutive crash recoveries per unfinished turn so a crashing turn cannot loop forever.
- Never auto-continue a turn that is archived, settled, snoozed, user-stopped, or waiting on a
  blocking user action (approval, question, or secret).
