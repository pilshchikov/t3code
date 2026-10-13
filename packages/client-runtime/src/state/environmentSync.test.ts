import {
  ENVIRONMENT_SYNC_CHUNK_BYTES,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type EnvironmentSyncImportResult,
  type EnvironmentSyncManifest,
  type EnvironmentSyncStatusResult,
  type RepositoryIdentity,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  findEnvironmentSyncTargetProject,
  runEnvironmentSync,
  selectEnvironmentSyncThreadIds,
  type EnvironmentSyncCommands,
  type EnvironmentSyncProgress,
} from "./environmentSync.ts";

const laptop = EnvironmentId.make("laptop");
const mini = EnvironmentId.make("mini");

const identity = (canonicalKey: string, origin?: string): RepositoryIdentity => ({
  canonicalKey,
  locator: { source: "git-remote", remoteName: "origin", remoteUrl: `https://${canonicalKey}` },
  ...(origin === undefined ? {} : { origin: { canonicalKey: origin } }),
});

describe("findEnvironmentSyncTargetProject", () => {
  const sourceProject = {
    environmentId: laptop,
    id: ProjectId.make("project:app"),
    repositoryIdentity: identity("github.com/upstream/app", "github.com/me/app"),
  };

  it("prefers the project an earlier sync created under the same id", () => {
    const sameId = { ...sourceProject, environmentId: mini, repositoryIdentity: null };
    const sameRepository = {
      ...sourceProject,
      environmentId: mini,
      id: ProjectId.make("project:clone"),
    };
    expect(
      findEnvironmentSyncTargetProject({
        sourceProject,
        targetEnvironmentId: mini,
        projects: [sourceProject, sameRepository, sameId],
      }),
    ).toBe(sameId);
  });

  it("falls back to a checkout of the same fork, never its upstream", () => {
    const upstream = {
      environmentId: mini,
      id: ProjectId.make("project:upstream"),
      repositoryIdentity: identity("github.com/upstream/app"),
    };
    const fork = {
      environmentId: mini,
      id: ProjectId.make("project:fork"),
      repositoryIdentity: identity("github.com/upstream/app", "github.com/me/app"),
    };
    expect(
      findEnvironmentSyncTargetProject({
        sourceProject,
        targetEnvironmentId: mini,
        projects: [upstream, fork],
      }),
    ).toBe(fork);
    expect(
      findEnvironmentSyncTargetProject({
        sourceProject,
        targetEnvironmentId: mini,
        projects: [upstream],
      }),
    ).toBeNull();
  });
});

describe("selectEnvironmentSyncThreadIds", () => {
  const projectId = ProjectId.make("project:app");
  const thread = (id: string, overrides: Record<string, unknown> = {}) => ({
    id: ThreadId.make(id),
    projectId,
    archivedAt: null,
    deletedAt: null,
    settledAt: null,
    settledOverride: null,
    lineage: { parentThreadId: null },
    ...overrides,
  });

  it("carries the thread in view and the ones still in play", () => {
    const selected = selectEnvironmentSyncThreadIds({
      projectId,
      currentThreadId: ThreadId.make("settled-but-open"),
      threads: [
        thread("active"),
        thread("settled-but-open", { settledAt: "2026-10-01T00:00:00.000Z" }),
        thread("settled", { settledOverride: "settled" }),
        thread("reopened", { settledAt: "2026-10-01T00:00:00.000Z", settledOverride: "active" }),
        thread("archived", { archivedAt: "2026-10-01T00:00:00.000Z" }),
        thread("child", { lineage: { parentThreadId: ThreadId.make("active") } }),
        thread("other-project", { projectId: ProjectId.make("project:other") }),
      ],
    });
    expect([...selected].toSorted()).toEqual(["active", "reopened", "settled-but-open"]);
  });
});

