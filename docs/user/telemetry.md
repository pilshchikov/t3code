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
