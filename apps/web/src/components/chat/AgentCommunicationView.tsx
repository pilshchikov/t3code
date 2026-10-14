import { useId, useState } from "react";
import { ArrowRightIcon, ChevronDownIcon, NetworkIcon, MessagesSquareIcon } from "lucide-react";
import {
  selectCommunicationMessages,
  communicationStatusTone,
  type ThreadCommunication,
  type CommunicationSelection,
  type CommunicationParticipant,
} from "@t3tools/client-runtime/state/thread-communication";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { useMediaQuery } from "../../hooks/useMediaQuery";

const stateLabels = {
  sent: "Sent",
  received: "Received",
  pending: "Sending",
  failed: "Failed",
  recorded: "In agent thread",
};

const statusClasses = {
  working: "text-info",
  monitoring: "text-info/80",
  done: "text-success",
  failed: "text-error",
  input: "text-indigo-600 dark:text-indigo-300",
  attention: "text-warning-foreground",
  neutral: "text-muted-foreground",
};

export function AgentCommunicationView(props: {
  readonly model: ThreadCommunication;
  readonly selection: CommunicationSelection;
  readonly onSelect: (selection: CommunicationSelection) => void;
  readonly loading?: boolean;
  readonly onOpenThread?: (participant: CommunicationParticipant) => void;
  readonly historyActions?: React.ReactNode;
}) {
  const shortPhone = useMediaQuery("(max-width: 767px) and (max-height: 650px)");
  const [mapOverride, setMapOverride] = useState<boolean | null>(null);
  const mapOpen = mapOverride ?? !shortPhone;
  const [visibleCount, setVisibleCount] = useState(30);
  const arrowId = useId();
  const { model, selection } = props;
  const byId = new Map(model.participants.map((p) => [p.id, p]));
  const selectedIds =
    selection.kind === "all"
      ? []
      : selection.kind === "participant"
        ? [selection.id]
        : [selection.from, selection.to];
  const tasks = model.participants.filter((p) => p.id !== model.rootId);
  const messages = selectCommunicationMessages(model, selection);
  const visibleMessages = messages.slice(-visibleCount);
  const counts = new Map<string, number>();
  for (const message of model.messages)
    for (const id of new Set([message.from, message.to])) counts.set(id, (counts.get(id) ?? 0) + 1);
  const pairs = new Map<string, { from: string; to: string; count: number }>();
  for (const message of model.messages) {
    const key = [message.from, message.to].sort().join("\0");
    const pair = pairs.get(key) ?? { from: message.from, to: message.to, count: 0 };
    pair.count++;
    pairs.set(key, pair);
  }
  const heading =
    selection.kind === "all"
      ? "Parent overview"
      : selection.kind === "participant"
        ? (byId.get(selection.id)?.label ?? "Task conversation")
        : `${byId.get(selection.from)?.label ?? "Agent"} ↔ ${byId.get(selection.to)?.label ?? "Agent"}`;
  const choose = (next: CommunicationSelection) => {
    setVisibleCount(30);
    props.onSelect(next);
  };
  const mapParticipants = model.participants.filter(
    (p) => p.id === model.rootId || selectedIds.includes(p.id),
  );
  for (const participant of model.participants)
    if (mapParticipants.length < 7 && !mapParticipants.includes(participant))
      mapParticipants.push(participant);
  const points = new Map(
    mapParticipants.map((participant, index) => [
      participant.id,
      index === 0
        ? { x: 500, y: 34 }
        : { x: 170 + ((index - 1) % 3) * 330, y: 124 + Math.floor((index - 1) / 3) * 90 },
    ]),
  );
  return (
    <div
      className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[13rem_minmax(0,1fr)]"
      data-agent-communication-view
    >
      <nav
        aria-label="Task conversations"
        className="hidden min-h-0 overflow-y-auto border-r p-3 md:block"
      >
        <p className="mb-3 px-2 text-xs font-medium text-muted-foreground">TASK CONVERSATIONS</p>
        <TaskButton
          label="Parent overview"
          count={model.messages.length}
          selected={selection.kind === "all"}
          onClick={() => choose({ kind: "all" })}
        />
        {tasks.map((p) => (
          <TaskButton
            key={p.id}
            label={p.label}
            detail={
              <>
                {p.environmentLabel} ·{" "}
                <span className={statusClasses[communicationStatusTone(p.status)]}>{p.status}</span>
              </>
            }
            count={counts.get(p.id) ?? 0}
            selected={selection.kind === "participant" && selection.id === p.id}
            onClick={() => choose({ kind: "participant", id: p.id })}
          />
        ))}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-col">
        <label className="flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs md:hidden">
          Task
          <select
            aria-label="Task conversation"
            className="min-w-0 flex-1 rounded-md border bg-background p-2 text-sm"
            value={
              selection.kind === "participant"
                ? selection.id
                : selection.kind === "connection"
                  ? "connection"
                  : "all"
            }
            onChange={(event) =>
              choose(
                event.target.value === "all"
                  ? { kind: "all" }
                  : { kind: "participant", id: event.target.value },
              )
            }
          >
            <option value="all">Parent overview</option>
            {selection.kind === "connection" ? (
              <option value="connection" disabled>
                Selected connection
              </option>
            ) : null}
            {tasks.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <section aria-label="Connection map" className="shrink-0 border-b">
          <div className="flex items-center justify-between gap-2 px-4 py-2">
            <span className="flex items-center gap-2 text-xs font-medium">
              <NetworkIcon aria-hidden className="size-4" /> Who’s coordinating
            </span>
            <Button
              size="xs"
              variant="ghost"
              aria-expanded={mapOpen}
              onClick={() => setMapOverride(!mapOpen)}
            >
              {mapOpen ? "Hide map" : "Show map"}
              <ChevronDownIcon />
            </Button>
          </div>
          {mapOpen ? (
            <div className="max-h-[min(35dvh,max(6rem,calc(100dvh-28rem)))] overflow-y-auto px-4 pb-3 md:max-h-none md:overflow-visible">
              <div
                className={cn("relative h-48 md:h-44", mapParticipants.length > 4 && "md:h-64")}
                aria-label="Agents in the map"
              >
                <svg
                  aria-hidden
                  className="absolute inset-0 hidden h-full w-full md:block"
                  viewBox={`0 0 1000 ${mapParticipants.length > 4 ? 256 : 176}`}
                  preserveAspectRatio="none"
                >
                  <defs>
                    <marker
                      id={arrowId}
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" className="fill-primary/50" />
                    </marker>
                  </defs>
                  {[...pairs.values()].map((pair) => {
                    const from = points.get(pair.from),
                      to = points.get(pair.to);
                    return from && to ? (
                      <path
                        key={[pair.from, pair.to].sort().join("\0")}
                        d={`M ${from.x} ${from.y} L ${to.x} ${to.y}`}
                        fill="none"
                        className="stroke-primary/40"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                        markerEnd={`url(#${arrowId})`}
                      />
                    ) : null;
                  })}
                </svg>
                <svg
                  aria-hidden
                  className="absolute inset-0 h-full w-full md:hidden"
                  viewBox="0 0 1000 176"
                  preserveAspectRatio="none"
                >
                  {[...pairs.values()].map((pair) => {
                    const fromIndex = mapParticipants.findIndex((p) => p.id === pair.from),
                      toIndex = mapParticipants.findIndex((p) => p.id === pair.to);
                    if (fromIndex < 0 || fromIndex > 2 || toIndex < 0 || toIndex > 2) return null;
                    const x = (index: number) => (index === 0 ? 500 : index === 1 ? 250 : 750);
                    const y = (index: number) => (index === 0 ? 34 : 124);
                    return (
                      <path
                        key={[pair.from, pair.to].sort().join("\0")}
                        d={`M ${x(fromIndex)} ${y(fromIndex)} L ${x(toIndex)} ${y(toIndex)}`}
                        fill="none"
                        className="stroke-primary/40"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}
                </svg>
                {mapParticipants.map((p, index) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-label={`Read exchanges with ${p.label}`}
                    aria-pressed={selectedIds.includes(p.id)}
                    onClick={() => choose({ kind: "participant", id: p.id })}
                    style={
                      {
                        "--map-desktop-x": `${(points.get(p.id)?.x ?? 500) / 10}%`,
                        "--map-mobile-x": index === 0 ? "50%" : index === 1 ? "25%" : "75%",
                        top: `${(points.get(p.id)?.y ?? 34) - 30}px`,
                      } as React.CSSProperties
                    }
                    className={cn(
                      "absolute left-(--map-mobile-x) w-[44%] max-w-52 -translate-x-1/2 rounded-xl border bg-background p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:left-(--map-desktop-x) md:w-[29%]",
                      index > 2 && "hidden md:block",
                      selectedIds.includes(p.id)
                        ? "border-primary bg-primary/10"
                        : "hover:bg-muted",
                    )}
                  >
                    <span className="block truncate text-sm font-medium">{p.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {p.id === model.rootId ? "Parent · " : ""}
                      {p.environmentLabel}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {p.model ?? "Agent"}
                      <span className="hidden sm:inline"> · </span>
                      <span
                        className={cn(
                          "block sm:inline",
                          statusClasses[communicationStatusTone(p.status)],
                        )}
                      >
                        {p.status}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <div
                className="mt-2 flex max-h-20 flex-wrap justify-center gap-2 overflow-y-auto scrollbar-gutter-both"
                aria-label="Connections between agents"
              >
                {[...pairs.values()]
                  .filter(
                    (pair) =>
                      mapParticipants.some((p) => p.id === pair.from) &&
                      mapParticipants.some((p) => p.id === pair.to),
                  )
                  .map((pair) => (
                    <button
                      key={[pair.from, pair.to].sort().join("\0")}
                      type="button"
                      onClick={() => choose({ kind: "connection", from: pair.from, to: pair.to })}
                      aria-label={`Read connection between ${byId.get(pair.from)?.label} and ${byId.get(pair.to)?.label}`}
                      className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/25 px-2 py-1 text-xs hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <span className="max-w-28 truncate">{byId.get(pair.from)?.label}</span>
                      <ArrowRightIcon aria-hidden className="size-3 shrink-0" />
                      <span className="max-w-28 truncate">{byId.get(pair.to)?.label}</span>
                      <span className="shrink-0 text-muted-foreground">{pair.count}</span>
                    </button>
                  ))}
              </div>
              <p className="mt-2 hidden text-center text-xs text-muted-foreground md:block">
                Select an agent or connection to read its exchanges.
                {model.participants.length > mapParticipants.length
                  ? " More agents are in the task list."
                  : ""}
              </p>
            </div>
          ) : null}
        </section>
        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium">{heading}</h3>
            <p className="text-xs text-muted-foreground">
              {selection.kind === "all"
                ? "Parent instructions and returned results. Select a task for its own messages."
                : "Recorded communication · viewing does not send messages"}
            </p>
          </div>
          {selection.kind !== "all" ? (
            <Button size="xs" variant="ghost" onClick={() => choose({ kind: "all" })}>
              Overview
            </Button>
          ) : null}
        </div>
        <section
          aria-label="Messages between agents"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4"
          key={JSON.stringify(selection)}
        >
          {messages.length > visibleCount ? (
            <div className="py-3">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setVisibleCount((count) => count + 30)}
              >
                Show {Math.min(30, messages.length - visibleCount)} earlier messages
              </Button>
            </div>
          ) : null}
          {visibleMessages.map((message) => (
            <article key={message.id} className="mt-4 rounded-xl border bg-muted/15 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium">
                  {byId.get(message.from)?.label ?? "Agent"}{" "}
                  <span className="text-muted-foreground">→</span>{" "}
                  {byId.get(message.to)?.label ?? "Agent"}
                </span>
                <time dateTime={message.at} className="text-muted-foreground">
                  {new Date(message.at).toLocaleString()}
                </time>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {byId.get(message.from)?.environmentLabel} →{" "}
                {byId.get(message.to)?.environmentLabel} ·{" "}
                <span className={statusClasses[communicationStatusTone(message.state)]}>
                  {stateLabels[message.state]}
                </span>
              </div>
              {message.summary ? (
                <h4 className="mt-2 text-sm font-medium">{message.summary}</h4>
              ) : null}
              <details open={message.text.length <= 6000}>
                <summary
                  className={
                    message.text.length > 6000
                      ? "mt-2 cursor-pointer text-xs text-muted-foreground"
                      : "hidden"
                  }
                >
                  Read full message ({message.text.length.toLocaleString()} characters)
                </summary>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">
                  {message.text}
                </p>
              </details>
            </article>
          ))}
          {messages.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <MessagesSquareIcon aria-hidden className="size-6" />
              <p>
                {props.loading
                  ? "Loading recorded messages…"
                  : "No recorded communication in the loaded history."}
              </p>
              <p className="max-w-sm text-xs">
                Messages appear here when agents send them. Existing task prompts and results are
                included; notes written only to files are not chat messages.
              </p>
            </div>
          ) : null}
        </section>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
          <span>
            {messages.length} recorded exchanges{props.loading ? " · Loading task…" : ""}
          </span>
          <div className="flex flex-wrap gap-2">
            {props.historyActions}
            {selection.kind === "participant" &&
            byId.get(selection.id)?.threadId &&
            props.onOpenThread ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => props.onOpenThread?.(byId.get(selection.id)!)}
              >
                Open thread
              </Button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}

function TaskButton(props: {
  label: string;
  detail?: React.ReactNode;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={props.onClick}
      className={cn(
        "mb-1 block w-full min-w-0 rounded-lg border p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        props.selected ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-muted/50",
      )}
    >
      <span className="block truncate text-sm font-medium">{props.label}</span>
      {props.detail ? (
        <span className="block truncate text-xs text-muted-foreground">{props.detail}</span>
      ) : null}
      <span className="text-xs text-muted-foreground">{props.count} exchanges</span>
    </button>
  );
}
