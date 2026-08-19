# Review usage

The Usage page combines Codex and Claude Code activity from your connected environments. It reads
the providers' local session history and shows API-equivalent token cost, processed tokens, cache
savings, provider shares, and model breakdowns. Subscription billing is separate from the raw token
cost shown here.

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

Use **Past 24h** for an hourly chart covering the exact rolling 24-hour period. The **7 days**,
**30 days**, and **90 days** ranges use daily resolution. Cost and token toggles update both the
headline and chart, and refreshing rescans every connected environment.
