import { ENVIRONMENT_SYNC_CHUNK_BYTES, ENVIRONMENT_SYNC_ROUTE_PREFIX } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as EnvironmentSync from "./EnvironmentSync.ts";

const NO_STORE = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };

/** `<prefix>/<sessionId>/<partId>?offset=&length=`. The session id is the credential. */
const parseTarget = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = HttpServerRequest.toURL(request);
  if (Option.isNone(url)) return null;
  const [sessionId, partId, extra] = url.value.pathname
    .slice(`${ENVIRONMENT_SYNC_ROUTE_PREFIX}/`.length)
    .split("/");
  const offset = Number(url.value.searchParams.get("offset") ?? "0");
  const length = Number(
    url.value.searchParams.get("length") ?? String(ENVIRONMENT_SYNC_CHUNK_BYTES),
  );
  if (
    !sessionId ||
    !partId ||
    extra !== undefined ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(length) ||
    length < 0
  ) {
    return null;
  }
  return { request, sessionId, partId: decodeURIComponent(partId), offset, length };
});

const layerReadRoute = HttpRouter.add(
  "GET",
  `${ENVIRONMENT_SYNC_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const target = yield* parseTarget;
    if (target === null) return HttpServerResponse.text("Not Found", { status: 404 });
    const sync = yield* EnvironmentSync.EnvironmentSync;
    const bytes = yield* sync.readPart(target).pipe(Effect.orElseSucceed(() => null));
    return bytes === null
      ? HttpServerResponse.text("Not Found", { status: 404 })
      : HttpServerResponse.uint8Array(bytes, {
          contentType: "application/octet-stream",
          headers: NO_STORE,
        });
  }),
);

const layerWriteRoute = HttpRouter.add(
  "POST",
  `${ENVIRONMENT_SYNC_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const target = yield* parseTarget;
    if (target === null) return HttpServerResponse.text("Not Found", { status: 404 });
    const sync = yield* EnvironmentSync.EnvironmentSync;
    const chunks: Array<Uint8Array> = [];
    let received = 0;
    yield* Stream.runForEach(
      target.request.stream.pipe(Stream.takeWhile(() => received <= ENVIRONMENT_SYNC_CHUNK_BYTES)),
      (chunk) =>
        Effect.sync(() => {
          received += chunk.byteLength;
          chunks.push(chunk);
        }),
    );
    if (received > ENVIRONMENT_SYNC_CHUNK_BYTES) {
      return HttpServerResponse.text("Chunk too large.", { status: 413 });
    }
    const chunk = new Uint8Array(received);
    let position = 0;
    for (const piece of chunks) {
      chunk.set(piece, position);
      position += piece.byteLength;
    }
    const stored = yield* sync
      .writePart({ ...target, chunk })
      .pipe(Effect.orElseSucceed(() => "failed" as const));
    switch (stored) {
      case "stored":
        return HttpServerResponse.empty({ status: 204, headers: NO_STORE });
      case "not_found":
        return HttpServerResponse.text("Not Found", { status: 404 });
      case "out_of_order":
        return HttpServerResponse.text("Chunk out of order.", { status: 409 });
      case "failed":
        return HttpServerResponse.text("Could not store the chunk.", { status: 500 });
    }
  }).pipe(Effect.orElseSucceed(() => HttpServerResponse.text("Bad Request", { status: 400 }))),
);

export const layerRoutes = Layer.mergeAll(layerReadRoute, layerWriteRoute);
