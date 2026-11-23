import {
  CHATGPT_USAGE_URL,
  collectLimitAccounts,
  collectLimitPools,
  displayLimitWindows,
  type LimitAccount,
  type LimitPool,
  type LimitPoolMember,
  type LimitPoolWindow,
  paceRemainingPercent,
  remainingPercent,
  type ResetCreditChoice,
} from "@t3tools/shared/usageLimits";
import { T, useGT, useMessages } from "gt-react";
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import { AlertTriangleIcon, ChevronRightIcon, ExternalLinkIcon, TicketIcon } from "lucide-react";
import { createContext, Fragment, type ReactNode, use, useMemo, useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { usePrimarySettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { providerClients } from "../settings/providerDriverMeta";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import { Button } from "../ui/button";
import { OpenAI } from "../Icons";
import { Alert, AlertTitle } from "../ui/alert";
import {
  Popover,
  PopoverCreateHandle as createSegmentPopoverHandle,
  PopoverPopup,
  PopoverTrigger,
} from "../ui/popover";
import { ResetCreditDialog, barColor, useResetCredit } from "./UsageLimits";
import {
  collectExternalUsageLinks,
  collectLimitNotices,
  cursorUsageWindowDetails,
  formatResetsIn,
  resetCreditChoices,
} from "@t3tools/shared/usageLimitsCopy";

function accountInitials(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local[0] ?? ""}${domain[0] ?? ""}`.toUpperCase() || "?";
}

function accountHue(email: string): number {
  let hash = 0;
  for (let index = 0; index < email.length; index += 1) {
    hash = (hash * 31 + email.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 360;
}

function AccountChip({ email }: { readonly email: string }) {
  const hue = accountHue(email);
  const gt = useGT();
  return (
    <span
      role="img"
      aria-label={gt("Account {initials}", { initials: accountInitials(email) })}
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-3xs leading-none font-semibold"
      style={{ backgroundColor: `oklch(0.85 0.08 ${hue})`, color: `oklch(0.35 0.1 ${hue})` }}
    >
      {accountInitials(email)}
    </span>
  );
}

function AccountAvatar({
  account,
  className,
}: {
  readonly account: LimitAccount;
  readonly className?: string;
}) {
  if (account.redeem) {
    return (
      <ProviderInstanceIcon
        driverKind={account.driver}
        displayName={
          account.displayName ??
          providerClients.get(account.driver)?.label ??
          String(account.driver)
        }
        accentColor={account.accentColor}
        showBadge={Boolean(account.displayName)}
        indicatorBackground="var(--popover)"
        className={cn("size-5", className)}
        iconClassName="size-4 text-foreground/80"
      />
    );
  }
  return account.email ? <AccountChip email={account.email} /> : null;
}

function AccountName({
  account,
  className,
  color = account.accentColor,
}: {
  readonly account: LimitAccount;
  readonly className?: string;
  readonly color?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      {color ? (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      ) : null}
      {account.displayName ? (
        <span className="min-w-0 truncate">{account.displayName}</span>
      ) : account.email ? (
        <AccountChip email={account.email} />
      ) : (
        <span className="min-w-0 truncate">
          {providerClients.get(account.driver)?.label ?? String(account.driver)}
        </span>
      )}
    </span>
  );
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-foreground tabular-nums">{children}</span>
    </div>
  );
}

function SegmentPopover({
  account,
  window,
  reset,
  now,
  redeem,
  onRedeem,
}: {
  readonly account: LimitAccount;
  readonly window: LimitPoolMember["window"];
  readonly reset: LimitPoolWindow["resets"][number] | undefined;
  readonly now: number;
  readonly redeem: ReturnType<typeof useResetCredit> | null;
  readonly onRedeem: (choice: ResetCreditChoice) => void;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const gt = useGT();
  const m = useMessages();
  const remaining = remainingPercent(window);
  const timeLeft = paceRemainingPercent(window, now);
  const resetsIn = formatResetsIn(window, now, m, "in");
  const where =
    account.environments.length > 0
      ? account.environments.map((environment) => environment.label).join(", ")
      : account.sourceLabel;
  const choices =
    redeem && account.redeem && account.limits.resetCredits?.availableCount
      ? resetCreditChoices(account.limits.resetCredits, account.redeem.input, now, true, m)
      : [];
  return (
    <div className="flex w-72 max-w-[calc(100vw-3rem)] flex-col gap-2.5 text-xs">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <AccountAvatar account={account} />
          <span className="truncate">
            {account.displayName ?? providerClients.get(account.driver)?.label ?? account.driver}
          </span>
        </span>
        {account.email ? (
          <RedactedSensitiveText
            value={account.email}
            ariaLabel={gt("Toggle account email visibility")}
            revealTooltip={gt("Click to reveal email")}
            hideTooltip={gt("Click to hide email")}
            className="w-fit"
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-1 border-t border-border/60 pt-2.5">
        {account.plan ? (
          <Row label={gt("Plan", { $context: "subscription plan" })}>{account.plan}</Row>
        ) : null}
        {where ? (
          <Row
            label={
              account.environments.length > 0
                ? gt("Signed in")
                : gt("Via", { $context: "signed in through a source" })
            }
          >
            {where}
          </Row>
        ) : null}
      </div>
      <div className="flex flex-col gap-1 border-t border-border/60 pt-2.5">
        <Row label={gt("Left", { $context: "remaining usage" })}>{remaining}%</Row>
        {window.resetsAt ? (
          <Row label={gt("Resets", { $context: "when the usage window resets" })}>
            {formatUpcomingTimestamp(window.resetsAt, timestampFormat, now, undefined, m)}
            {resetsIn ? ` · ${resetsIn}` : ""}
          </Row>
        ) : null}
        {timeLeft !== null ? (
          <Row label={gt("Even pace")}>{gt("{timeLeft}% left by now", { timeLeft })}</Row>
        ) : null}
        {reset && reset.restoresPercent > 0 ? (
          <Row label={gt("Restores", { $context: "a reset credit restores part of the pool" })}>
            {gt("+{percent}% of pool", { percent: reset.restoresPercent })}
          </Row>
        ) : null}
      </div>
      {choices.length > 0 && redeem ? (
        <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2.5 text-muted-foreground">
          {choices.map((choice) => (
            <span key={choice.key} className="flex items-center gap-3">
              <span className="tabular-nums">{choice.summary}</span>
              {choice.availableCount > 0 ? (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={redeem.busy || !redeem.canManageProviders}
                  className="ms-auto"
                  onClick={() => onRedeem(choice)}
                >
                  {redeem.busy ? gt("Using…") : choice.actionLabel}
                </Button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Every segment on the page shares one popover, so hovering or clicking another
 * segment moves it instead of opening a second one. The payload is the segment
 * it currently describes.
 */
type SegmentPayload = Omit<Parameters<typeof SegmentPopover>[0], "now" | "onRedeem">;
const SegmentPopoverContext = createContext<ReturnType<
  typeof createSegmentPopoverHandle<SegmentPayload>
> | null>(null);

function ActiveSegmentPopover({
  handle,
  payload,
  now,
}: {
  readonly handle: ReturnType<typeof createSegmentPopoverHandle<SegmentPayload>>;
  readonly payload: SegmentPayload;
  readonly now: number;
}) {
  return (
    <PopoverPopup side="top" sideOffset={6}>
      <SegmentPopover
        {...payload}
        now={now}
        onRedeem={(choice) => {
          handle.close();
          payload.redeem?.confirm(choice);
        }}
      />
    </PopoverPopup>
  );
}

function limitTone(remaining: number): string {
  if (remaining === 0) return "text-destructive-foreground";
  return remaining <= 20 ? "text-warning-foreground" : "text-foreground";
}

function ResetCredits({ count }: { readonly count: number }) {
  const gt = useGT();
  if (count <= 0) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-foreground tabular-nums">
      <TicketIcon className="size-3" aria-hidden />
      <span aria-hidden>{count}</span>
      <span className="sr-only">
        {gt(
          "{count, plural, one {{count} reset credit banked} other {{count} reset credits banked}}",
          { count },
        )}
      </span>
    </span>
  );
}

/** The tick marks the even-pace point: a fill short of it is burning faster than the window refills. */
function StripMeter({
  window,
  color,
  now,
}: {
  readonly window: LimitPoolMember["window"];
  readonly color: string;
  readonly now: number;
}) {
  const remaining = remainingPercent(window);
  const timeLeft = paceRemainingPercent(window, now);
  return (
    <span aria-hidden className="relative h-1.5 min-w-0 rounded-full bg-foreground/10">
      <span
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${remaining}%`, backgroundColor: color }}
      />
      {timeLeft !== null ? (
        <span
          className="absolute -inset-y-px w-0.5 -translate-x-1/2 rounded-full bg-foreground/60"
          style={{ left: `${timeLeft}%` }}
        />
      ) : null}
    </span>
  );
}

