// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeStreamPromises from "node:stream/promises";

import * as Effect from "effect/Effect";

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
