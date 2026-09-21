import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { InfoIcon, XIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ComposerBanner } from "./ComposerBanner";

const DISMISS_TRANSITION_MS = 220;
const frontExitStyle = {
  opacity: 0,
  transform: "translate3d(0, 4rem, 0)",
} satisfies CSSProperties;
const stackedExitStyle = {
  opacity: 0,
  transform: "translate3d(0, 7rem, 0)",
} satisfies CSSProperties;
const restingStyle = {
  opacity: 1,
  transform: "none",
} satisfies CSSProperties;
const exitTransitionStyle = {
  transition: `transform ${DISMISS_TRANSITION_MS}ms ease-in, opacity ${DISMISS_TRANSITION_MS}ms ease-in`,
} satisfies CSSProperties;

// The collapsed cap peeking above the front banner is the only hint that more
// banners are stacked behind it, so its border must match the severity of the
// first hidden banner — a neutral banner must not masquerade as a warning.
const stackCapBorderClass: Record<ComposerBannerStackItem["variant"], string> = {
  default: "border-[var(--chat-composer-attached-outline)]",
  error: "border-destructive/24",
  info: "border-info/24",
  success: "border-success/24",
  warning: "border-warning/24",
};

export interface ComposerBannerStackItem {
  readonly priority?: "activity" | "notice" | "urgent";
  readonly children?: ReactNode;
  readonly id: string;
  readonly variant: "default" | "error" | "info" | "success" | "warning";
  // Ordering hint for stack assemblers: front this banner even though its
  // variant is calm (e.g. live update progress). The stack itself ignores it.
  readonly urgent?: boolean;
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly compact?: boolean;
  readonly actions?: ReactNode;
  readonly className?: string;
  readonly actionClassName?: string;
  readonly dismissLabel?: string;
  readonly onDismiss?: () => void;
}

interface ComposerBannerStackProps {
  readonly className?: string;
  readonly items: ReadonlyArray<ComposerBannerStackItem>;
}

