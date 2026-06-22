import type { ProjectCodeSearchMatch } from "@t3tools/contracts";
import { Braces, FileCode2, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { Dialog, DialogPopup } from "~/components/ui/dialog";

interface SymbolNavigationDialogProps {
  readonly open: boolean;
  readonly symbol: string;
  readonly mode: "definitions" | "usages";
  readonly matches: ReadonlyArray<ProjectCodeSearchMatch>;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (match: ProjectCodeSearchMatch) => void;
}

export function SymbolNavigationDialog(props: SymbolNavigationDialogProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const filteredMatches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return props.matches;
    return props.matches.filter((match) =>
      `${match.path} ${match.snippet}`.toLowerCase().includes(normalized),
    );
  }, [props.matches, query]);

  useEffect(() => {
    if (!props.open) return;
    setQuery("");
    setSelectedIndex(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [props.open]);

  const select = (match: ProjectCodeSearchMatch) => {
    props.onOpenChange(false);
    props.onSelect(match);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup
        aria-label={`${props.mode} of ${props.symbol}`}
        className="max-w-3xl overflow-hidden rounded-lg p-0 before:rounded-[7px]"
        showCloseButton={false}
        bottomStickOnMobile={false}
      >
        <div className="flex h-12 items-center gap-3 border-b border-border px-4">
          <Search className="size-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedIndex((current) => Math.min(filteredMatches.length - 1, current + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex((current) => Math.max(0, current - 1));
              } else if (event.key === "Enter") {
                const selected = filteredMatches[selectedIndex];
                if (selected) select(selected);
              }
            }}
            placeholder={`${props.mode === "usages" ? "Usages" : "Definitions"} of ${props.symbol}`}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-[min(30rem,65vh)] min-h-48 overflow-y-auto p-2">
          {filteredMatches.map((match, index) => (
            <button
              key={`${match.path}:${match.lineNumber}:${match.column}`}
              type="button"
              className={cn(
                "flex min-h-11 w-full min-w-0 items-center gap-3 rounded-md px-2 text-left",
                index === selectedIndex ? "bg-accent" : "hover:bg-accent/60",
              )}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => select(match)}
            >
              {match.isDefinition ? (
                <Braces className="size-4 shrink-0 text-violet-500" />
              ) : (
                <FileCode2 className="size-4 shrink-0 text-sky-500" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{match.snippet.trim()}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {match.path}:{match.lineNumber}
                </span>
              </span>
            </button>
          ))}
        </div>
      </DialogPopup>
    </Dialog>
  );
}
