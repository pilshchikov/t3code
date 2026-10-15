// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { AuthGrantScope, type AuthEnvironmentScope } from "@t3tools/contracts";
import { ClientScopesDialog } from "./ClientScopesDialog";

let root: Root;
let container: HTMLDivElement;
function button(label: string) {
  const matches = [...document.querySelectorAll<HTMLButtonElement>("button")].filter(
    (b) => b.textContent?.trim() === label,
  );
  expect(matches).toHaveLength(1);
  return matches[0]!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}

describe("editing authorized client permissions", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  it("saves all available permissions and reopens with the saved grant", async () => {
    function Settings() {
      const [scopes, save] = useState<ReadonlyArray<AuthEnvironmentScope>>(["orchestration:read"]);
      return (
        <>
          <p data-current-grant>{scopes.join(", ")}</p>
          <ClientScopesDialog
            label="iPhone Safari"
            scopes={scopes}
            delegatableScopes={AuthGrantScope.literals}
            onSave={async (next) => {
              save(next);
            }}
          />
        </>
      );
    }
    await act(async () => root.render(<Settings />));
    await click("Edit permissions");
    await click("All available");
    await click("Save permissions");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector("[data-current-grant]")?.textContent).toContain("relay:read");
    expect(document.querySelector("[data-current-grant]")?.textContent).toContain("access:write");
    await click("Edit permissions");
    await click("Read only");
    await click("Save permissions");
    expect(document.querySelector("[data-current-grant]")?.textContent).toContain(
      "filesystem:read",
    );
    expect(document.querySelector("[data-current-grant]")?.textContent).not.toContain(
      "filesystem:write",
    );
  });
  it("keeps edits open on save failure and leaves saved permissions unchanged when cancelled", async () => {
    await act(async () =>
      root.render(
        <ClientScopesDialog
          label="iPhone Safari"
          scopes={["orchestration:read"]}
          delegatableScopes={AuthGrantScope.literals}
          onSave={async () => {
            throw new Error("Connection lost. Try again.");
          }}
        />,
      ),
    );
    await click("Edit permissions");
    await click("All available");
    await click("Save permissions");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Connection lost");
    await click("Cancel");
    await click("Edit permissions");
    const selected = [...document.querySelectorAll('[role="checkbox"][aria-checked="true"]')];
    expect(selected).toHaveLength(1);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
  it("lets a limited manager remove higher permissions without granting unavailable ones", async () => {
    let saved: ReadonlyArray<AuthGrantScope> = [];
    await act(async () =>
      root.render(
        <ClientScopesDialog
          label="Phone"
          scopes={["orchestration:read", "filesystem:write"]}
          delegatableScopes={["orchestration:read", "access:write"]}
          onSave={async (next) => {
            saved = next;
          }}
        />,
      ),
    );
    await click("Edit permissions");
    expect(button("Save permissions").disabled).toBe(true);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "only grant permissions",
    );
    await click("All available");
    await click("Save permissions");
    expect(saved).toEqual(["orchestration:read", "access:write"]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
