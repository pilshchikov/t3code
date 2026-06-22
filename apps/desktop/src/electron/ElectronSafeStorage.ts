import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Electron from "electron";

const electronSafeStorageErrorFields = {
  cause: Schema.Defect(),
};

export class ElectronSafeStorageAvailabilityError extends Schema.TaggedErrorClass<ElectronSafeStorageAvailabilityError>()(
  "ElectronSafeStorageAvailabilityError",
  {
    ...electronSafeStorageErrorFields,
  },
) {
  override get message(): string {
    return "Electron safe storage failed to check encryption availability.";
  }
}

export class ElectronSafeStorageEncryptError extends Schema.TaggedErrorClass<ElectronSafeStorageEncryptError>()(
  "ElectronSafeStorageEncryptError",
  {
    ...electronSafeStorageErrorFields,
  },
) {
  override get message(): string {
    return "Electron safe storage failed to encrypt a string.";
  }
}

export class ElectronSafeStorageDecryptError extends Schema.TaggedErrorClass<ElectronSafeStorageDecryptError>()(
  "ElectronSafeStorageDecryptError",
  {
    ...electronSafeStorageErrorFields,
  },
) {
  override get message(): string {
    return "Electron safe storage failed to decrypt a string.";
  }
}

export const ElectronSafeStorageError = Schema.Union([
  ElectronSafeStorageAvailabilityError,
  ElectronSafeStorageEncryptError,
  ElectronSafeStorageDecryptError,
]);
export type ElectronSafeStorageError = typeof ElectronSafeStorageError.Type;
export const isElectronSafeStorageError = Schema.is(ElectronSafeStorageError);

export class ElectronSafeStorage extends Context.Service<
  ElectronSafeStorage,
  {
    readonly isEncryptionAvailable: Effect.Effect<boolean, ElectronSafeStorageAvailabilityError>;
    readonly encryptString: (
      value: string,
    ) => Effect.Effect<Uint8Array, ElectronSafeStorageEncryptError>;
    readonly decryptString: (
      value: Uint8Array,
    ) => Effect.Effect<string, ElectronSafeStorageDecryptError>;
  }
>()("@t3tools/desktop/electron/ElectronSafeStorage") {}

// This fork's desktop build is ad-hoc signed (no Apple Developer ID), so macOS re-prompts for the
// Keychain "Safe Storage" key on every launch/reinstall because the app's signature keeps changing.
// To avoid that prompt, OS-keychain secret storage is disabled by default: `isEncryptionAvailable`
// reports false without touching Electron, and every consumer already degrades gracefully (secrets
// for saved remote environments just aren't persisted). Re-enable real Keychain encryption with
// `T3CODE_ENABLE_SAFE_STORAGE_KEYCHAIN=true`.
const keychainSecretStorageEnabled = process.env.T3CODE_ENABLE_SAFE_STORAGE_KEYCHAIN === "true";

export const make = ElectronSafeStorage.of({
  isEncryptionAvailable: keychainSecretStorageEnabled
    ? Effect.try({
        try: () => Electron.safeStorage.isEncryptionAvailable(),
        catch: (cause) => new ElectronSafeStorageAvailabilityError({ cause }),
      })
    : Effect.succeed(false),
  encryptString: (value) =>
    Effect.try({
      try: () => Electron.safeStorage.encryptString(value),
      catch: (cause) => new ElectronSafeStorageEncryptError({ cause }),
    }),
  decryptString: (value) =>
    Effect.try({
      try: () => Electron.safeStorage.decryptString(Buffer.from(value)),
      catch: (cause) => new ElectronSafeStorageDecryptError({ cause }),
    }),
});

export const layer = Layer.succeed(ElectronSafeStorage, make);
