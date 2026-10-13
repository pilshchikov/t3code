import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";

/** Check publication only during a user-requested update; mounting the sidebar makes no request. */
export function isNpmReleasePublished(version: string): Promise<boolean> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* HttpClient.get(
        `https://registry.npmjs.org/t3/${encodeURIComponent(version)}`,
      );
      if (response.status === 404) return false;
      const body = yield* HttpClientResponse.filterStatusOk(response).pipe(
        Effect.flatMap((ok) => ok.json),
      );
      return typeof body === "object" && body !== null && "version" in body
        ? body.version === version
        : false;
    }).pipe(
      // Tracing headers would make the browser send a CORS preflight, which npm rejects.
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
    ),
  );
}