const STRIP_LINE_GRID =
  "grid w-full grid-cols-[minmax(5.5rem,11rem)_minmax(0,1fr)_2.75rem_minmax(4rem,auto)] items-center gap-3 rounded-md px-2 py-1 text-xs";

function StripLine({
  account,
  window,
  reset,
  redeem,
  label,
  color,
  now,
}: SegmentPayload & {
  readonly label: string;
  readonly color: string;
  readonly now: number;
}) {
  const popover = use(SegmentPopoverContext) ?? undefined;
  const m = useMessages();
  const gt = useGT();
  const remaining = remainingPercent(window);
  const resetsIn = formatResetsIn(window, now, m, "in");
  const timeLeft = paceRemainingPercent(window, now);
  const name =
    account.displayName ?? (account.email ? accountInitials(account.email) : account.driver);
  const ariaLabel = [
    gt("{name}: {remaining}% left", { name, remaining }),
    label,
    resetsIn,
    timeLeft === null ? null : gt("{timeLeft}% of the window left", { timeLeft }),
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <PopoverTrigger
      handle={popover}
      payload={{ account, window, reset, redeem }}
      openOnHover
      render={
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            STRIP_LINE_GRID,
            "cursor-pointer text-start outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-[popup-open]:bg-accent",
          )}
        />
      }
    >
      <span className="truncate text-muted-foreground">{label}</span>
      <StripMeter window={window} color={color} now={now} />
      <span className={cn("text-end font-semibold tabular-nums", limitTone(remaining))}>
        {remaining}%
      </span>
      <span className="truncate text-end text-2xs text-muted-foreground tabular-nums">
        {resetsIn ?? ""}
      </span>
    </PopoverTrigger>
  );
}

