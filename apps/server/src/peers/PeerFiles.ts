// @effect-diagnostics nodeBuiltinImport:off
/** Relayed file paths must remain inside registered workspace roots or thread worktrees. */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeStream from "node:stream";
import * as NodeStreamPromises from "node:stream/promises";
import * as NodeZlib from "node:zlib";

import {
  PEER_FILES_LIST_MAX_ENTRIES,
  type PeerFileEntry,
  PeerFilesError,
  type PeerFilesFailureCode,
  type PeerFilesListInput,
  type PeerFilesListResult,
  type PeerFilesReadInput,
  type PeerFilesReadResult,
  type PeerFilesWriteInput,
  type PeerFilesWriteResult,
  type PeerFilesPackInput,
  type PeerFilesPackResult,
  type PeerFilesUnpackInput,
  type PeerFilesUnpackResult,
  type PeerFilesRemovePackInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

/** Listed as folders but not walked: their contents are rebuilt, not copied. */
const UNWALKED_DIRECTORIES = new Set([".git", "node_modules"]);

export class PeerFiles extends Context.Service<
  PeerFiles,
  {
    readonly list: (
      input: PeerFilesListInput,
    ) => Effect.Effect<PeerFilesListResult, PeerFilesError>;
    readonly read: (
      input: PeerFilesReadInput,
    ) => Effect.Effect<PeerFilesReadResult, PeerFilesError>;
    /**
     * Collects chunks in a temporary file beside the destination and renames it over the
     * destination with the last one, so a broken transfer never leaves a half-written file there.
     */
    readonly write: (
      input: PeerFilesWriteInput,
    ) => Effect.Effect<PeerFilesWriteResult, PeerFilesError>;
    readonly pack: (
      input: PeerFilesPackInput,
    ) => Effect.Effect<PeerFilesPackResult, PeerFilesError>;
    readonly unpack: (
      input: PeerFilesUnpackInput,
    ) => Effect.Effect<PeerFilesUnpackResult, PeerFilesError>;
    readonly removePack: (input: PeerFilesRemovePackInput) => Effect.Effect<void, PeerFilesError>;
  }
>()("t3/peers/PeerFiles") {}

const failure = (code: PeerFilesFailureCode, message: string) =>
  new PeerFilesError({ code, message });

const errorCode = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined;

const isPeerFilesError = Schema.is(PeerFilesError);

const toFailure = (cause: unknown) =>
  isPeerFilesError(cause)
    ? cause
    : errorCode(cause) === "ENOENT"
      ? failure("not_found", "No such file or directory.")
      : failure("io_failed", cause instanceof Error ? cause.message : "The file operation failed.");

const io = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: toFailure });

/** The real path of `target`, whose trailing segments may not exist yet. */
async function realPathAllowingMissing(target: string): Promise<string> {
  const missing: Array<string> = [];
  let current = target;
  for (;;) {
    try {
      return NodePath.join(await NodeFSP.realpath(current), ...missing);
    } catch (cause) {
      const parent = NodePath.dirname(current);
      if (errorCode(cause) !== "ENOENT" || parent === current) throw cause;
      missing.unshift(NodePath.basename(current));
      current = parent;
    }
  }
}

async function resolveInside(roots: ReadonlyArray<string>, requested: string): Promise<string> {
  if (!NodePath.isAbsolute(requested)) {
    throw failure("outside_projects", "Use an absolute path. t3_peers_list shows each folder.");
  }
  const real = await realPathAllowingMissing(NodePath.resolve(requested));
  for (const root of roots) {
    const realRoot = await NodeFSP.realpath(root).catch(() => null);
    if (realRoot !== null && (real === realRoot || real.startsWith(realRoot + NodePath.sep))) {
      return real;
    }
  }
  throw failure(
    "outside_projects",
    `${requested} is not inside a project folder or thread worktree of this environment.`,
  );
}

