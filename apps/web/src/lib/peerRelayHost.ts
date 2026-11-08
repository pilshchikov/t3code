import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { request, subscribe } from "@t3tools/client-runtime/rpc";
import { readPeerEnvironment } from "./peerEnvironment";
import { readPeerUsageLimits } from "./peerUsageLimits";
import {
  type EnvironmentId,
  PeerFilesError,
  OrchestratorMcpFailure,
  type PeerRelayOperation,
  type PeerRelayReply,
  type ProjectId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Semaphore from "effect/Semaphore";

const isPeerFilesError = Schema.is(PeerFilesError);
const isThreadError = Schema.is(OrchestratorMcpFailure);

const unreachable = (message: string): PeerRelayReply => ({
  type: "failed",
  code: "peer_unreachable",
  message,
});

/**
 * Environments never connect to each other, so this app relays file and conversation requests
 * from the agent's server through the user's existing connection to the destination. See `packages/contracts/src/peers.ts`.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
    const relays = yield* FiberMap.make<EnvironmentId>();
    const fileSlots = yield* Semaphore.make(4);
    const waitSlots = yield* Semaphore.make(16);

    // Waiting for a permit inside the request worker would itself consume relay capacity.
    const withWaitSlot = <E, R>(call: Effect.Effect<PeerRelayReply, E, R>) =>
      waitSlots
        .withPermitsIfAvailable(1)(call)
        .pipe(
          Effect.map(
            Option.getOrElse((): PeerRelayReply => ({
              type: "failed",
              code: "orchestration_error",
              message:
                "The app relay has too many active waits. Followers retry automatically; cancellation and file transfers remain available.",
            })),
          ),
        );

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
                isPeerFilesError(error) || isThreadError(error)
                  ? ({ type: "failed", code: error.code, message: error.message } as const)
                  : unreachable(`The app could not reach that environment (${error._tag}).`),
              ),
            ),
          );

    const perform = (source: EnvironmentId, operation: PeerRelayOperation) => {
      switch (operation.type) {
        case "orchestration-call": {
          if (operation.input.sourceEnvironmentId !== source)
            return Effect.succeed<PeerRelayReply>({
              type: "failed",
              code: "invalid_request",
              message: "The relay source does not match its connected environment.",
            });
          const call = onPeer(
            source,
            operation.input.environmentId,
            Effect.promise(() => import("../rpc/peerOrchestration")).pipe(
              Effect.flatMap((rpc) => rpc.perform(operation.input.environmentId, operation.input)),
            ),
            (result) => ({ type: "orchestration-result", result }),
          );
          return operation.input.tool === "t3_thread_wait" ? withWaitSlot(call) : call;
        }
        case "environment-read":
          return onPeer(
            source,
            operation.environmentId,
            readPeerEnvironment(operation.input),
            (result) => ({ type: "environment-read", result }),
          );
        case "usage-limits":
          return onPeer(
            source,
            operation.environmentId,
            readPeerUsageLimits(operation.refresh),
            (result) => ({ type: "usage-limits", ...result }),
          );
        case "describe":
          return describe(source, operation.projectId);
        case "threads-list":
        case "thread-read":
        case "thread-send":
        case "thread-queue":
        case "thread-wait": {
          const call = Effect.promise(() => import("../rpc/peerThreads")).pipe(
            Effect.flatMap((rpc) => rpc.perform(operation.environmentId, operation)),
            Effect.catch((error) =>
              Effect.succeed<PeerRelayReply>(
                isThreadError(error)
                  ? { type: "failed", code: error.code, message: error.message }
                  : unreachable(
                      "The destination app/server could not accept the thread request. Connect both environments with matching versions.",
                    ),
              ),
            ),
          );
          return operation.type === "thread-wait" ? withWaitSlot(call) : call;
        }
        case "list":
          return fileSlots.withPermits(1)(
            onPeer(
              source,
              operation.environmentId,
              request(WS_METHODS.peerFilesList, operation.input),
              (result) => ({ type: "listed", result }),
            ),
          );
        case "read":
          return fileSlots.withPermits(1)(
            onPeer(
              source,
              operation.environmentId,
              request(WS_METHODS.peerFilesRead, operation.input),
              (result) => ({ type: "read", result }),
            ),
          );
        case "write":
          return fileSlots.withPermits(1)(
            onPeer(
              source,
              operation.environmentId,
              request(WS_METHODS.peerFilesWrite, operation.input),
              (result) => ({ type: "written", result }),
            ),
          );
        case "pack":
          return fileSlots.withPermits(1)(
            onPeer(
              source,
              operation.environmentId,
              request(WS_METHODS.peerFilesPack, operation.input),
              (result) => ({ type: "packed", result }),
            ),
          );
        case "unpack":
          return fileSlots.withPermits(1)(
            onPeer(
              source,
              operation.environmentId,
              request(WS_METHODS.peerFilesUnpack, operation.input),
              (result) => ({ type: "unpacked", result }),
            ),
          );
        case "pack-remove":
          return fileSlots.withPermits(1)(
            onPeer(
              source,
              operation.environmentId,
              request(WS_METHODS.peerFilesRemovePack, operation.input),
              () => ({ type: "pack-removed" }),
            ),
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
              Effect.ignoreCause,
            ),
          { concurrency: 32, unordered: true },
        ),
        Stream.runDrain,
        Effect.ignoreCause,
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