interface StripAccountProps {
  readonly pool: LimitPool;
  readonly account: LimitAccount;
  readonly windows: readonly LimitPoolWindow[];
  readonly showName: boolean;
  readonly color: string;
  readonly now: number;
}

/**
 * The confirm is a sibling of the popover, not a child: dialogs stack under
 * popovers, and the popover closes as the confirm opens.
 */
function StripAccount(props: StripAccountProps) {
  return props.account.redeem ? (
    <RedeemableStripAccount redeemAt={props.account.redeem} {...props} />
  ) : (
    <StripAccountLines redeem={null} {...props} />
  );
}

function RedeemableStripAccount({
  redeemAt,
  ...props
}: StripAccountProps & { readonly redeemAt: NonNullable<LimitAccount["redeem"]> }) {
  const redeem = useResetCredit(redeemAt.environmentId);
  const gt = useGT();
  return (
    <>
      <StripAccountLines redeem={redeem} {...props} />
      <ResetCreditDialog
        open={redeem.confirming}
        onOpenChange={redeem.setConfirming}
        choice={redeem.choice}
        onConfirm={() => void redeem.redeem()}
        disabled={!redeem.canManageProviders}
      />
      {/* The popover closed before the confirm, so progress and the outcome need a home outside it. */}
      {redeem.busy || redeem.status ? (
        <span role="status" className="px-2 text-xs text-muted-foreground">
          <AccountName account={props.account} className="font-medium text-foreground" />{" "}
          {redeem.busy ? gt("Using reset credit…") : redeem.status}
        </span>
      ) : null}
    </>
  );
}