export function ComposerBannerStack({ className, items }: ComposerBannerStackProps) {
  const [requestedExitingItemId, setExitingItemId] = useState<string | null>(null);
  const dismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitingItemId =
    requestedExitingItemId !== null && items.some((item) => item.id === requestedExitingItemId)
      ? requestedExitingItemId
      : null;

  useEffect(() => {
    return () => {
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current);
      }
    };
  }, []);

  if (items.length === 0) {
    return null;
  }

  const frontItem = items[0];
  if (!frontItem) {
    return null;
  }
  const stackedItems = items.slice(1);
  const hasStack = stackedItems.length > 0;
  const showCollapsedStackCap = hasStack && exitingItemId !== frontItem.id;
  const firstStackedItem = stackedItems[0];

  const requestDismiss = (item: ComposerBannerStackItem) => {
    if (!item.onDismiss || exitingItemId) {
      return;
    }
    setExitingItemId(item.id);
    if (dismissTimeoutRef.current) {
      clearTimeout(dismissTimeoutRef.current);
    }
    dismissTimeoutRef.current = setTimeout(() => {
      dismissTimeoutRef.current = null;
      item.onDismiss?.();
    }, DISMISS_TRANSITION_MS);
  };

  return (
    <div
      className={cn("group/banner-stack chat-composer-drawer-slot", className)}
      data-composer-banner-drawer="true"
    >
      <div
        className={cn(
          "relative flex flex-col-reverse",
          hasStack ? "group-hover/banner-stack:z-50 group-focus-within/banner-stack:z-50" : null,
        )}
      >
        {showCollapsedStackCap && firstStackedItem ? (
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 -top-3 z-0 mx-auto h-3 rounded-t-2xl",
              "chat-composer-banner-stack-cap border border-b-0 shadow-[0_6px_18px_rgba(0,0,0,0.06)]",
              stackCapBorderClass[firstStackedItem.variant],
              "transition-opacity duration-150 ease-out",
              "group-hover/banner-stack:opacity-0 group-focus-within/banner-stack:opacity-0",
            )}
            style={{ width: "96%" }}
            aria-hidden="true"
          />
        ) : null}
        <div
          key={frontItem.id}
          className={cn(
            "relative z-10",
            exitingItemId === frontItem.id ? "pointer-events-none" : null,
          )}
          style={{
            ...exitTransitionStyle,
            ...(exitingItemId === frontItem.id ? frontExitStyle : restingStyle),
          }}
        >
          <ComposerBannerStackAlert
            item={frontItem}
            attached
            exiting={exitingItemId === frontItem.id}
            onDismissRequest={() => requestDismiss(frontItem)}
          />
        </div>
        {hasStack ? (
          <div
            data-composer-banner-stack-expanded-items="true"
            className={cn(
              "relative z-20 grid grid-rows-[0fr] transition-[grid-template-rows] duration-150 ease-out",
              "group-hover/banner-stack:grid-rows-[1fr] group-focus-within/banner-stack:grid-rows-[1fr]",
            )}
          >
            <div className="min-h-0 overflow-hidden">
              <div
                className={cn(
                  "invisible pointer-events-none space-y-2 pb-2 opacity-0",
                  "translate-y-1 transform-gpu transition-[opacity,transform] duration-150 ease-out will-change-[opacity,transform]",
                  "group-hover/banner-stack:visible group-hover/banner-stack:pointer-events-auto group-hover/banner-stack:translate-y-0 group-hover/banner-stack:opacity-100",
                  "group-focus-within/banner-stack:visible group-focus-within/banner-stack:pointer-events-auto group-focus-within/banner-stack:translate-y-0 group-focus-within/banner-stack:opacity-100",
                )}
              >
                {stackedItems.map((item) => (
                  <div
                    key={item.id}
                    className={cn(exitingItemId === item.id ? "pointer-events-none" : null)}
                    style={{
                      ...exitTransitionStyle,
                      ...(exitingItemId === item.id ? stackedExitStyle : restingStyle),
                    }}
                  >
                    <ComposerBannerStackAlert
                      item={item}
                      attached={false}
                      exiting={exitingItemId === item.id}
                      onDismissRequest={() => requestDismiss(item)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Keep full descriptions reachable only when their inline copy is clipped. */
function NoticeDescription({
  children,
  compact,
}: {
  children: ReactNode;
  compact?: boolean | undefined;
}) {
  const descriptionRef = useRef<HTMLSpanElement>(null);
  const detailsRef = useRef<HTMLButtonElement>(null);
  const [showDetails, setShowDetails] = useState(false);

  useLayoutEffect(() => {
    const description = descriptionRef.current;
    if (!description) return;
    const measure = () => {
      // Ignore the space taken by the details button itself so it cannot
      // sustain its own overflow after the description would otherwise fit.
      const recoveredWidth = detailsRef.current ? detailsRef.current.offsetWidth + 4 : 0;
      const hidden = getComputedStyle(description).position === "absolute";
      setShowDetails(
        hidden ||
          [description, ...description.querySelectorAll("*")].some(
            (element) => element.scrollWidth > element.clientWidth + recoveredWidth,
          ),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(description);
    // A child can reveal new text without resizing its clipped box.
    const mutations = new MutationObserver(measure);
    mutations.observe(description, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, []);

  return (
    <span className={compact ? "contents" : "flex min-w-8 flex-1 items-center gap-1"}>
      <span
        ref={descriptionRef}
        className={cn(
          "min-w-0 truncate text-muted-foreground",
          compact && "shrink-[9999] @max-[400px]:sr-only",
        )}
      >
        {children}
      </span>
      {showDetails ? (
        <Popover>
          <PopoverTrigger
            openOnHover
            render={
              <Button
                ref={detailsRef}
                size="icon-xs"
                variant="ghost-muted"
                aria-label="Show notice details"
                className="flex-none"
              />
            }
          >
            <InfoIcon />
          </PopoverTrigger>
          <PopoverPopup
            aria-label="Notice details"
            tooltipStyle
            side="top"
            className="max-w-80 whitespace-normal text-pretty wrap-anywhere"
          >
            <ComposerBanner.Scroll className="max-h-[min(var(--available-height),24rem,40dvh)]">
              {children}
            </ComposerBanner.Scroll>
          </PopoverPopup>
        </Popover>
      ) : null}
    </span>
  );
}

function ComposerBannerStackAlert({
  item,
  attached,
  exiting,
  onDismissRequest,
}: {
  readonly item: ComposerBannerStackItem;
  readonly attached: boolean;
  readonly exiting: boolean;
  readonly onDismissRequest: () => void;
}) {
  const dismissOnly = item.onDismiss && !item.actions;

  return (
    <Alert
      variant={item.variant}
      className={cn(
        attached
          ? "chat-composer-drawer-surface chat-composer-drawer-attached px-3 pt-2 pb-[calc(var(--chat-composer-attachment-overlap)_+_0.375rem)] text-xs sm:px-4"
          : "alert-glass rounded-[22px]",
        "chat-composer-banner-alert",
        item.compact && "chat-composer-banner-compact",
        item.className,
      )}
      data-variant={item.variant}
    >
      {item.icon}
      <AlertTitle>{item.title}</AlertTitle>
      {item.description ? (
        <AlertDescription>
          <NoticeDescription compact={item.compact}>{item.description}</NoticeDescription>
        </AlertDescription>
      ) : null}
      {item.children ? <div className="col-span-full min-w-0">{item.children}</div> : null}
      {item.actions || item.onDismiss ? (
        <AlertAction
          className={cn(
            item.actionClassName,
            dismissOnly
              ? "max-sm:col-start-3 max-sm:row-start-1 max-sm:mt-0 max-sm:self-start"
              : undefined,
          )}
        >
          {item.actions}
          {item.onDismiss ? (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={item.dismissLabel ?? "Dismiss warning"}
              disabled={exiting}
              onClick={onDismissRequest}
            >
              <XIcon className="size-3.5" />
            </Button>
          ) : null}
        </AlertAction>
      ) : null}
    </Alert>
  );
}
