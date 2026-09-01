import {
  EnvironmentId,
  type ProjectListEntriesResult,
  type ProjectReadFileResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const projectMocks = vi.hoisted(() => ({
  listEntries: vi.fn(),
  optimisticFile: vi.fn(),
  readFile: vi.fn(),
  watchEntries: vi.fn(),
  watchFile: vi.fn(),
}));

const atomHooks = vi.hoisted(() => ({
  registry: null as {
    get(atom: object): unknown;
    refresh(atom: object): void;
  } | null,
}));

const reactHooks = vi.hoisted(() => {
  let cursor = 0;
  let refs: Array<{ current: unknown }> = [];
  let states: unknown[] = [];
  const nextIndex = () => cursor++;

  return {
    beginRender() {
      cursor = 0;
    },
    reset() {
      cursor = 0;
      refs = [];
      states = [];
    },
    useCallback<A>(callback: A): A {
      nextIndex();
      return callback;
    },
    useEffect(effect: () => void): void {
      nextIndex();
      effect();
    },
    useRef<A>(initialValue: A): { current: A } {
      const index = nextIndex();
      refs[index] ??= { current: initialValue };
      return refs[index] as { current: A };
    },
    useState<A>(initialValue: A): [A, (next: A | ((current: A) => A)) => void] {
      const index = nextIndex();
      if (!(index in states)) states[index] = initialValue;
      return [
        states[index] as A,
        (next) => {
          const current = states[index] as A;
          states[index] = typeof next === "function" ? (next as (value: A) => A)(current) : next;
        },
      ];
    },
  };
});

vi.mock("@effect/atom-react", () => ({
  useAtomRefresh: (atom: object) => () => {
    atomHooks.registry?.refresh(atom);
  },
  useAtomValue: (atom: object) => atomHooks.registry?.get(atom),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: reactHooks.useCallback,
    useEffect: reactHooks.useEffect,
    useRef: reactHooks.useRef,
    useState: reactHooks.useState,
  };
});

vi.mock("~/state/projects", () => ({
  projectEnvironment: projectMocks,
}));

vi.mock("~/state/queries", () => ({
  useProjectPathSearch: vi.fn(),
}));

import { useWorkspaceMutationRefresh } from "~/hooks/useWorkspaceMutationRefresh";
import { appAtomRegistry, resetAppAtomRegistryForTests } from "~/rpc/atomRegistry";
import { useProjectEntriesQuery, useProjectFileQuery } from "./projectFilesQueryState";

const environmentId = EnvironmentId.make("environment-1");

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function file(contents: string): ProjectReadFileResult {
  return {
    relativePath: "src/preview.ts",
    contents,
    byteLength: contents.length,
    truncated: false,
  };
}

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("project file query refresh", () => {
  beforeEach(() => {
    projectMocks.listEntries.mockReset();
    projectMocks.optimisticFile.mockReset();
    projectMocks.readFile.mockReset();
    projectMocks.watchEntries.mockReset();
    projectMocks.watchFile.mockReset();
    reactHooks.reset();
  });

  it("refreshes the workspace listing when its filesystem watcher advances", async () => {
    let reads = 0;
    const result: ProjectListEntriesResult = {
      entries: [],
      truncated: false,
    };
    const entriesAtom = Atom.make(
      Effect.sync(() => {
        reads += 1;
        return result;
      }),
    ).pipe(Atom.swr({ staleTime: 30_000, revalidateOnMount: true }));
    const watchAtom = Atom.make(AsyncResult.success({ revision: 0 }));
    const registry = appAtomRegistry;
    const unmountEntries = registry.mount(entriesAtom);
    const unmountWatch = registry.mount(watchAtom);
    projectMocks.listEntries.mockReturnValue(entriesAtom);
    projectMocks.watchEntries.mockReturnValue(watchAtom);
    atomHooks.registry = registry;

    const render = () => {
      reactHooks.beginRender();
      useProjectEntriesQuery(environmentId, "/repo");
    };

    try {
      render();
      await flushEffects();
      const readsBeforeChange = reads;

      registry.set(watchAtom, AsyncResult.success({ revision: 1 }));
      render();
      await flushEffects();

      expect(reads).toBeGreaterThan(readsBeforeChange);
    } finally {
      unmountWatch();
      unmountEntries();
      atomHooks.registry = null;
      resetAppAtomRegistryForTests();
    }
  });

  it("replaces an in-flight initial read when a workspace mutation arrives", async () => {
    const requests: Array<ReturnType<typeof deferred<ProjectReadFileResult>>> = [];
    const readAtom = Atom.make(
      Effect.promise(() => {
        const request = deferred<ProjectReadFileResult>();
        requests.push(request);
        return request.promise;
      }),
    ).pipe(Atom.swr({ staleTime: 30_000, revalidateOnMount: true }));
    const registry = AtomRegistry.make();
    const unmount = registry.mount(readAtom);
    projectMocks.readFile.mockReturnValue(readAtom);
    projectMocks.optimisticFile.mockReturnValue(Atom.make(null));
    atomHooks.registry = registry;
    let renderedContents: string | null = null;

    const render = (mutationId: string | null) => {
      reactHooks.beginRender();
      const query = useProjectFileQuery(environmentId, "/repo", "src/preview.ts");
      renderedContents = query.data?.contents ?? null;
      useWorkspaceMutationRefresh({
        mutationId,
        refresh: query.refresh,
        resourceKey: "file:environment-1:/repo:src/preview.ts",
      });
    };

    try {
      render(null);
      await flushEffects();
      expect(requests).toHaveLength(1);

      render("mutation-1");
      await flushEffects();
      expect(requests).toHaveLength(2);

      requests[1]!.resolve(file("fresh"));
      await flushEffects();
      render("mutation-1");
      expect(renderedContents).toBe("fresh");

      requests[0]!.resolve(file("stale"));
      await flushEffects();
      render("mutation-1");
      expect(renderedContents).toBe("fresh");
    } finally {
      unmount();
      registry.dispose();
      atomHooks.registry = null;
    }
  });

  it("discards optimistic file contents before reopening from disk", async () => {
    const readAtom = Atom.make(Effect.succeed(file("fresh from disk")));
    const optimisticAtom = Atom.make({
      data: file("old editor snapshot"),
      confirmedAgainst: undefined,
    });
    const watchAtom = Atom.make(
      AsyncResult.success({ relativePath: "src/preview.ts", revision: 0 }),
    );
    const registry = appAtomRegistry;
    const unmountRead = registry.mount(readAtom);
    const unmountOptimistic = registry.mount(optimisticAtom);
    const unmountWatch = registry.mount(watchAtom);
    projectMocks.readFile.mockReturnValue(readAtom);
    projectMocks.optimisticFile.mockReturnValue(optimisticAtom);
    projectMocks.watchFile.mockReturnValue(watchAtom);
    atomHooks.registry = registry;
    let renderedContents: string | null = null;

    const render = () => {
      reactHooks.beginRender();
      const query = useProjectFileQuery(
        environmentId,
        "/repo",
        "src/preview.ts",
        true,
        true,
        false,
      );
      renderedContents = query.data?.contents ?? null;
    };

    try {
      render();
      await flushEffects();
      render();

      expect(registry.get(optimisticAtom)).toBeNull();
      expect(renderedContents).toBe("fresh from disk");
    } finally {
      unmountWatch();
      unmountOptimistic();
      unmountRead();
      atomHooks.registry = null;
      resetAppAtomRegistryForTests();
    }
  });

  it("does not issue a file read for a disabled image preview", async () => {
    const requests: Array<ReturnType<typeof deferred<ProjectReadFileResult>>> = [];
    const readAtom = Atom.make(
      Effect.promise(() => {
        const request = deferred<ProjectReadFileResult>();
        requests.push(request);
        return request.promise;
      }),
    );
    const registry = AtomRegistry.make();
    projectMocks.readFile.mockReturnValue(readAtom);
    projectMocks.optimisticFile.mockReturnValue(Atom.make(null));
    atomHooks.registry = registry;

    try {
      reactHooks.beginRender();
      const query = useProjectFileQuery(environmentId, "/repo", "preview.png", false);
      useWorkspaceMutationRefresh({
        enabled: false,
        mutationId: "mutation-1",
        refresh: query.refresh,
        resourceKey: "file:environment-1:/repo:preview.png",
      });
      await flushEffects();

      expect(projectMocks.readFile).not.toHaveBeenCalled();
      expect(requests).toHaveLength(0);
    } finally {
      registry.dispose();
      atomHooks.registry = null;
    }
  });
});
