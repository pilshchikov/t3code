import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../hooks/useLocalStorage";

const PROJECT_RAIL_VISIBLE_KEY = "t3code:sidebar:project-rail-visible";

export function useProjectRailVisible() {
  return useLocalStorage(PROJECT_RAIL_VISIBLE_KEY, true, Schema.Boolean);
}
