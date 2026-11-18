import { isSharedHostConnectionTarget } from "@t3tools/client-runtime/connection";
import { Atom } from "effect/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { serverEnvironment } from "./server";

export const desktopProjectLayoutAtom = Atom.make((get) => {
  for (const [id, entry] of get(environmentCatalog.catalogValueAtom).entries) {
    if (!entry.enabled || isSharedHostConnectionTarget(entry.target)) continue;
    const layout = get(serverEnvironment.settingsValueAtom(id))?.desktopProjectLayout;
    if (layout) return layout;
  }
  return null;
}).pipe(Atom.withLabel("mobile-desktop-project-layout"));
