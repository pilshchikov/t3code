import {
  EnvironmentId,
  type ProjectListEntriesResult,
  ProjectReadFileError,
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
  let effects: Array<{ deps?: readonly unknown[]; cleanup?: () => void }> = [];
  let callbacks: Array<{ deps?: readonly unknown[]; value: unknown }> = [];
  const same = (a?: readonly unknown[], b?: readonly unknown[]) =>
    a !== undefined &&
    b !== undefined &&
    a.length === b.length &&
    a.every((v, i) => Object.is(v, b[i]));
  const nextIndex = () => cursor++;

  return {
    beginRender() {
      cursor = 0;
    },
    reset() {
      effects.forEach((effect) => effect?.cleanup?.());
      effects = [];
      callbacks = [];
      cursor = 0;
      refs = [];
      states = [];
    },
    useCallback<A>(callback: A, deps?: readonly unknown[]): A {
      const index = nextIndex();
      if (!same(callbacks[index]?.deps, deps)) callbacks[index] = { deps, value: callback };
      return callbacks[index]!.value as A;
    },
    useMemo<A>(factory: () => A, deps?: readonly unknown[]): A {
      const index = nextIndex();
      if (!same(callbacks[index]?.deps, deps)) callbacks[index] = { deps, value: factory() };
      return callbacks[index]!.value as A;
    },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void {
      const index = nextIndex();
      if (same(effects[index]?.deps, deps)) return;
      effects[index]?.cleanup?.();
      effects[index] = { deps, cleanup: effect() || undefined };
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
    useMemo: reactHooks.useMemo,
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

function projectEntries(paths: readonly string[]): ProjectListEntriesResult {
  return {
    entries: paths.map((path) => ({ path, kind: "file" })),
    truncated: false,
  };
}

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("project query refresh", () => {
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

  it("keeps cached contents while checking and only rereads a changed revision", async () => {
    const requests: Array<ReturnType<typeof deferred<ProjectReadFileResult>>> = [];
    let reads = 0;
    const readAtom = Atom.make(
      Effect.sync(() => {
        reads++;
        return { ...file(reads === 1 ? "cached" : "fresh"), revision: String(reads) };
      }),
    );
    const metadataAtom = Atom.make(
      Effect.promise(() => {
        const request = deferred<ProjectReadFileResult>();
        requests.push(request);
        return request.promise;
      }),
    );
    const registry = appAtomRegistry;
    const unmount = registry.mount(readAtom);
    projectMocks.readFile.mockImplementation(({ input }) =>
      input.metadataOnly ? metadataAtom : readAtom,
    );
    projectMocks.optimisticFile.mockReturnValue(Atom.make(null));
    atomHooks.registry = registry;
    let renderedContents: string | null = null;
    let unmountMetadata = () => {};

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
      render("mutation-1");
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      unmountMetadata = registry.mount(metadataAtom);
      expect(renderedContents).toBe("cached");
      requests.at(-1)!.resolve({ ...file(""), revision: "1", metadataOnly: true });
      await vi.waitFor(() => expect(registry.get(metadataAtom).waiting).toBe(false));
      await flushEffects();
      expect(reads).toBe(1);
      render("mutation-1");
      expect(renderedContents).toBe("cached");
      render("mutation-2");
      await vi.waitFor(() => expect(requests).toHaveLength(2));
      requests.at(-1)!.resolve({ ...file(""), revision: "2", metadataOnly: true });
      await vi.waitFor(() => expect(reads).toBe(2));
      render("mutation-2");
      expect(renderedContents).toBe("fresh");
    } finally {
      reactHooks.reset();
      unmountMetadata();
      unmount();
      atomHooks.registry = null;
      resetAppAtomRegistryForTests();
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
      await vi.waitFor(() => expect(registry.get(optimisticAtom)).toBeNull());
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

  it("revalidates on activation without replacing an unchanged cached object", async () => {
    const snapshot = { ...file("# cached"), revision: "disk-1" };
    let reads = 0;
    let checks = 0;
    const readAtom = Atom.make(
      Effect.sync(() => {
        reads++;
        return snapshot;
      }),
    );
    const metadataAtom = Atom.make(
      Effect.sync(() => {
        checks++;
        return { ...snapshot, contents: "", metadataOnly: true };
      }),
    );
    const watchAtom = Atom.make(
      AsyncResult.success({ relativePath: "src/preview.ts", revision: 0 }),
    );
    const optimisticAtom = Atom.make(null);
    const registry = appAtomRegistry;
    const release = [readAtom, watchAtom, optimisticAtom].map((atom) => registry.mount(atom));
    projectMocks.readFile.mockImplementation(({ input }) =>
      input.metadataOnly ? metadataAtom : readAtom,
    );
    projectMocks.optimisticFile.mockReturnValue(optimisticAtom);
    projectMocks.watchFile.mockReturnValue(watchAtom);
    atomHooks.registry = registry;
    const render = (active: boolean) => {
      reactHooks.beginRender();
      return useProjectFileQuery(
        environmentId,
        "/repo",
        "src/preview.ts",
        true,
        true,
        false,
        active,
      );
    };
    try {
      expect(render(true).data).toBe(snapshot);
      await vi.waitFor(() => expect(checks).toBeGreaterThan(0));
      const checksBeforeHiding = checks;
      expect(render(false).data).toBe(snapshot);
      await flushEffects();
      expect(checks).toBe(checksBeforeHiding);
      expect(render(true).data).toBe(snapshot);
      await vi.waitFor(() => expect(checks).toBeGreaterThan(checksBeforeHiding));
      expect(reads).toBe(1);
    } finally {
      reactHooks.reset();
      release.forEach((unmount) => unmount());
      atomHooks.registry = null;
      resetAppAtomRegistryForTests();
    }
  });

  it("ignores an outstanding disk check when the editor becomes dirty", async () => {
    let reads = 0;
    const request = deferred<ProjectReadFileResult>();
    const readAtom = Atom.make(
      Effect.sync(() => {
        reads++;
        return { ...file("disk"), revision: "1" };
      }),
    );
    const metadataAtom = Atom.make(Effect.promise(() => request.promise));
    const watchAtom = Atom.make(
      AsyncResult.success({ relativePath: "src/preview.ts", revision: 0 }),
    );
    const optimisticAtom = Atom.make({ data: file("local edit"), confirmedAgainst: undefined });
    const registry = appAtomRegistry;
    const release = [readAtom, watchAtom, optimisticAtom].map((atom) => registry.mount(atom));
    projectMocks.readFile.mockImplementation(({ input }) =>
      input.metadataOnly ? metadataAtom : readAtom,
    );
    projectMocks.optimisticFile.mockReturnValue(optimisticAtom);
    projectMocks.watchFile.mockReturnValue(watchAtom);
    atomHooks.registry = registry;
    const render = (dirty: boolean) => {
      reactHooks.beginRender();
      return useProjectFileQuery(environmentId, "/repo", "src/preview.ts", true, true, dirty);
    };
    try {
      render(false);
      await flushEffects();
      render(true);
      request.resolve({ ...file(""), revision: "2", metadataOnly: true });
      await flushEffects();
      expect(render(true).data?.contents).toBe("local edit");
      expect(reads).toBe(1);
    } finally {
      reactHooks.reset();
      release.forEach((unmount) => unmount());
      atomHooks.registry = null;
      resetAppAtomRegistryForTests();
    }
  });

  it("revalidates cached entries when a workspace mutation is observed after mounting", async () => {
    const requests: Array<ReturnType<typeof deferred<ProjectListEntriesResult>>> = [];
    const entriesAtom = Atom.make(
      Effect.promise(() => {
        const request = deferred<ProjectListEntriesResult>();
        requests.push(request);
        return request.promise;
      }),
    ).pipe(Atom.swr({ staleTime: 30_000, revalidateOnMount: true }));
    const registry = appAtomRegistry;
    const unmount = registry.mount(entriesAtom);
    const watchAtom = Atom.make(AsyncResult.success({ revision: 0 }));
    const unmountWatch = registry.mount(watchAtom);
    projectMocks.listEntries.mockReturnValue(entriesAtom);
    projectMocks.watchEntries.mockReturnValue(watchAtom);
    atomHooks.registry = registry;
    let renderedPaths: readonly string[] = [];

    const render = (mutationId: string | null) => {
      reactHooks.beginRender();
      const query = useProjectEntriesQuery(environmentId, "/repo");
      renderedPaths = query.data?.entries.map((entry) => entry.path) ?? [];
      useWorkspaceMutationRefresh({
        mutationId,
        refresh: query.refresh,
        resourceKey: "files:environment-1:/repo",
      });
    };

    try {
      await flushEffects();
      expect(requests).toHaveLength(1);
      requests[0]!.resolve(projectEntries(["src/old.ts"]));
      await flushEffects();

      render("mutation-1");
      // Opening is stale-while-revalidate: show cached rows without a loading flash.
      expect(renderedPaths).toEqual(["src/old.ts"]);
      await flushEffects();
      expect(requests).toHaveLength(2);

      requests[1]!.resolve(projectEntries(["src/new.ts"]));
      await flushEffects();
      await flushEffects();
      render("mutation-1");
      expect(renderedPaths).toEqual(["src/new.ts"]);
      expect(requests).toHaveLength(2);
    } finally {
      unmountWatch();
      unmount();
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

  it("reports a directory named like an image as not a file", async () => {
    const readAtom = Atom.make(
      Effect.fail(
        new ProjectReadFileError({
          cwd: "/repo",
          relativePath: "assets.png",
          failure: "path_not_file",
        }),
      ),
    );
    const registry = AtomRegistry.make();
    const unmount = registry.mount(readAtom);
    projectMocks.readFile.mockReturnValue(readAtom);
    projectMocks.optimisticFile.mockReturnValue(Atom.make(null));
    atomHooks.registry = registry;

    try {
      await flushEffects();
      reactHooks.beginRender();
      const query = useProjectFileQuery(environmentId, "/repo", "assets.png");
      expect(query.isNotFile).toBe(true);
      expect(query.data).toBeNull();
    } finally {
      unmount();
      registry.dispose();
      atomHooks.registry = null;
    }
  });

  it("reports a directory read as not a file", async () => {
    const readAtom = Atom.make(
      Effect.fail(
        new ProjectReadFileError({
          cwd: "/repo",
          relativePath: ".agents/skills",
          failure: "path_not_file",
        }),
      ),
    );
    const registry = AtomRegistry.make();
    const unmount = registry.mount(readAtom);
    projectMocks.readFile.mockReturnValue(readAtom);
    projectMocks.optimisticFile.mockReturnValue(Atom.make(null));
    atomHooks.registry = registry;

    try {
      await flushEffects();
      reactHooks.beginRender();
      const query = useProjectFileQuery(environmentId, "/repo", ".agents/skills");
      expect(query.isNotFile).toBe(true);
      expect(query.data).toBeNull();
    } finally {
      unmount();
      registry.dispose();
      atomHooks.registry = null;
    }
  });
});
