// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeReadline from "node:readline";
import * as NodeStreamPromises from "node:stream/promises";
import * as NodeZlib from "node:zlib";

import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

/** Appends lines to a gzip file. Close the scope to finish the file. */
export const openGzipLineWriter = (filePath: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const gzip = NodeZlib.createGzip();
      const file = NodeFS.createWriteStream(filePath);
      const finished = NodeStreamPromises.pipeline(gzip, file);
      // The failure is reported when the writer closes.
      finished.catch(() => undefined);
      return { gzip, finished };
    }),
    ({ gzip, finished }) =>
      Effect.promise(async () => {
        gzip.end();
        await finished.catch(() => undefined);
      }),
  ).pipe(
    Effect.map(({ gzip, finished }) => ({
      write: (line: string) =>
        Effect.tryPromise(async () => {
          if (!gzip.write(`${line}\n`)) {
            await new Promise((resolve) => gzip.once("drain", resolve));
          }
        }),
      /** Flushes and reports any write failure. */
      finish: Effect.tryPromise(async () => {
        gzip.end();
        await finished;
      }),
    })),
  );

/** Lines of a gzip file, read without loading the file into memory. */
export const readGzipLines = (filePath: string): Stream.Stream<string, Error> =>
  Stream.suspend(() => {
    const source = NodeFS.createReadStream(filePath);
    const gunzip = NodeZlib.createGunzip();
    let failure: Error | undefined;
    const fail = (cause: Error) => {
      failure ??= cause;
      gunzip.destroy();
    };
    source.on("error", fail);
    gunzip.on("error", (cause) => {
      failure ??= cause;
    });
    const lines = NodeReadline.createInterface({
      input: source.pipe(gunzip),
      crlfDelay: Infinity,
    });
    return Stream.fromAsyncIterable(lines, (cause) =>
      cause instanceof Error ? cause : new Error("Could not read the events file."),
    ).pipe(
      Stream.concat(
        Stream.suspend(() => (failure === undefined ? Stream.empty : Stream.fail(failure))),
      ),
      Stream.ensuring(
        Effect.sync(() => {
          lines.close();
          source.destroy();
          gunzip.destroy();
        }),
      ),
    );
  });

export const sha256File = (filePath: string) =>
  Effect.tryPromise(async () => {
    const hash = NodeCrypto.createHash("sha256");
    await NodeStreamPromises.pipeline(NodeFS.createReadStream(filePath), hash);
    return hash.digest("hex");
  });

/** Reads one bounded slice of a file. */
export const readFileSlice = (filePath: string, offset: number, length: number) =>
  Effect.tryPromise(async () => {
    const handle = await NodeFSP.open(filePath, "r");
    try {
      const buffer = new Uint8Array(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  });

export const appendFileChunk = (filePath: string, chunk: Uint8Array) =>
  Effect.tryPromise(() => NodeFSP.appendFile(filePath, chunk));