async function sha256(path: string): Promise<string> {
  const hash = NodeCrypto.createHash("sha256");
  await NodeStreamPromises.pipeline(NodeFS.createReadStream(path), hash);
  return hash.digest("hex");
}

async function describeEntry(
  directory: string,
  relativePath: string,
  hash: boolean,
): Promise<PeerFileEntry> {
  const absolutePath = NodePath.join(directory, relativePath);
  const stat = await NodeFSP.lstat(absolutePath);
  const kind = stat.isFile()
    ? "file"
    : stat.isDirectory()
      ? "directory"
      : stat.isSymbolicLink()
        ? "symlink"
        : "other";
  return {
    path: relativePath.split(NodePath.sep).join("/"),
    kind,
    size: kind === "file" ? stat.size : 0,
    modifiedAt: stat.mtime.toISOString(),
    ...(hash && kind === "file" ? { sha256: await sha256(absolutePath) } : {}),
  };
}

async function walk(directory: string, input: PeerFilesListInput) {
  const entries: Array<PeerFileEntry> = [];
  const pending = [""];
  while (pending.length > 0) {
    const relativeDirectory = pending.shift()!;
    const names = (await NodeFSP.readdir(NodePath.join(directory, relativeDirectory))).sort();
    for (const name of names) {
      if (entries.length >= PEER_FILES_LIST_MAX_ENTRIES) return { entries, truncated: true };
      const entry = await describeEntry(
        directory,
        NodePath.join(relativeDirectory, name),
        input.hash,
      );
      entries.push(entry);
      if (input.recursive && entry.kind === "directory" && !UNWALKED_DIRECTORIES.has(name)) {
        pending.push(NodePath.join(relativeDirectory, name));
      }
    }
  }
  return { entries, truncated: false };
}

const PACK_PREFIX = ".t3-pack-";
const isPackName = (name: string) => name.startsWith(PACK_PREFIX) && name.endsWith(".t3pack");

export function normalizeRelativePath(path: string): string | undefined {
  if (NodePath.posix.isAbsolute(path) || NodePath.win32.isAbsolute(path)) return undefined;
  const normalized = NodePath.posix.normalize(path.replaceAll("\\", "/")).replace(/\/+$/, "");
  if (normalized === "" || normalized === "." || normalized.split("/").includes(".."))
    return undefined;
  return normalized;
}

type PackedFile = { readonly path: string; readonly size: number; readonly mode: number };

async function collectPackFiles(root: string, include: ReadonlyArray<string> | undefined) {
  const files: Array<PackedFile> = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const visit = async (relative: string): Promise<void> => {
    const stat = await NodeFSP.lstat(NodePath.join(root, relative));
    if (stat.isFile()) {
      files.push({ path: relative, size: stat.size, mode: stat.mode & 0o777 });
      return;
    }
    if (!stat.isDirectory()) {
      skipped.push({
        path: relative,
        reason: `${stat.isSymbolicLink() ? "symlink" : "other"} entries are not copied`,
      });
      return;
    }
    for (const name of (await NodeFSP.readdir(NodePath.join(root, relative))).sort()) {
      if (UNWALKED_DIRECTORIES.has(name) || isPackName(name)) continue;
      await visit(relative === "" ? name : `${relative}/${name}`);
    }
  };
  for (const entry of include ?? [""]) {
    const relative = entry === "" ? "" : normalizeRelativePath(entry);
    if (relative === undefined)
      throw failure("outside_projects", `include paths must be relative, without "..": ${entry}`);
    await visit(relative);
  }
  return { files, skipped };
}

/**
 * One gzip stream of records: a 4-byte big-endian header length, a JSON header with path,
 * size and mode, then the file's bytes. Regular files only, as folder copies already were.
 */
