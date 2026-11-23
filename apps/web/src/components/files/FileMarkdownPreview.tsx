import type { ScopedThreadRef } from "@t3tools/contracts";

import ChatMarkdown from "~/components/ChatMarkdown";
import { maskMarkdownFrontmatter } from "@t3tools/shared/markdownFrontmatter";
import { workspaceDocumentDirectory } from "./filePath";

export function FileMarkdownPreview(props: {
  readonly cwd: string;
  readonly relativePath: string;
  readonly text: string;
  readonly threadRef: ScopedThreadRef;
  readonly workspaceMutationId: string | null;
  readonly className?: string;
  readonly onTaskListChange?:
    | ((input: { readonly markerOffset: number; readonly checked: boolean }) => void)
    | undefined;
}) {
  return (
    <ChatMarkdown
      text={maskMarkdownFrontmatter(props.text)}
      cwd={workspaceDocumentDirectory(props.cwd, props.relativePath)}
      workspaceRoot={props.cwd}
      threadRef={props.threadRef}
      workspaceMutationId={props.workspaceMutationId}
      className={props.className ?? "file-markdown-preview w-full px-6 py-5"}
      onTaskListChange={props.onTaskListChange}
    />
  );
}
