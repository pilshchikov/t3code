import type { ProjectEntry } from "@t3tools/contracts";
import { isWindowsAbsolutePath } from "@t3tools/shared/path";

import { isAbsolutePath } from "~/terminal-links";

export interface FileBreadcrumb {
  label: string;
  path: string;
  kind: "project" | "directory" | "file";
}

export interface FileBreadcrumbChild extends ProjectEntry {
  label: string;
}

/**
 * Crumbs for a workspace-relative path start at the project. An absolute host
 * path is outside the workspace, so its crumbs start at the filesystem root.
 */
export function fileBreadcrumbs(projectName: string, relativePath: string): FileBreadcrumb[] {
  const hostPath = isAbsolutePath(relativePath);
  const separator = isWindowsAbsolutePath(relativePath) ? "\\" : "/";
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  const root = relativePath.startsWith("\\\\") ? "\\\\" : hostPath && separator === "/" ? "/" : "";
  return [
    ...(hostPath ? [] : [{ label: projectName, path: "", kind: "project" as const }]),
    ...parts.map((part, index) => ({
      label: part,
      path: root + parts.slice(0, index + 1).join(separator),
      kind: index === parts.length - 1 ? ("file" as const) : ("directory" as const),
    })),
  ];
}

export function fileBreadcrumbChildren(
  entries: readonly ProjectEntry[],
  directoryPath: string,
): FileBreadcrumbChild[] {
  let collator: Intl.Collator | undefined;
  const prefix = directoryPath ? `${directoryPath}/` : "";
  return entries
    .flatMap((entry) => {
      if (!entry.path.startsWith(prefix)) return [];
      const label = entry.path.slice(prefix.length);
      if (!label || label.includes("/")) return [];
      return [{ ...entry, label }];
    })
    .toSorted((left, right) => {
      if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
      collator ??= new Intl.Collator(undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return collator.compare(left.label, right.label);
    });
}

export function fileBreadcrumbParent(directoryPath: string): string | null {
  if (!directoryPath) return null;
  const separatorIndex = directoryPath.lastIndexOf("/");
  return separatorIndex === -1 ? "" : directoryPath.slice(0, separatorIndex);
}

const pathParts = (path: string): string[] => path.split("/").filter(Boolean);

export function parentDirectoryPath(relativePath: string): string {
  const parts = pathParts(relativePath);
  return parts.slice(0, -1).join("/");
}

export function workspaceDocumentDirectory(workspaceRoot: string, relativePath: string): string {
  const parent = parentDirectoryPath(relativePath);
  if (!parent) return workspaceRoot.replace(/[\\/]+$/, "") || workspaceRoot;
  const separator = workspaceRoot.includes("\\") && !workspaceRoot.includes("/") ? "\\" : "/";
  return `${workspaceRoot.replace(/[\\/]+$/, "")}${separator}${parent.replaceAll("/", separator)}`;
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
