import { describe, expect, it } from "vite-plus/test";

import {
  resolveWorkspaceColor,
  workspaceDirectoryName,
  workspaceDisplayName,
  withFolderSetting,
} from "./projectWorkspacePresentation";

describe("project workspace presentation", () => {
  it("names a folder by its tracked name, then by its directory", () => {
    expect(workspaceDirectoryName("/Users/example/projects/meko/")).toBe("meko");
    expect(workspaceDisplayName({ path: "/Users/example/projects/meko" }, 0)).toBe("meko");
    expect(workspaceDisplayName({ path: "/tmp/qa-services", name: "QA" }, 1)).toBe("QA");
  });

  it("changes one folder's settings and drops an entry left empty", () => {
    const settings = [
      { path: "/app", color: "blue" as const },
      { path: "/api", agentGuidance: "Run checks" },
    ];
    expect(withFolderSetting(settings, "/api", { color: "red" })).toEqual([
      { path: "/app", color: "blue" },
      { path: "/api", color: "red", agentGuidance: "Run checks" },
    ]);
    expect(withFolderSetting(settings, "/api", { agentGuidance: "  " })).toEqual([
      { path: "/app", color: "blue" },
    ]);
  });

  it("assigns stable defaults and honors a saved color", () => {
    expect(resolveWorkspaceColor({ color: undefined }, 0)).toBe("red");
    expect(resolveWorkspaceColor({ color: undefined }, 1)).toBe("orange");
    expect(resolveWorkspaceColor({ color: "violet" }, 1)).toBe("violet");
  });
});