function StripAccountLines({
  pool,
  account,
  windows,
  showName,
  color,
  now,
  redeem,
}: StripAccountProps & { readonly redeem: ReturnType<typeof useResetCredit> | null }) {
  const m = useMessages();
  const gt = useGT();
  return (
    <div className="flex flex-col">
      {showName ? (
        <div className="flex items-center gap-2 px-2 pt-1.5 pb-0.5 text-xs">
          <AccountName account={account} color={color} className="font-medium text-foreground" />
          <ResetCredits count={account.limits.resetCredits?.availableCount ?? 0} />
        </div>
      ) : null}
      {windows.map((poolWindow) => {
        const label =
          (pool.driver === "cursor"
            ? cursorUsageWindowDetails(poolWindow.id, pool, m)?.label
            : undefined) ?? poolWindow.label;
        const member = poolWindow.members.find((entry) => entry.account.key === account.key);
        if (member) {
          return (
            <StripLine
              key={`${poolWindow.kind}:${poolWindow.id}`}
              account={account}
              window={member.window}
              reset={poolWindow.resets.find((entry) => entry.member.account.key === account.key)}
              redeem={redeem}
              label={label}
              color={color}
              now={now}
            />
          );
        }
        return poolWindow.kind === "monthly" && account.limits.zeroSpendCap ? (
          <div key={`${poolWindow.kind}:${poolWindow.id}`} className={STRIP_LINE_GRID}>
            <span className="truncate text-muted-foreground">{label}</span>
            <span className="col-span-3 text-muted-foreground">{gt("$0 cap")}</span>
          </div>
        ) : null;
      })}
    </div>
  );
}

