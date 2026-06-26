import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { LoaderCircle } from "lucide-react";
import { useMemo } from "react";

import { AnnotatableCodeView } from "~/components/diffs/AnnotatableCodeView";
import type { DraftId } from "~/composerDraftStore";
import { useClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import {
  buildFileDiffRenderKey,
  getRenderablePatch,
  resolveEditorDiffTheme,
  resolveFileDiffPath,
} from "~/lib/diffRendering";

import { useGitFileDiff } from "./gitChangesState";

interface CommitFileDiffViewProps {
  environmentId: EnvironmentId;
  cwd: string;
  path: string;
  composerDraftTarget: ScopedThreadRef | DraftId;
}

/** Renders the working-tree diff (staged + unstaged vs HEAD) for a single file from the Commit view. */
export function CommitFileDiffView({
  environmentId,
  cwd,
  path,
  composerDraftTarget,
}: CommitFileDiffViewProps) {
  const { resolvedTheme } = useTheme();
  const settings = useClientSettings();
  const editorDiffTheme = resolveEditorDiffTheme(settings.editorSyntaxTheme, resolvedTheme);
  const diffQuery = useGitFileDiff(environmentId, cwd, path);
  const diff = diffQuery.data?.diff ?? "";

  const renderablePatch = useMemo(
    () =>
      getRenderablePatch(diff, `commit-diff:${resolvedTheme}`, { compactPartialHunkOffsets: true }),
    [diff, resolvedTheme],
  );
  const files = useMemo(
    () =>
      renderablePatch?.kind === "files"
        ? renderablePatch.files.map((fileDiff) => ({
            fileDiff,
            filePath: resolveFileDiffPath(fileDiff),
            fileKey: buildFileDiffRenderKey(fileDiff),
            collapsed: false,
          }))
        : [],
    [renderablePatch],
  );

  if (diffQuery.isPending && diffQuery.data === null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    );
  }
  if (diffQuery.error && diffQuery.data === null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs leading-relaxed text-destructive">
        {diffQuery.error}
      </div>
    );
  }
  if (diff.trim().length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs leading-relaxed text-muted-foreground">
        No changes to show for {path}.
      </div>
    );
  }
  if (files.length === 0) {
    return (
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre p-3 text-xs text-foreground">
        {diff}
      </pre>
    );
  }

  return (
    <AnnotatableCodeView
      className="diff-render-surface min-h-0 flex-1 overflow-auto"
      files={files}
      sectionId={`commit-diff:${path}`}
      sectionTitle={path}
      composerDraftTarget={composerDraftTarget}
      renderHeaderPrefix={() => null}
      options={{
        diffStyle: "unified",
        lineDiffType: "none",
        overflow: settings.wordWrap ? "wrap" : "scroll",
        theme: editorDiffTheme.themeName,
        themeType: editorDiffTheme.themeType,
        stickyHeaders: true,
        layout: { paddingTop: 8, paddingBottom: 8, gap: 8 },
      }}
    />
  );
}