async function writePack(root: string, files: ReadonlyArray<PackedFile>, archivePath: string) {
  async function* records() {
    for (const file of files) {
      const header = Buffer.from(JSON.stringify({ p: file.path, s: file.size, m: file.mode }));
      const length = Buffer.alloc(4);
      length.writeUInt32BE(header.length);
      yield length;
      yield header;
      let sent = 0;
      if (file.size > 0)
        for await (const chunk of NodeFS.createReadStream(NodePath.join(root, file.path), {
          end: file.size - 1,
        })) {
          sent += (chunk as Buffer).length;
          yield chunk as Buffer;
        }
      if (sent !== file.size)
        throw failure("io_failed", `${file.path} changed while it was packed. Copy it again.`);
    }
  }
  await NodeStreamPromises.pipeline(
    NodeStream.Readable.from(records()),
    NodeZlib.createGzip({ level: 1 }),
    NodeFS.createWriteStream(archivePath, { mode: 0o600 }),
  );
}

function byteReader(source: AsyncIterable<Buffer>) {
  const iterator = source[Symbol.asyncIterator]();
  let buffered: Buffer = Buffer.alloc(0);
  const fill = async () => {
    const next = await iterator.next();
    if (next.done === true) return false;
    buffered = buffered.length === 0 ? next.value : Buffer.concat([buffered, next.value]);
    return true;
  };
  const truncated = () => failure("io_failed", "The archive ended early. Copy it again.");
  return {
    /** The next `length` bytes, or null at a clean end of the archive. */
    async exact(length: number): Promise<Buffer | null> {
      while (buffered.length < length) {
        if (await fill()) continue;
        if (buffered.length === 0) return null;
        throw truncated();
      }
      const out = buffered.subarray(0, length);
      buffered = buffered.subarray(length);
      return out;
    },
    async *take(length: number): AsyncGenerator<Buffer> {
      let left = length;
      while (left > 0) {
        if (buffered.length === 0 && !(await fill())) throw truncated();
        const piece = buffered.subarray(0, Math.min(left, buffered.length));
        buffered = buffered.subarray(piece.length);
        left -= piece.length;
        yield piece;
      }
    },
  };
}

async function readPack(archivePath: string, destination: string, overwrite: boolean) {
  const realDestination = await NodeFSP.realpath(destination);
  const reader = byteReader(
    NodeFS.createReadStream(archivePath).pipe(NodeZlib.createGunzip()) as AsyncIterable<Buffer>,
  );
  const skipped: Array<{ path: string; reason: string }> = [];
  let files = 0;
  let bytes = 0;
  for (;;) {
    const length = await reader.exact(4);
    if (length === null) break;
    const raw = await reader.exact(length.readUInt32BE());
    const header = JSON.parse(raw?.toString("utf8") ?? "null") as {
      p?: unknown;
      s?: unknown;
      m?: unknown;
    } | null;
    const relative = typeof header?.p === "string" ? normalizeRelativePath(header.p) : undefined;
    const size = header?.s;
    if (
      relative === undefined ||
      typeof size !== "number" ||
      !Number.isSafeInteger(size) ||
      size < 0
    )
      throw failure("io_failed", "The archive holds an invalid entry.");
    const target = NodePath.join(realDestination, ...relative.split("/"));
    const parent = await realPathAllowingMissing(NodePath.dirname(target));
    if (parent !== realDestination && !parent.startsWith(realDestination + NodePath.sep))
      throw failure("outside_projects", `${relative} would land outside ${destination}.`);
    const existing = await NodeFSP.lstat(target).catch(() => null);
    if (existing !== null && (existing.isDirectory() || !overwrite)) {
      skipped.push({
        path: relative,
        reason: existing.isDirectory() ? "a folder is there" : "already exists",
      });
      for await (const _ of reader.take(size)) void _;
      continue;
    }
    await NodeFSP.mkdir(NodePath.dirname(target), { recursive: true });
    const temporary = `${target}.t3-unpack-${NodeCrypto.randomUUID()}`;
    try {
      await NodeStreamPromises.pipeline(
        NodeStream.Readable.from(reader.take(size)),
        NodeFS.createWriteStream(temporary, { mode: 0o600 }),
      );
      await NodeFSP.chmod(temporary, (typeof header?.m === "number" ? header.m : 0o644) & 0o777);
      await NodeFSP.rename(temporary, target);
    } catch (cause) {
      await NodeFSP.rm(temporary, { force: true });
      throw cause;
    }
    files += 1;
    bytes += size;
  }
  skipped.sort((left, right) => left.path.localeCompare(right.path));
  return { files, bytes, skipped };
}

