import { BookmarkIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";

/**
 * Compact chip that shows the stash count beside the composer controls
 * and opens the stash menu.
 *
 * On save the badge gives one quiet acknowledgement: it lifts to full
 * opacity and the count ticks over. `pulseKey` changes per stash, remounting
 * the count so the transition replays without a continuous animation.
 */
export const ComposerStashBadge = memo(function ComposerStashBadge(props: {
  count: number;
  menuOpen: boolean;
  pulseKey: number;
  pulsing: boolean;
  onToggleMenu: () => void;
}) {
  if (props.count === 0) return null;
  const count = (
    <span
      key={props.pulseKey}
      className={cn(
        props.pulsing
          ? "animate-[prompt-stash-count-enter_180ms_ease-out_both] text-primary motion-reduce:animate-none"
          : "text-muted-foreground",
      )}
    >
      {props.count}
    </span>
  );

  return (
    <button
      type="button"
      data-chat-composer-collapsed-controls="true"
      data-prompt-stash-badge="true"
      aria-label={`Stashed prompts: ${props.count}. Open stash.`}
      aria-expanded={props.menuOpen}
      className={cn(
        "relative z-20 flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-full border border-border bg-popover px-2.5 text-xs shadow-sm transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-ring",
        props.menuOpen || props.pulsing
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
      onPointerDown={(event) => event.preventDefault()}
      onClick={props.onToggleMenu}
    >
      <BookmarkIcon className="size-3" />
      <span>Stash</span>
      {count}
    </button>
  );
});
