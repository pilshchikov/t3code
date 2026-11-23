import { render } from "../../../test/render";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

const provider = (driver: string, usageLimits: ServerProvider["usageLimits"]): ServerProvider => ({
  instanceId: ProviderInstanceId.make(driver),
  driver: ProviderDriverKind.make(driver),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated", email: `${driver}@example.com` },
  checkedAt: "2026-11-23T11:00:00Z",
  models: [],
  slashCommands: [],
  skills: [],
  ...(usageLimits ? { usageLimits } : {}),
});

const presentations = vi.hoisted(() => ({ value: new Map() }));
vi.mock("../../state/presentation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  environmentPresentations: {
    presentationsWithProvidersAtom: Atom.make(() => presentations.value),
  },
}));
vi.mock("../chat/ProviderInstanceIcon", () => ({ ProviderInstanceIcon: () => null }));

import { AccountLimitsHoverCard } from "./AccountLimits";

it("lists only providers that report limits, Antigravity included", async () => {
  presentations.value = new Map([
    [
      EnvironmentId.make("env-a"),
      {
        entry: { target: { label: "Desk" } },
        serverConfig: {
          usageLimitSources: [],
          providers: [
            provider("cursor", undefined),
            provider("antigravity", {
              checkedAt: "2026-11-23T11:00:00Z",
              windows: [
                {
                  id: "gemini-weekly",
                  kind: "weekly",
                  label: "Gemini · Weekly",
                  usedPercent: 4,
                  windowDurationMins: 10_080,
                },
              ],
            }),
          ],
        },
      },
    ],
  ]);
  await using _screen = await render(<AccountLimitsHoverCard />);

  const text = () => document.body.textContent ?? "";
  await expect.poll(text).toContain("Antigravity");
  expect(text()).toContain("Gemini Week");
  expect(text()).toContain("96%");
  expect(text()).not.toContain("Cursor");
});