const make = Effect.gen(function* () {
  const projects = yield* ProjectService.ProjectService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const git = yield* GitVcsDriver.GitVcsDriver;

  const roots = Effect.gen(function* () {
    const snapshot = yield* projects.snapshot;
    const shells = yield* threads.getShellSnapshot();
    return [
      ...snapshot.projects.flatMap((project) =>
        project.deletedAt === null
          ? [project.workspaceRoot, ...(project.workspaceRoots ?? []).map((root) => root.path)]
          : [],
      ),
      ...shells.threads.flatMap((thread) =>
        thread.worktreePath === null ? [] : [thread.worktreePath],
      ),
    ];
  }).pipe(
    Effect.mapError(() => failure("io_failed", "Could not read this environment's projects.")),
  );

  const resolve = (path: string) =>
    Effect.flatMap(roots, (allowed) => io(() => resolveInside(allowed, path)));

  const untracked = Effect.fn("PeerFiles.untracked")(function* (directory: string) {
    const result = yield* git
      .execute({
        operation: "PeerFiles.untracked",
        cwd: directory,
        args: ["ls-files", "--others", "--directory", "-z"],
        maxOutputBytes: 1024 * 1024,
      })
      .pipe(
        Effect.mapError(() =>
          failure(
            "not_a_repository",
            "untrackedOnly needs a Git repository. List this folder without it.",
          ),
        ),
      );
    const paths = result.stdout
      .split("\0")
      .filter((path) => path.length > 0)
      .map((path) => (path.endsWith("/") ? path.slice(0, -1) : path));
    return {
      paths: paths.slice(0, PEER_FILES_LIST_MAX_ENTRIES),
      truncated: result.stdoutTruncated || paths.length > PEER_FILES_LIST_MAX_ENTRIES,
    };
  });

  const list: PeerFiles["Service"]["list"] = Effect.fn("PeerFiles.list")(function* (input) {
    const path = yield* resolve(input.path);
    const stat = yield* io(() => NodeFSP.stat(path));
    if (!stat.isDirectory()) {
      const entry = yield* io(() =>
        describeEntry(NodePath.dirname(path), NodePath.basename(path), input.hash),
      );
      return { path, kind: "file" as const, entries: [entry], truncated: false };
    }
    const kind = "directory" as const;
    if (!input.untrackedOnly) return { path, kind, ...(yield* io(() => walk(path, input))) };
    const { paths, truncated } = yield* untracked(path);
    const entries = yield* io(() =>
      Promise.all(paths.map((relativePath) => describeEntry(path, relativePath, input.hash))),
    );
    return { path, kind, entries, truncated };
  });

  const read: PeerFiles["Service"]["read"] = Effect.fn("PeerFiles.read")(function* (input) {
    const path = yield* resolve(input.path);
    return yield* io(async () => {
      const handle = await NodeFSP.open(path, "r");
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) throw failure("not_a_file", `${input.path} is not a regular file.`);
        const buffer = Buffer.alloc(Math.max(0, Math.min(input.length, stat.size - input.offset)));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, input.offset);
        return {
          data: buffer.subarray(0, bytesRead).toString("base64"),
          size: stat.size,
          mode: stat.mode & 0o777,
          modifiedAt: stat.mtime.toISOString(),
          eof: input.offset + bytesRead >= stat.size,
        };
      } finally {
        await handle.close();
      }
    });
  });

  const write: PeerFiles["Service"]["write"] = Effect.fn("PeerFiles.write")(function* (input) {
    const path = yield* resolve(input.path);
    return yield* io(async () => {
      const directory = NodePath.dirname(path);
      const transferPrefix = `.${NodePath.basename(path)}.t3-transfer-`;
      const temporaryPath = NodePath.join(directory, `${transferPrefix}${input.transferId}`);
      const bytes = Buffer.from(input.data, "base64");
      if (input.offset === 0) {
        const existing = await NodeFSP.stat(path).catch(() => null);
        if (existing?.isDirectory()) throw failure("not_a_file", `${input.path} is a directory.`);
        if (existing !== null && !input.overwrite) {
          throw failure(
            "already_exists",
            `${input.path} already exists. Pass overwrite to replace it.`,
          );
        }
        await NodeFSP.mkdir(directory, { recursive: true });
        // A transfer that broke earlier left its temporary file behind.
        for (const name of await NodeFSP.readdir(directory)) {
          if (name.startsWith(transferPrefix)) await NodeFSP.rm(NodePath.join(directory, name));
        }
        await NodeFSP.writeFile(temporaryPath, bytes, { mode: 0o600 });
      } else {
        const collected = await NodeFSP.stat(temporaryPath);
        if (collected.size !== input.offset) {
          throw failure(
            "transfer_out_of_order",
            `Expected the chunk at ${collected.size}, got the one at ${input.offset}.`,
          );
        }
        await NodeFSP.appendFile(temporaryPath, bytes);
      }
      const size = input.offset + bytes.length;
      if (!input.last) return { size };
      await NodeFSP.chmod(temporaryPath, (input.mode ?? 0o644) & 0o777);
      await NodeFSP.rename(temporaryPath, path);
      return { size, sha256: await sha256(path) };
    });
  });

  const resolvePack = (archivePath: string) =>
    resolve(archivePath).pipe(
      Effect.filterOrFail(
        (path) => isPackName(NodePath.basename(path)),
        () => failure("not_a_file", `${archivePath} is not a transfer archive.`),
      ),
    );

  const pack: PeerFiles["Service"]["pack"] = Effect.fn("PeerFiles.pack")(function* (input) {
    const root = yield* resolve(input.path);
    return yield* io(async () => {
      if (!(await NodeFSP.stat(root)).isDirectory())
        throw failure("not_a_directory", `${input.path} is not a folder.`);
      const { files, skipped } = await collectPackFiles(root, input.include);
      const archivePath = NodePath.join(root, `${PACK_PREFIX}${input.transferId}.t3pack`);
      try {
        await writePack(root, files, archivePath);
      } catch (cause) {
        await NodeFSP.rm(archivePath, { force: true });
        throw cause;
      }
      return {
        archivePath,
        files: files.length,
        bytes: files.reduce((sum, file) => sum + file.size, 0),
        skipped,
      };
    });
  });

  const unpack: PeerFiles["Service"]["unpack"] = Effect.fn("PeerFiles.unpack")(function* (input) {
    const archivePath = yield* resolvePack(input.archivePath);
    const destination = yield* resolve(input.destination);
    return yield* io(async () => {
      try {
        await NodeFSP.mkdir(destination, { recursive: true });
        return await readPack(archivePath, destination, input.overwrite);
      } finally {
        await NodeFSP.rm(archivePath, { force: true });
      }
    });
  });

  const removePack: PeerFiles["Service"]["removePack"] = Effect.fn("PeerFiles.removePack")(
    function* (input) {
      const archivePath = yield* resolvePack(input.archivePath);
      yield* io(() => NodeFSP.rm(archivePath, { force: true }));
    },
  );

  return PeerFiles.of({ list, read, write, pack, unpack, removePack });
});

export const layer = Layer.effect(PeerFiles, make);
