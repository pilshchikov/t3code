import { useMemo, useState } from "react";
import { ChevronDownIcon, NetworkIcon, MessagesSquareIcon } from "lucide-react";
import {
  selectCommunicationMessages,
  recentCommunicationParticipants,
  communicationParticipantActivity,
  communicationStatusTone,
  type ThreadCommunication,
  type CommunicationSelection,
  type CommunicationParticipant,
} from "@t3tools/client-runtime/state/thread-communication";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { useMediaQuery } from "../../hooks/useMediaQuery";

import { communicationStatusClasses as statusClasses } from "./agentCommunicationStyles";
import { AgentCommunicationMap } from "./AgentCommunicationMap";

const stateLabels = {
  sent: "Sent",
  received: "Received",
  pending: "Sending",
  failed: "Failed",
  recorded: "In agent thread",
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
  const { model, selection } = props;
  const byId = new Map(model.participants.map((p) => [p.id, p]));
  const [query, setQuery] = useState("");
  const [taskLimit, setTaskLimit] = useState(50);
  const activity = useMemo(() => communicationParticipantActivity(model), [model]);
  const tasks = useMemo(
    () => recentCommunicationParticipants(model).filter((p) => p.id !== model.rootId),
    [model],
  );
  const filteredTasks = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term
      ? tasks.filter((p) =>
          `${p.label} ${p.environmentLabel} ${p.model ?? ""}`.toLocaleLowerCase().includes(term),
        )
      : tasks;
  }, [tasks, query]);
  const shownTasks = filteredTasks.slice(0, taskLimit);
  const updateQuery = (value: string) => {
    setQuery(value);
    setTaskLimit(50);
  };

  const messages = selectCommunicationMessages(model, selection);
  const visibleMessages = messages.slice(-visibleCount).toReversed();
  const counts = new Map<string, number>();
  for (const message of model.messages)
    for (const id of new Set([message.from, message.to])) counts.set(id, (counts.get(id) ?? 0) + 1);
  const heading =
    selection.kind === "all"
      ? "All conversations"
      : selection.kind === "participant"
        ? (byId.get(selection.id)?.label ?? "Task conversation")
        : `${byId.get(selection.from)?.label ?? "Agent"} ↔ ${byId.get(selection.to)?.label ?? "Agent"}`;
  const choose = (next: CommunicationSelection) => {
    setVisibleCount(30);
    props.onSelect(next);
  };
  return (
    <div
      className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[13rem_minmax(0,1fr)]"
      data-agent-communication-view
    >
      <nav aria-label="Task conversations" className="hidden min-h-0 flex-col border-r md:flex">
        <div className="shrink-0 space-y-2 p-3">
          <p className="px-2 text-xs font-medium text-muted-foreground">TASK CONVERSATIONS</p>
          <Input
            size="compact"
            type="search"
            aria-label="Search task conversations"
            placeholder="Search tasks…"
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
          />
          <p className="px-2 text-2xs text-muted-foreground">{tasks.length} tasks · Newest first</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <TaskButton
            label="All conversations"
            count={model.messages.length}
            selected={selection.kind === "all"}
            onClick={() => choose({ kind: "all" })}
          />
          {shownTasks.map((p) => (
            <TaskButton
              key={p.id}
              taskId={p.id}
              label={p.label}
              detail={
                <>
                  {p.environmentLabel} ·{" "}
                  <span className={statusClasses[communicationStatusTone(p.status)]}>
                    {p.status}
                  </span>
                </>
              }
              count={counts.get(p.id) ?? 0}
              at={activity.get(p.id) ?? 0}
              selected={selection.kind === "participant" && selection.id === p.id}
              onClick={() => choose({ kind: "participant", id: p.id })}
            />
          ))}
          {!filteredTasks.length ? (
            <p className="p-2 text-xs text-muted-foreground">No matching tasks.</p>
          ) : null}
          {filteredTasks.length > taskLimit ? (
            <Button size="xs" variant="ghost" onClick={() => setTaskLimit((count) => count + 50)}>
              Show {Math.min(50, filteredTasks.length - taskLimit)} more tasks
            </Button>
          ) : null}
        </div>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="shrink-0 space-y-2 border-b px-4 py-2 md:hidden">
          {tasks.length > 10 ? (
            <Input
              size="compact"
              type="search"
              aria-label="Search task conversations on mobile"
              placeholder="Search tasks…"
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
            />
          ) : null}
          <label className="flex items-center gap-2 text-xs">
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
              <option value="all">All conversations</option>
              {selection.kind === "connection" ? (
                <option value="connection" disabled>
                  Selected connection
                </option>
              ) : null}
              {selection.kind === "participant" &&
              !shownTasks.some((p) => p.id === selection.id) ? (
                <option value={selection.id}>
                  {byId.get(selection.id)?.label ?? "Selected task"}
                </option>
              ) : null}
              {shownTasks.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <section aria-label="Connection map" className="flex min-h-0 shrink flex-col border-b">
          <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2">
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
            <AgentCommunicationMap model={model} selection={selection} onSelect={choose} />
          ) : null}
        </section>
        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium">{heading}</h3>
            <p className="text-xs text-muted-foreground">
              {selection.kind === "all"
                ? "Task assignments, returned results, and messages between agents."
                : "Recorded communication · viewing does not send messages"}
            </p>
            <p className="mt-1 text-2xs text-muted-foreground">Newest first</p>
          </div>
          {selection.kind !== "all" ? (
            <Button size="xs" variant="ghost" onClick={() => choose({ kind: "all" })}>
              Overview
            </Button>
          ) : null}
        </div>
        <section
          aria-label="Messages between agents"
          className="min-h-24 flex-1 overflow-y-auto overscroll-contain px-4 pb-4"
          key={JSON.stringify(selection)}
        >
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
          {messages.length > visibleCount ? (
            <div className="py-3">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setVisibleCount((count) => count + 30)}
              >
                Show {Math.min(30, messages.length - visibleCount)} older messages
              </Button>
            </div>
          ) : null}
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

const formatActivityTime = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function TaskButton(props: {
  label: string;
  detail?: React.ReactNode;
  count: number;
  taskId?: string;
  at?: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      data-communication-task={props.taskId}
      onClick={props.onClick}
      className={cn(
        "mb-1 block w-full min-w-0 rounded-lg border p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        props.selected ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-muted/50",
      )}
    >
      <span className="line-clamp-2 break-words text-sm font-medium [overflow-wrap:anywhere]">
        {props.label}
      </span>
      {props.detail ? (
        <span className="block truncate text-xs text-muted-foreground">{props.detail}</span>
      ) : null}
      <span className="mt-1 flex flex-wrap gap-x-2 text-2xs text-muted-foreground">
        <span>{props.count} exchanges</span>
        {props.at ? (
          <time dateTime={new Date(props.at).toISOString()}>
            {formatActivityTime.format(props.at)}
          </time>
        ) : null}
      </span>
    </button>
  );
}
