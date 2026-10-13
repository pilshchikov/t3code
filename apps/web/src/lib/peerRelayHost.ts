import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { request, subscribe } from "@t3tools/client-runtime/rpc";
import {
  type EnvironmentId,
  PeerFilesError,
  type PeerRelayOperation,
  type PeerRelayReply,
  type ProjectId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

const isPeerFilesError = Schema.is(PeerFilesError);

const unreachable = (message: string): PeerRelayReply => ({
  type: "failed",
  code: "peer_unreachable",
  message,
});

/**
 * Environments never connect to each other, so this app relays for them: an agent's request to
 * look at or copy files on another environment arrives here from its own server, and this app
 * runs it against the other one. See `packages/contracts/src/peers.ts`.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
    const relays = yield* FiberMap.make<EnvironmentId>();

    const describe = Effect.fn("web.peerRelay.describe")(function* (
      source: EnvironmentId,
      projectId: ProjectId | null,
    ) {
      const entries = yield* SubscriptionRef.get(registry.entries);
      // Loaded on demand: the project state imports the connection runtime this layer is part of.
      const { peerProjects } = yield* Effect.promise(() => import("../peerProjects"));
      const peers = yield* Effect.forEach(
        Array.from(entries.values()).filter((entry) => entry.target.environmentId !== source),
        ({ target }) =>
          registry.state(target.environmentId).pipe(
            Effect.map((state) => state.phase === "connected"),
            Effect.orElseSucceed(() => false),
            Effect.map((connected) => ({
              environmentId: target.environmentId,
              label: target.label,
              connected,
              projects: peerProjects(target.environmentId, { environmentId: source, projectId }),
            })),
          ),
      );
      return { type: "described", peers } satisfies PeerRelayReply;
    });

    const onPeer = <A, E extends { readonly _tag: string }, R>(
      source: EnvironmentId,
      target: EnvironmentId,
      call: Effect.Effect<A, E, R>,
      reply: (result: A) => PeerRelayReply,
    ) =>
      target === source
        ? Effect.succeed(unreachable("That is this environment itself. Work on its files here."))
        : registry.run(target, call).pipe(
            Effect.map(reply),
            Effect.catch((error) =>
              Effect.succeed(
                isPeerFilesError(error)
                  ? ({ type: "failed", code: error.code, message: error.message } as const)
                  : unreachable(`The app could not reach that environment (${error._tag}).`),
              ),
            ),
          );

    const perform = (source: EnvironmentId, operation: PeerRelayOperation) => {
      switch (operation.type) {
        case "describe":
          return describe(source, operation.projectId);
        case "list":
          return onPeer(
            source,
            operation.environmentId,
            request(WS_METHODS.peerFilesList, operation.input),
            (result) => ({ type: "listed", result }),
          );
        case "read":
          return onPeer(
            source,
            operation.environmentId,
            request(WS_METHODS.peerFilesRead, operation.input),
            (result) => ({ type: "read", result }),
          );
        case "write":
          return onPeer(
            source,
            operation.environmentId,
            request(WS_METHODS.peerFilesWrite, operation.input),
            (result) => ({ type: "written", result }),
          );
      }
    };

    // A server without the relay RPC fails the subscription; ask again later in case it updates.
    const serve = (source: EnvironmentId) =>
      registry.followStream(source, subscribe(WS_METHODS.peerRelayConnect, {})).pipe(
        Stream.mapEffect(
          ({ requestId, operation }) =>
            perform(source, operation).pipe(
              Effect.flatMap((reply) =>
                registry.run(source, request(WS_METHODS.peerRelayRespond, { requestId, reply })),
              ),
              Effect.catchCause(() => Effect.void),
            ),
          { concurrency: 4, unordered: true },
        ),
        Stream.runDrain,
        Effect.catchCause(() => Effect.void),
        Effect.andThen(Effect.sleep("60 seconds")),
        Effect.forever,
      );

    yield* SubscriptionRef.changes(registry.entries).pipe(
      Stream.runForEach((entries) =>
        Effect.forEach(
          entries.keys(),
          (environmentId) =>
            FiberMap.run(relays, environmentId, serve(environmentId), { onlyIfMissing: true }),
          { discard: true },
        ),
      ),
      Effect.forkScoped,
    );
  }),
);