function TightestPill({ account, windows, showName, color, now }: Omit<StripAccountProps, "pool">) {
  const m = useMessages();
  const tightest = windows
    .flatMap((poolWindow) => {
      const member = poolWindow.members.find((entry) => entry.account.key === account.key);
      return member ? [{ label: poolWindow.label, window: member.window }] : [];
    })
    .reduce<{ label: string; window: LimitPoolMember["window"] } | null>(
      (lowest, entry) =>
        lowest === null || remainingPercent(entry.window) < remainingPercent(lowest.window)
          ? entry
          : lowest,
      null,
    );
  const credits = account.limits.resetCredits?.availableCount ?? 0;
  if (tightest === null && credits === 0) return null;
  const remaining = tightest ? remainingPercent(tightest.window) : null;
  const resetsIn = tightest ? formatResetsIn(tightest.window, now, m, "in") : null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border py-0.5 ps-0.5 pe-2 text-xs whitespace-nowrap">
      {remaining !== null ? (
        <span
          aria-hidden
          className="relative h-3.5 w-7 shrink-0 overflow-hidden rounded-full bg-foreground/10"
        >
          <span
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${remaining}%`, backgroundColor: color }}
          />
        </span>
      ) : null}
      {showName ? (
        <AccountName account={account} color={color} className="font-medium text-foreground" />
      ) : null}
      {remaining !== null ? (
        <span className={cn("font-semibold tabular-nums", limitTone(remaining))}>{remaining}%</span>
      ) : null}
      {tightest ? (
        <span className="min-w-0 truncate text-2xs text-muted-foreground tabular-nums">
          {[tightest.label, resetsIn].filter(Boolean).join(" · ")}
        </span>
      ) : null}
      <ResetCredits count={credits} />
    </span>
  );
}

function PoolStrip({ pool, now }: { readonly pool: LimitPool; readonly now: number }) {
  const [open, setOpen] = useState(true);
  const providerColor = barColor(pool.driver);
  const label = providerClients.get(pool.driver)?.label ?? String(pool.driver);
  const windows = displayLimitWindows(pool);
  const showNames = pool.accounts.length > 1;
  const accountColor = (account: LimitAccount) =>
    normalizeProviderAccentColor(account.accentColor) ?? providerColor;
  return (
    <section className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md px-2 py-1.5 text-start outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="flex w-36 shrink-0 items-center gap-2 text-sm font-medium text-foreground">
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          <ProviderInstanceIcon
            driverKind={pool.driver}
            displayName={label}
            indicatorBackground="var(--background)"
            className="size-5"
            iconClassName="size-4 text-foreground/80"
          />
          <span className="truncate">{label}</span>
        </span>
        <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {pool.accounts.map((account) => (
            <TightestPill
              key={account.key}
              account={account}
              windows={windows}
              showName={showNames}
              color={accountColor(account)}
              now={now}
            />
          ))}
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-1 ps-6">
          {pool.accounts.map((account) => (
            <StripAccount
              key={account.key}
              pool={pool}
              account={account}
              windows={windows}
              showName={showNames}
              color={accountColor(account)}
              now={now}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function UsageLimitsPooled({
  presentations,
  now,
}: {
  readonly presentations: Parameters<typeof collectLimitAccounts>[0];
  readonly now: number;
}) {
  const gt = useGT();
  const m = useMessages();
  const pools = collectLimitPools(collectLimitAccounts(presentations), now);
  const segmentTriggerKey = JSON.stringify(
    pools.flatMap((pool) =>
      displayLimitWindows(pool).flatMap((window) =>
        window.members.map((member) => [
          member.account.key,
          member.window.kind,
          member.window.id,
          Boolean(member.account.redeem),
        ]),
      ),
    ),
  );
  // Replacing triggers must reset Base UI's active payload without remounting redemption feedback.
  const segmentPopover = useMemo(
    () => ({ key: segmentTriggerKey, handle: createSegmentPopoverHandle<SegmentPayload>() }),
    [segmentTriggerKey],
  );
  const notices = collectLimitNotices(presentations, m);
  const externalLinks = collectExternalUsageLinks(presentations, m);
  return (
    <div className="flex flex-col gap-3">
      {pools.length === 0 && notices.length === 0 && externalLinks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <T>No provider on the selected environments reports subscription limits.</T>
        </p>
      ) : null}
      <SegmentPopoverContext value={segmentPopover.handle}>
        {pools.map((pool) => (
          <Fragment key={pool.driver}>
            <PoolStrip pool={pool} now={now} />
          </Fragment>
        ))}
      </SegmentPopoverContext>
      <Popover key={segmentPopover.key} handle={segmentPopover.handle}>
        {({ payload }) =>
          payload ? (
            <ActiveSegmentPopover handle={segmentPopover.handle} payload={payload} now={now} />
          ) : null
        }
      </Popover>
      {externalLinks.map((link) => (
        <section
          key={link.url}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {link.url === CHATGPT_USAGE_URL ? (
              <OpenAI className="size-5 shrink-0" aria-hidden="true" />
            ) : null}
            <div className="min-w-0 space-y-1">
              <h2 className="text-sm font-medium">{link.label}</h2>
              <p className="text-xs break-words text-muted-foreground">
                {link.accounts.join(", ")}
              </p>
              {link.url === CHATGPT_USAGE_URL ? (
                <p className="text-xs text-muted-foreground">
                  <T>View usage in ChatGPT with your connected account.</T>
                </p>
              ) : link.message ? (
                <p className="max-w-xl text-xs text-muted-foreground">{link.message}</p>
              ) : null}
            </div>
          </div>
          <Button
            variant="ghost-muted"
            size="xs"
            onClick={() => void ensureLocalApi().shell.openExternal(link.url)}
          >
            {gt("Manage usage")}
            <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
          </Button>
        </section>
      ))}
      <LimitNotices notices={notices} />
    </div>
  );
}

function LimitNotices({ notices }: { readonly notices: readonly string[] }) {
  if (notices.length === 0) return null;
  return (
    <Alert variant="warning" controlAlignment="first-line">
      <AlertTriangleIcon />
      {notices.map((notice) => (
        <AlertTitle key={notice} className="break-words">
          {notice}
        </AlertTitle>
      ))}
    </Alert>
  );
}
