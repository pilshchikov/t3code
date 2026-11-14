import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "~/lib/utils";

import { type OutlineKind, type OutlineSymbol, parseFileOutline } from "./fileOutline";

interface FileStructurePanelProps {
  readonly relativePath: string | null;
  readonly contents: string | null;
  readonly loading: boolean;
  readonly onNavigate: (lineNumber: number) => void;
}

const KIND_BADGE: Record<OutlineKind, { readonly letter: string; readonly className: string }> = {
  class: { letter: "C", className: "bg-(--context-chip-file)/15 text-(--context-chip-file)" },
  interface: {
    letter: "I",
    className: "bg-(--context-chip-pull-request)/15 text-(--context-chip-pull-request)",
  },
  enum: { letter: "E", className: "bg-(--context-chip-element)/15 text-(--context-chip-element)" },
  struct: { letter: "S", className: "bg-(--context-chip-file)/15 text-(--context-chip-file)" },
  trait: {
    letter: "T",
    className: "bg-(--context-chip-pull-request)/15 text-(--context-chip-pull-request)",
  },
  type: { letter: "T", className: "bg-(--context-chip-thread)/15 text-(--context-chip-thread)" },
  function: {
    letter: "f",
    className: "bg-(--context-chip-review-comment)/15 text-(--context-chip-review-comment)",
  },
  method: {
    letter: "m",
    className: "bg-(--context-chip-pr-closed)/15 text-(--context-chip-pr-closed)",
  },
  variable: {
    letter: "v",
    className: "bg-(--context-chip-terminal)/15 text-(--context-chip-terminal)",
  },
  constant: {
    letter: "c",
    className: "bg-(--context-chip-terminal)/15 text-(--context-chip-terminal)",
  },
};

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export default function FileStructurePanel({
  relativePath,
  contents,
  loading,
  onNavigate,
}: FileStructurePanelProps) {
  const [query, setQuery] = useState("");
  const symbols = useMemo<OutlineSymbol[]>(
    () => (contents && relativePath ? parseFileOutline(contents, relativePath) : []),
    [contents, relativePath],
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return symbols;
    return symbols.filter((symbol) => symbol.name.toLowerCase().includes(normalized));
  }, [query, symbols]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background" data-file-structure-panel="">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">
            {relativePath ? fileName(relativePath) : "Structure"}
          </div>
          <div className="truncate text-[10px] leading-none text-muted-foreground">
            {relativePath ? `${symbols.length} symbols` : "Open a file to see its structure"}
          </div>
        </div>
      </div>
      {relativePath && symbols.length > 8 ? (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/60 px-3">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter symbols"
            className="h-full min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {!relativePath ? (
          <div className="flex h-32 items-center justify-center px-4 text-center text-xs text-muted-foreground">
            Open a file to see its structure.
          </div>
        ) : loading && contents === null ? (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-32 items-center justify-center px-4 text-center text-xs text-muted-foreground">
            {symbols.length === 0 ? "No classes or functions found." : "No matching symbols."}
          </div>
        ) : (
          filtered.map((symbol) => {
            const badge = KIND_BADGE[symbol.kind];
            return (
              <button
                key={`${symbol.lineNumber}:${symbol.name}`}
                type="button"
                className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md pr-2 text-left hover:bg-accent/60"
                style={{ paddingLeft: `${8 + symbol.depth * 14}px` }}
                onClick={() => onNavigate(symbol.lineNumber)}
              >
                <span
                  data-symbol-kind={symbol.kind}
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded font-mono text-[10px] font-semibold",
                    badge.className,
                  )}
                  aria-hidden
                >
                  {badge.letter}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                  {symbol.name}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {symbol.lineNumber}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
