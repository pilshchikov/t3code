# Product usage data

This fork disables external product usage events and network telemetry on the server, desktop,
web, and native mobile clients. It does not collect installation identifiers or send events to
PostHog or remote trace collectors. Environment variables, saved collector settings, and cloud
build tokens cannot enable those paths.

Agent feedback in **Settings > Labs** still lets agents draft reports, and T3 Code saves approved
reports on your machine. `t3 feedback list` shows them. They are never sent.

Local diagnostic files and resource monitoring remain available. Provider requests, Git operations,
and connections you choose still use the network. Hosted upstream services follow their own privacy
policy.

## Agent activity for mobile notifications

When **Publish agent activity** is enabled on a host, it sends project and thread titles, model
names, activity status, and environment and thread identifiers to the T3 Connect relay for
[mobile notifications and live activities](./mobile-notifications.md). This is separate from
product events and relay diagnostics, so the disabled telemetry above does not turn it off.

To stop publishing, turn off **Publish agent activity** under **Settings > Sharing & access** on
the host. Turning off notifications on a phone controls that phone's alerts, not the host's
publishing setting.