describe("runEnvironmentSync", () => {
  const projectId = ProjectId.make("project:app");
  const source = { environmentId: laptop, label: "Laptop" };
  const target = { environmentId: mini, label: "Mini" };
  const payload = Uint8Array.from(
    { length: ENVIRONMENT_SYNC_CHUNK_BYTES * 2 + 1234 },
    (_, index) => index % 251,
  );
  const manifest: EnvironmentSyncManifest = {
    formatVersion: 1,
    exportId: "export-session",
    createdAt: "2026-10-12T10:00:00.000Z",
    source: { ...source, serverVersion: "1.0.0", orchestrationProtocolVersion: 2 },
    project: { projectId, title: "App", workspaceRoot: "/Users/a/app" },
    git: null,
    threads: [],
    parts: [
      { id: "events", kind: "events", sizeBytes: payload.byteLength, sha256: "x" },
      {
        id: "attachment.skip",
        kind: "attachment",
        sizeBytes: 9,
        sha256: "y",
        fileName: "skip.png",
      },
    ],
  };
  const result: EnvironmentSyncImportResult = {
    projectId,
    workspaceRoot: "/Users/b/app",
    projectCreated: true,
    threads: [],
    warnings: [],
    restorePointId: null,
  };
  const prepare = { project: { projectId, title: "App", folderName: "app" }, rootThreadIds: [] };

  /** Two fake environments. Commands record their calls, and fetch moves real bytes. */
  const harness = (options: { readonly rejectUploads?: boolean } = {}) => {
    const calls: Array<string> = [];
    const received = new Uint8Array(payload.byteLength);
    let receivedBytes = 0;
    const statuses: Array<EnvironmentSyncStatusResult> = [
      { phase: "importing", stage: "threads", completed: 1, total: 2 },
      { phase: "done", result },
    ];
    const command = <Result>(name: string, respond: () => Result) => ({
      label: name,
      run: (
        _registry: AtomRegistry.AtomRegistry,
        value: { readonly environmentId: EnvironmentId },
      ) => {
        calls.push(`${name}@${value.environmentId}`);
        return Promise.resolve(AsyncResult.success(respond()));
      },
    });
    const commands: EnvironmentSyncCommands = {
      prepare: command("prepare", () => ({
        transferId: "import-session",
        project: { projectId, workspaceRoot: "/Users/b/app", exists: false },
        gitHaves: [],
        threadHeads: [],
      })),
      export: command("export", () => ({ manifest, downloadPath: "/api/environment-sync/out" })),
      accept: command("accept", () => ({
        neededPartIds: ["events"],
        uploadPath: "/api/environment-sync/in",
        threads: [],
      })),
      commit: command("commit", () => ({ started: true })),
      status: command("status", () => statuses.shift() ?? { phase: "done" as const, result }),
      release: command("release", () => ({ released: true })),
    };
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const parsed = new URL(String(url));
      const offset = Number(parsed.searchParams.get("offset"));
      if (init?.method === "POST") {
        if (options.rejectUploads) return new Response("Chunk out of order.", { status: 409 });
        expect(parsed.origin).toBe("http://mini");
        expect(offset).toBe(receivedBytes);
        const chunk = new Uint8Array(init.body as ArrayBuffer);
        received.set(chunk, offset);
        receivedBytes += chunk.byteLength;
        return new Response(null, { status: 204 });
      }
      expect(parsed.origin).toBe("http://laptop");
      const length = Number(parsed.searchParams.get("length"));
      return new Response(payload.slice(offset, offset + length));
    }) as typeof globalThis.fetch;
    const progress: Array<EnvironmentSyncProgress> = [];
    const run = () =>
      runEnvironmentSync({
        registry: AtomRegistry.make(),
        commands,
        source,
        target,
        sourceProjectId: projectId,
        prepare,
        resolveUrl: (environmentId, relativePath) => `http://${environmentId}${relativePath}`,
        fetch,
        onProgress: (value) => progress.push(value),
        statusPollMs: 0,
      });
    return { calls, received, progress, run };
  };

  it("relays only the parts the target asked for, in order, and waits for the import", async () => {
    const { calls, received, progress, run } = harness();
    const outcome = await run();
    expect(outcome).toMatchObject({ status: "synced", result });
    expect(received.every((byte, index) => byte === payload[index])).toBe(true);
    expect(calls).toEqual([
      "prepare@mini",
      "export@laptop",
      "accept@mini",
      "commit@mini",
      "release@laptop",
      "status@mini",
      "status@mini",
      "release@mini",
    ]);
    expect(progress.at(-1)).toEqual({
      stage: "importing",
      step: "threads",
      completed: 1,
      total: 2,
    });
    expect(progress).toContainEqual({
      stage: "transferring",
      transferredBytes: payload.byteLength,
      totalBytes: payload.byteLength,
    });
  });

  it("releases both sessions when the target refuses a chunk", async () => {
    const { calls, run } = harness({ rejectUploads: true });
    expect(await run()).toEqual({
      status: "failed",
      step: "transfer",
      message: "Mini did not accept the transfer.",
    });
    expect(calls.slice(-2)).toEqual(["release@laptop", "release@mini"]);
    expect(calls).not.toContain("commit@mini");
  });

  it("reports the server's reason when a step fails", async () => {
    const refusing = {
      prepare: {
        label: "prepare",
        run: () =>
          Promise.resolve(
            AsyncResult.failure(Cause.fail(new Error("/srv is not an absolute folder."))),
          ),
      },
    } as unknown as EnvironmentSyncCommands;
    expect(
      await runEnvironmentSync({
        registry: AtomRegistry.make(),
        commands: refusing,
        source,
        target,
        sourceProjectId: projectId,
        prepare,
        resolveUrl: () => null,
      }),
    ).toEqual({ status: "failed", step: "prepare", message: "/srv is not an absolute folder." });
  });
});
