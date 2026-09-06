# Usage and limits

## Understand your usage

**Usage** combines Codex, Claude Code, and Grok Build session history from your connected
environments. It shows token use, cache savings, model breakdowns, and estimated API-equivalent
cost. These estimates are not your subscription bill.

## Account limits

The **Limits** section at the top of the Usage page shows the subscription windows reported by each
provider, including the percentage used and the next reset time. Hovering the Usage item in the
sidebar shows the same information in a compact form. The refresh button refreshes both usage
analytics and limit snapshots.

Limit rows are kept separate for each configured provider instance and environment. For example,
two Claude providers configured with different `CLAUDE_CONFIG_DIR` values appear as two labeled
Claude rows; one account cannot overwrite the other account's numbers. The provider display name is
used as the label, so choose names such as `Claude Personal` and `Claude Work` in Settings.

The limits are provider-reported snapshots, not an independent billing calculation:

- Claude reports its 5-hour, weekly, and any additional supported windows while a Claude session is
  running. Claude does not provide a reliable on-disk limit source, so a new installation may show
  **No limit data yet** until that account starts a session through T3 Code.
- Codex uses live app-server notifications and can recover the latest snapshot from Codex session
  transcripts when available. A transcript from a shared/shadow home is not assigned to an account
  unless ownership is unambiguous.
- A timestamp is shown when a snapshot becomes stale. It is better to show the age than to imply
  that an older provider response is current.

Limit meters and account captions take the accent color set on the provider instance in Settings,
so two Claude accounts read apart at a glance. An instance without an accent color falls back to
the provider's own color.

## Model breakdown

The model breakdown lists one row per model per account. Two Claude subscriptions running the same
model are two separate lines of spend, and the account is named on the row whenever its provider
has more than one configured.

If recent work is missing or a new model shows no cost, refresh to rescan session history and
update model pricing.

## Set custom model prices

On web or desktop, open the environment dropdown on **Usage**, then choose **Model prices** to add,
edit, or reset a model's estimated price. **Apply to** starts with your current Usage filter;
choose all environments or select individual destinations. Enter the exact model ID and USD
rates per million input and output tokens. You can enter any model ID, including models
without public pricing.

Cache read and cache write rates are optional and use the input rate when blank. Enter `0` for
tokens that are free. Saved prices replace automatic pricing for all of that environment's
history and are shared with clients connected to it. When environments have different prices,
cells show **Mixed**. Edit rates directly in the table, then choose **Save changes** to apply all
edited rows. Untouched cells keep each environment's rate. Select one environment to inspect its
prices. **Reset to automatic** marks a model's override for removal when you save; you can undo
it before saving.

Each destination reports whether the change saved. Offline or unavailable environments are
marked **Not saved**. Reconnect them and choose **Retry failed saves** to finish the same change
without writing again to environments that already saved. Changes are not queued after you close
the dialog.

## Track subscription limits

**Usage → Limits** shows how much quota is left in each window and when it resets, for Codex and
Claude subscriptions. For windows with timing data, each bar also marks how much of the window is
left, so you can judge your pace before the next reset.

If a window looks stale, refresh Limits to re-check every provider and hub.

Pick `/usage-limits` from the composer's command menu, or send it as a message, to check the
current model's limits without leaving the conversation. The result opens above the composer and
closes when you dismiss it or send your next message. It uses the same snapshot as **Usage → Limits**, so it does not run the agent or refresh
anything. The command is offered only for providers that appear under **Usage → Limits**.

API-key accounts may not report subscription limits. This also applies to Claude connections
using a proxy through `ANTHROPIC_AUTH_TOKEN`.

## Connect a CLIProxyAPI hub

To see pooled accounts, open **Settings → Providers → Usage providers → Add hub**. Choose the
environment that will connect to the hub and enter its URL and management key.

The accounts appear under **Usage → Limits**. This connection supplies usage information; configure
the provider separately to send agent requests through the hub. Remove the hub from the same
settings section when you no longer need it.
