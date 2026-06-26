import type { EnvironmentId, ResumableSession, ScopedProjectRef } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { ChevronRight, History, LoaderCircle, RotateCcw } from "lucide-react";
import { useState } from "react";

import { type DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { cn } from "../../lib/utils";
import { useResumeSeedStore } from "../../resumeSeedStore";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { toastManager } from "../ui/toast";

interface ResumeSessionsSectionProps {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly projectRef: ScopedProjectRef;
}

function relativeTime(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const diff = Math.max(0, now - then);
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months}mo` : `${Math.round(months / 12)}y`;
}

function ResumeSessionsList({ environmentId, cwd, projectRef }: ResumeSessionsSectionProps) {
  const query = useEnvironmentQuery(
    projectEnvironment.listResumableSessions({ environmentId, input: { cwd } }),
  );
  const handleNewThread = useNewThreadHandler();
  const setModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const setSeed = useResumeSeedStore((store) => store.setSeed);
  const now = Date.now();

  const handleResume = (session: ResumableSession) => {
    void handleNewThread(projectRef, {
      forceNew: true,
      onDraftCreated: ({ draftId, threadId }) => {
        if (session.model) {
          setModelSelection(
            draftId as DraftId,
            createModelSelection(session.providerInstanceId, session.model),
          );
        }
        setSeed(threadId, {
          resumeCursor: session.resumeCursor,
          providerLabel: session.providerLabel,
          title: session.title,
        });
      },
    }).then(
      () =>
        toastManager.add({
          type: "info",
          title: `Continuing ${session.providerLabel} session`,
          description: "Send a message to pick up where it left off.",
        }),
      () => undefined,
    );
  };

  if (query.isPending && query.data === null) {
    return (
      <div className="flex h-6 items-center gap-2 px-2 text-[10px] text-muted-foreground">
        <LoaderCircle className="size-3 animate-spin" /> Scanning sessions…
      </div>
    );
  }
  if (query.error && query.data === null) {
    return <div className="px-2 py-1 text-[10px] text-destructive">{query.error}</div>;
  }
  const sessions = query.data?.sessions ?? [];
  if (sessions.length === 0) {
    return (
      <div className="px-2 py-1 text-[10px] text-muted-foreground">
        No CLI sessions for this repo
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      {sessions.map((session) => (
        <button
          key={session.key}
          type="button"
          className="group/resume flex w-full min-w-0 items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent"
          title={`Continue ${session.providerLabel} session — ${session.title}`}
          onClick={() => handleResume(session)}
        >
          <RotateCcw className="size-3 shrink-0 text-muted-foreground group-hover/resume:text-foreground" />
          <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
            {session.title}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[9px]">
            {session.status === "active" ? (
              <span className="size-1.5 rounded-full bg-emerald-500" aria-label="recently active" />
            ) : null}
            <span className="font-medium text-foreground/75">{session.providerLabel}</span>
            <span className="text-muted-foreground">·</span>
            <span className="tabular-nums text-foreground/60">
              {relativeTime(session.updatedAt, now)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Collapsible per-project list of resumable Claude/Codex CLI sessions discovered on disk. Querying
 * scans the provider session stores, so the list mounts (and scans) only once the user expands it.
 */
export function ResumeSessionsSection(props: ResumeSessionsSectionProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-0.5 mt-0.5 flex flex-col px-1 sm:mx-1 sm:px-1.5">
      <button
        type="button"
        className="flex h-6 w-full items-center gap-1.5 rounded px-2 text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
        <History className="size-3 shrink-0" />
        <span>Resume from CLI</span>
      </button>
      {open ? <ResumeSessionsList {...props} /> : null}
    </div>
  );
}
