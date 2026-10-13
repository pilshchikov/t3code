import { createEnvironmentSyncAtoms } from "@t3tools/client-runtime/state/environment-sync";

import { connectionAtomRuntime } from "../connection/runtime";

export const environmentSyncEnvironment = createEnvironmentSyncAtoms(connectionAtomRuntime);
