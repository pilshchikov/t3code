# Product analytics

This fork disables external product analytics and network telemetry on every surface.
[`AnalyticsService`](../../apps/server/src/telemetry/AnalyticsService.ts) is an unconditional
no-op: it never resolves installation/account identifiers, buffers events, sends batches or
flushes at shutdown. Collector settings, environment opt-ins and embedded build credentials
cannot enable delivery. Local diagnostic logs and resource monitoring remain available.

Upstream feature, provider and MCP instrumentation may call this service, but those calls do
not collect or transmit events. Opt-in `agent.feedback` reports from
[`FeedbackService`](../../apps/server/src/feedback/FeedbackService.ts) also go through
`AnalyticsService.record`, so they are not transmitted either. Keep the no-op boundary when
integrating new instrumentation. Changing an endpoint or adding a transport must not bypass it.
The headless relay tracing, web/mobile tracing and desktop observability paths independently
disable network exporters. See the [user policy](../user/telemetry.md).

The rules below still bind new instrumentation, so upstream merges stay safe if a call site
ever reaches a transport.

## Identity

- **Identity never comes from a provider.** Do not read a provider's sign-in files or derive an id
  or owner from a user's OpenAI, Claude, or other provider account, even hashed: users did not sign
  in to those to be identified by T3 Code.
- **Resolve owners at query time.** `install.owner_observed` links installs to owners (Connect
  account, client device). Two Connect accounts are never merged as one person.
- **Hash everywhere with [one helper](../../packages/shared/src/telemetryId.ts).** Clients and
  servers hash with the same SHA-256 helper so IDs correlate; the server accepts only hashes from
  clients.

## Attribution boundaries

- Client dimensions (`surface`, etc.) belong to the event's WebSocket connection, never a
  server-global "current client". Keep client and server dimensions separate, and leave missing
  client metadata unknown rather than backfilling from server properties.
- Active-use reports count `client.turn.requested` (deduplicated by command ID), not connections
  (T3 Connect sessions renew hourly).

## Collection boundary

- Payloads stay strictly to product metadata, closed contract enums, and normalized measurements:
  never attach prompts, file paths, credentials, raw provider payloads, device names, conversation
  IDs, or user-named provider instance IDs. Models in the bundled manifest or a vendor's own
  model list report their catalog slug, with aliases and routed IDs mapped to it. Any other model
  ID can name a user, a deployment, or a local file, so it reports only `custom:<driver>`.
- The sole exception is opt-in `agent.feedback`, which
  [`FeedbackService`](../../apps/server/src/feedback/FeedbackService.ts) scrubs of paths, private
  values, and secret-shaped strings, and only attaches bounded conversation traces when the user
  explicitly previews and sends them. Each report is sent under its own id without `installId` or
  host properties, in a request of its own, so it links to no install or other report; reports sent
  without a preview carry only their categories.
