import type { ProjectEntry } from "@t3tools/contracts";

export interface FileBreadcrumb {
  label: string;
  path: string;
  kind: "project" | "directory" | "file";
}

export function fileBreadcrumbs(projectName: string, relativePath: string): FileBreadcrumb[] {
  const parts = relativePath.split("/").filter(Boolean);
  return [
    { label: projectName, path: "", kind: "project" },
    ...parts.map((part, index) => ({
      label: part,
      path: parts.slice(0, index + 1).join("/"),
      kind: index === parts.length - 1 ? ("file" as const) : ("directory" as const),
    })),
  ];
}

const pathParts = (path: string): string[] => path.split("/").filter(Boolean);

export function parentDirectoryPath(relativePath: string): string {
  const parts = pathParts(relativePath);
  return parts.slice(0, -1).join("/");
}

export function directChildProjectEntries(
  entries: ReadonlyArray<ProjectEntry>,
  directoryPath: string,
): ProjectEntry[] {
  const directoryParts = pathParts(directoryPath);
  return entries
    .filter((entry) => {
      const entryParts = pathParts(entry.path);
      if (entryParts.length !== directoryParts.length + 1) {
        return false;
      }
      return directoryParts.every((part, index) => entryParts[index] === part);
    })
    .toSorted((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }
      return left.path.localeCompare(right.path, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
}

export function firstFileInDirectory(
  entries: ReadonlyArray<ProjectEntry>,
  directoryPath: string,
): string | null {
  const directoryParts = pathParts(directoryPath);
  return (
    entries
      .filter((entry) => {
        if (entry.kind !== "file") {
          return false;
        }
        const entryParts = pathParts(entry.path);
        if (entryParts.length <= directoryParts.length) {
          return false;
        }
        return directoryParts.every((part, index) => entryParts[index] === part);
      })
      .toSorted((left, right) =>
        left.path.localeCompare(right.path, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      )[0]?.path ?? null
  );
}
