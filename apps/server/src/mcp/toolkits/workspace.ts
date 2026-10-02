import {
  ThreadWorkspaceError,
  ThreadWorkspaceInspectInput,
  ThreadWorkspaceInspectResult,
  ThreadWorkspaceSelectInput,
  ThreadWorkspaceCreateInput,
  ThreadWorkspaceResult,
} from "@t3tools/contracts";
import * as Struct from "effect/Struct";
import * as Effect from "effect/Effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import { McpInvocationContext, requireMcpCapability } from "../McpInvocationContext.ts";
import * as ThreadWorkspaces from "../../workspace/ThreadWorkspaces.ts";

const dependencies = [McpInvocationContext];
const inspect = Tool.make("thread_workspace_inspect", {
  description:
    "Inspect this thread's selected checkout, all project directories and their chosen checkouts, local changes, branches/worktrees. Set workspaceRoot to a configured repository root; omit it for the primary. Follow refs.nextCursor to list more refs. Does not change anything.",
  parameters: ThreadWorkspaceInspectInput.mapFields(Struct.omit(["threadId"])),
  success: ThreadWorkspaceInspectResult,
  failure: ThreadWorkspaceError,
  dependencies,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const create = Tool.make("thread_workspace_create", {
  description:
    "Create and SELECT a new worktree for one repository in this thread. Set workspaceRoot for an additional repository, omit it for the primary. Call BEFORE editing so T3's Files selectors follow your work. Uncommitted files are not transferred; run setup yourself. Use the returned cwd explicitly in running tools.",
  parameters: ThreadWorkspaceCreateInput.mapFields(Struct.omit(["threadId"])),
  success: ThreadWorkspaceResult,
  failure: ThreadWorkspaceError,
  dependencies,
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false);
const select = Tool.make("thread_workspace_select", {
  description:
    "SELECT an existing checkout for one repository in this thread and update its Files selector. Set workspaceRoot for an additional repository, omit it for the primary. Provide path from inspect or a branch name (creates a safe linked worktree if necessary). Select each repository independently BEFORE editing. No forced checkout, deletion or moving uncommitted files. Use returned cwd explicitly.",
  parameters: ThreadWorkspaceSelectInput.mapFields(Struct.omit(["threadId"])),
  success: ThreadWorkspaceResult,
  failure: ThreadWorkspaceError,
  dependencies,
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false);
export const WorkspaceToolkit = Toolkit.make(inspect, create, select);

export const WorkspaceHandlersLive = WorkspaceToolkit.toLayer(
  Effect.gen(function* () {
    const workspaces = yield* ThreadWorkspaces.ThreadWorkspaces;
    const scope = requireMcpCapability("workspace").pipe(
      Effect.mapError((cause) => new ThreadWorkspaceError({ message: cause.message })),
    );
    return WorkspaceToolkit.of({
      thread_workspace_inspect: (input) =>
        Effect.flatMap(scope, (ctx) =>
          workspaces.inspect({
            ...input,
            threadId: ctx.threadId,
            providerSessionId: ctx.providerSessionId,
          }),
        ),
      thread_workspace_create: (input) =>
        Effect.flatMap(scope, (ctx) =>
          workspaces.create({
            ...input,
            threadId: ctx.threadId,
            providerSessionId: ctx.providerSessionId,
          }),
        ),
      thread_workspace_select: (input) =>
        Effect.flatMap(scope, (ctx) =>
          workspaces.select({
            ...input,
            threadId: ctx.threadId,
            providerSessionId: ctx.providerSessionId,
          }),
        ),
    });
  }),
);
