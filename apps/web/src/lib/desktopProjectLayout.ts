import {
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  sessionGrantsScope,
} from "@t3tools/contracts";
import { DesktopProjectLayout, DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { selectProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";

import { useProjectRailGroupsStore } from "../components/sidebar/projectRailGroupsStore";
import { environmentCatalog } from "../connection/catalog";
import {
  getClientSettings,
  isClientSettingsHydrated,
  subscribeClientSettings,
  subscribeClientSettingsHydration,
} from "../hooks/useSettings";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { themeEnvironmentIdAtom } from "../state/primaryEnvironment";
import { serverEnvironment } from "../state/server";
import { environmentSession } from "../state/session";
import { useUiStateStore } from "../uiStateStore";

const sameLayout = Schema.toEquivalence(DesktopProjectLayout);
const targetAtom = Atom.make((get) => {
  const environmentId = get(themeEnvironmentIdAtom);
  if (environmentId === null) return null;
  const connection = AsyncResult.getOrElse(
    get(environmentCatalog.stateAtom(environmentId)),
    () => null,
  );
  const config = get(serverEnvironment.configValueAtom(environmentId));
  const session = AsyncResult.getOrElse(
    get(environmentSession.sessionStateAtom(environmentId)),
    () => null,
  );
  if (
    connection?.phase !== "connected" ||
    config?.environment.capabilities.desktopProjectLayout !== true ||
    !config.settings ||
    session === null ||
    !sessionGrantsScope(session, AuthSettingsWriteScope) ||
    !sessionGrantsScope(session, AuthOrchestrationReadScope)
  ) {
    return null;
  }
  return { environmentId, saved: config.settings.desktopProjectLayout };
}).pipe(Atom.withLabel("desktop-project-layout-target"));

export function startDesktopProjectLayoutPublication(): void {
  if (typeof window === "undefined" || !window.desktopBridge) return;
  let queued = false;
  let publishing = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      if (!publishing) void publish();
    });
  };
  const publish = async () => {
    queued = false;
    if (!isClientSettingsHydrated()) return;
    const target = appAtomRegistry.get(targetAtom);
    if (target === null) return;
    const settings = getClientSettings();
    const layout: DesktopProjectLayout = {
      order: useUiStateStore.getState().projectOrder,
      groups: useProjectRailGroupsStore.getState().groups,
      ...selectProjectGroupingSettings(settings),
      sidebarProjectLinks: settings.sidebarProjectLinks,
    };
    if (
      target.saved === null &&
      layout.order.length === 0 &&
      layout.groups.length === 0 &&
      layout.sidebarProjectGroupingMode === DEFAULT_CLIENT_SETTINGS.sidebarProjectGroupingMode &&
      Object.keys(layout.sidebarProjectGroupingOverrides).length === 0 &&
      Object.keys(layout.sidebarProjectLinks).length === 0
    ) {
      return;
    }
    if (target.saved !== null && sameLayout(layout, target.saved)) return;
    publishing = true;
    try {
      await runAtomCommand(appAtomRegistry, serverEnvironment.updateSettings, {
        environmentId: target.environmentId,
        input: { patch: { desktopProjectLayout: layout } },
      });
    } finally {
      publishing = false;
      if (queued) {
        queued = false;
        schedule();
      }
    }
  };
  appAtomRegistry.subscribe(targetAtom, schedule);
  subscribeClientSettings(schedule);
  subscribeClientSettingsHydration(schedule);
  useUiStateStore.subscribe((current, previous) => {
    if (current.projectOrder !== previous.projectOrder) schedule();
  });
  useProjectRailGroupsStore.subscribe((current, previous) => {
    if (current.groups !== previous.groups) schedule();
  });
  schedule();
}
