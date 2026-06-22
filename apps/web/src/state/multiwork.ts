import { createMultiworkEnvironmentAtoms } from "@t3tools/client-runtime/state/multiwork";

import { connectionAtomRuntime } from "../connection/runtime";

export const multiworkEnvironment = createMultiworkEnvironmentAtoms(connectionAtomRuntime);
