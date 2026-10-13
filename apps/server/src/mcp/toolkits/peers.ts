import {
  EnvironmentId,
  OrchestratorMcpFailure,
  PeerEnvironment,
  PeerFilesListResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as Peers from "../../peers/Peers.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import { McpInvocationContext } from "../McpInvocationContext.ts";
import * as McpToolAccess from "../McpToolAccess.ts";
import { loadCaller } from "../threadAccess.ts";

const shared = {
  failure: Schema.Union([Peers.PeersError, OrchestratorMcpFailure]),
  failureMode: "return" as const,
  dependencies: [McpInvocationContext, ThreadManagementService.ThreadManagementService],
};
const environment = EnvironmentId.annotate({
  description: "environmentId of the other machine, from t3_peers_list.",
});
const peerPath = (description: string) => Schema.String.annotate({ description });

const list = Tool.make("t3_peers_list", {
  ...shared,
  description:
    "List the user's other machines (environments) that T3 Code can reach right now, with the absolute folder of every project on each. sameProject marks the folders that hold the project this thread works on. self gives this machine's own folders. Start here before any other t3_peer tool. Tracked work moves through Git; these tools are for files Git does not carry, such as .env files, large files and ignored data. Needs the T3 Code desktop or web app open and connected to both machines.",
  success: Schema.Struct({
    self: Schema.Struct({
      environmentId: EnvironmentId,
      label: Schema.String,
      projectFolder: Schema.NullOr(Schema.String),
      workingFolder: Schema.NullOr(Schema.String),
    }),
    peers: Schema.Array(PeerEnvironment),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const filesList = Tool.make("t3_peer_files_list", {
  ...shared,
  description:
    "List a folder on another machine: each entry's path relative to it, kind, size and modification time. path is absolute and must lie inside a project folder or thread worktree there. recursive walks subfolders but stops at .git and node_modules, and at 2,000 entries (truncated=true, then list subfolders). untrackedOnly lists only what Git does not carry there (untracked and ignored paths, whole folders collapsed), which is the quick way to find files a clone would miss. hash adds a sha256 per file so you can compare with `shasum -a 256` here. A path to a file answers with that one file.",
  parameters: Schema.Struct({
    environment,
    path: peerPath("Absolute folder or file on the other machine."),
    recursive: Schema.optionalKey(Schema.Boolean),
    untrackedOnly: Schema.optionalKey(Schema.Boolean),
    hash: Schema.optionalKey(Schema.Boolean),
  }),
  success: PeerFilesListResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const fileRead = Tool.make("t3_peer_file_read", {
  ...shared,
  description:
    "Read a text file on another machine, up to 256 KB (truncated=true beyond that). For comparing or inspecting small files such as .env or configs. To bring a file here, use t3_peer_copy instead: it handles any size and binary content without passing through you.",
  parameters: Schema.Struct({
    environment,
    path: peerPath("Absolute file on the other machine."),
  }),
  success: Schema.Struct({
    text: Schema.String,
    size: Schema.Number,
    truncated: Schema.Boolean,
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const copy = Tool.make("t3_peer_copy", {
  ...shared,
  description:
    "Copy a file, or a whole folder, between this machine and another one. direction to_peer sends localPath to peerPath there; from_peer brings peerPath to localPath here. Both paths are absolute, name the destination itself (not its parent folder), and must lie inside a project folder or thread worktree on their machine. Missing parent folders are created, file permissions are kept, and every file is verified by checksum. An existing destination fails unless overwrite is true; in a folder copy, existing files are skipped and reported instead. Folder copies skip .git and node_modules. Nothing is ever deleted. Needs a full-access thread.",
  parameters: Schema.Struct({
    environment,
    direction: Schema.Literals(["to_peer", "from_peer"]),
    localPath: peerPath("Absolute path on this machine."),
    peerPath: peerPath("Absolute path on the other machine."),
    overwrite: Schema.optionalKey(Schema.Boolean),
  }),
  success: Schema.Struct({
    files: Schema.Number,
    bytes: Schema.Number,
    skipped: Schema.Array(Schema.Struct({ path: Schema.String, reason: Schema.String })),
  }),
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false);

export const PeersToolkit = Toolkit.make(list, filesList, fileRead, copy);

export const PeersHandlersLive = McpToolAccess.toLayer(
  PeersToolkit,
  Effect.gen(function* () {
    const peers = yield* Peers.Peers;
    const projects = yield* ProjectService.ProjectService;
    const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
    return {
      t3_peers_list: McpToolAccess.readsAsCaller(() =>
        Effect.gen(function* () {
          const { caller } = yield* loadCaller();
          const descriptor = yield* serverEnvironment.getDescriptor;
          const project =
            caller === undefined
              ? undefined
              : Option.getOrUndefined(
                  yield* projects
                    .getById(caller.projectId)
                    .pipe(Effect.orElseSucceed(() => Option.none())),
                );
          return {
            self: {
              environmentId: descriptor.environmentId,
              label: descriptor.label,
              projectFolder: project?.workspaceRoot ?? null,
              workingFolder: caller?.worktreePath ?? project?.workspaceRoot ?? null,
            },
            peers: yield* peers.describe(caller?.projectId ?? null),
          };
        }),
      ),
      t3_peer_files_list: McpToolAccess.readsAsCaller((input) =>
        peers.list(input.environment, {
          path: input.path,
          recursive: input.recursive ?? false,
          untrackedOnly: input.untrackedOnly ?? false,
          hash: input.hash ?? false,
        }),
      ),
      t3_peer_file_read: McpToolAccess.readsAsCaller((input) =>
        peers.readText(input.environment, input.path),
      ),
      t3_peer_copy: McpToolAccess.writesEnvironment((input) =>
        peers.copy({
          environmentId: input.environment,
          direction: input.direction,
          localPath: input.localPath,
          peerPath: input.peerPath,
          overwrite: input.overwrite ?? false,
        }),
      ),
    };
  }),
);
