# Product analytics

This fork disables external product analytics and network telemetry on every surface.
[`AnalyticsService`](../../apps/server/src/telemetry/AnalyticsService.ts) is an unconditional
no-op: it never resolves installation/account identifiers, buffers events, sends batches or
flushes at shutdown. Collector settings, environment opt-ins and embedded build credentials
cannot enable delivery. Local diagnostic logs and resource monitoring remain available.

Upstream feature, provider and MCP instrumentation may call this service, but those calls do
not collect or transmit events. Keep the no-op boundary when integrating new instrumentation;
changing an endpoint or adding a transport must not bypass it. The headless relay tracing,
web/mobile tracing and desktop observability paths independently disable network exporters.
See the [user policy](../user/telemetry.md).
