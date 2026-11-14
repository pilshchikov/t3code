import { GitBranchIcon } from "lucide-react";
import { cn } from "../../lib/utils";

const hues = [
  "bg-(--context-chip-image)/15 text-(--context-chip-image) ring-(--context-chip-image)/30",
  "bg-(--context-chip-review-comment)/15 text-(--context-chip-review-comment) ring-(--context-chip-review-comment)/30",
  "bg-(--context-chip-terminal)/15 text-(--context-chip-terminal) ring-(--context-chip-terminal)/30",
  "bg-(--context-chip-element)/15 text-(--context-chip-element) ring-(--context-chip-element)/30",
  "bg-(--context-chip-pr-closed)/15 text-(--context-chip-pr-closed) ring-(--context-chip-pr-closed)/30",
  "bg-(--context-chip-thread)/15 text-(--context-chip-thread) ring-(--context-chip-thread)/30",
  "bg-(--context-chip-skill)/15 text-(--context-chip-skill) ring-(--context-chip-skill)/30",
  "bg-(--context-chip-video)/15 text-(--context-chip-video) ring-(--context-chip-video)/30",
  "bg-(--context-chip-model)/15 text-(--context-chip-model) ring-(--context-chip-model)/30",
];

function agentHue(id: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index++)
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x01000193);
  hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d);
  return hues[((hash ^ (hash >>> 13)) >>> 0) % hues.length]!;
}

/** Hue follows the agent id, so an agent keeps its color across selections and reloads. */
export function AgentCommunicationAvatar(props: {
  readonly id: string;
  readonly label: string;
  readonly coordinator?: boolean;
  readonly size?: "xs" | "sm" | "md";
}) {
  const size = props.size ?? "sm";
  return (
    <span
      aria-hidden
      data-agent-avatar=""
      className={cn(
        !props.coordinator && agentHue(props.id),
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none",
        "ring-1 ring-inset",
        props.coordinator &&
          "bg-primary/12 text-primary ring-primary/30 dark:bg-primary/20 dark:text-primary",
        size === "xs" && "size-4 text-4xs",
        size === "sm" && "size-6 text-2xs",
        size === "md" && "size-8 text-xs",
      )}
    >
      {props.coordinator ? (
        <GitBranchIcon
          className={size === "md" ? "size-4" : size === "xs" ? "size-2.5" : "size-3"}
        />
      ) : (
        props.label.trim().charAt(0).toLocaleUpperCase() || "?"
      )}
    </span>
  );
}
