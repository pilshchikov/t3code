import type {
  ProjectScript,
  ResolvedKeybindingsConfig,
  T3ProjectFileScript,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { DownloadIcon, MoreHorizontalIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { commandForProjectScript } from "~/projectScripts";
import { shortcutLabelForCommand } from "~/keybindings";
import {
  EMPTY_PROJECT_SCRIPT_INPUT,
  editorRequestForScript,
  ProjectScriptEditorDialog,
  ScriptIcon,
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
  type ProjectScriptEditorRequest,
} from "./projectScriptEditor";
import { Button } from "./ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export type { NewProjectScriptInput, ProjectScriptActionResult };

const NO_FILE_SCRIPTS: ReadonlyArray<T3ProjectFileScript> = [];
const ACTION_BUTTON_CLASS_NAME =
  "shrink-0 w-7 px-0 sm:w-6 @3xl/header-actions:w-auto! @3xl/header-actions:px-[calc(--spacing(2)-1px)]";

interface ProjectScriptsControlProps {
  scripts: ReadonlyArray<ProjectScript>;
  /** Scripts declared in the project's checked-in t3.json, offered for import. */
  fileScripts?: ReadonlyArray<T3ProjectFileScript>;
  keybindings: ResolvedKeybindingsConfig;
  preferredScriptId?: string | null;
  onRunScript: (script: ProjectScript) => void;
  onAddScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
}

export default function ProjectScriptsControl({
  scripts,
  fileScripts = NO_FILE_SCRIPTS,
  keybindings,
  preferredScriptId = null,
  onRunScript,
  onAddScript,
  onUpdateScript,
  onDeleteScript,
}: ProjectScriptsControlProps) {
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [editorRequest, setEditorRequest] = useState<ProjectScriptEditorRequest | null>(null);

  const orderedScripts = useMemo(() => {
    if (!preferredScriptId) return scripts;
    const preferred = scripts.find((script) => script.id === preferredScriptId);
    if (!preferred) return scripts;
    return [preferred, ...scripts.filter((script) => script.id !== preferred.id)];
  }, [preferredScriptId, scripts]);
  const importableScripts = useMemo(
    () =>
      fileScripts.filter(
        (fileScript) =>
          !scripts.some(
            (script) =>
              script.command === fileScript.command ||
              script.name.toLowerCase() === fileScript.name.toLowerCase(),
          ),
      ),
    [fileScripts, scripts],
  );
  const dropdownItemClassName =
    "data-highlighted:bg-transparent data-highlighted:text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground data-highlighted:hover:bg-accent data-highlighted:hover:text-accent-foreground data-highlighted:focus-visible:bg-accent data-highlighted:focus-visible:text-accent-foreground";

  const openAddDialog = () => {
    setActionsMenuOpen(false);
    setEditorRequest({ scriptId: null, initial: EMPTY_PROJECT_SCRIPT_INPUT });
  };

  const openEditDialog = (script: ProjectScript) => {
    setActionsMenuOpen(false);
    setEditorRequest(editorRequestForScript(script, keybindings));
  };

  const submitScript = useCallback(
    (scriptId: string | null, input: NewProjectScriptInput) =>
      scriptId === null ? onAddScript(input) : onUpdateScript(scriptId, input),
    [onAddScript, onUpdateScript],
  );

  const importFileScript = async (fileScript: T3ProjectFileScript) => {
    const payload: NewProjectScriptInput = {
      name: fileScript.name,
      command: fileScript.command,
      icon: fileScript.icon ?? "play",
      runOnWorktreeCreate: fileScript.runOnWorktreeCreate ?? false,
      workingDirectory: fileScript.workingDirectory ?? null,
      keybinding: null,
      previewUrl: fileScript.previewUrl ?? null,
      autoOpenPreview: fileScript.previewUrl ? (fileScript.autoOpenPreview ?? false) : false,
    };
    const result = await onAddScript(payload);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      setEditorRequest({
        scriptId: null,
        initial: payload,
        error: error instanceof Error ? error.message : "Failed to import action.",
      });
    }
  };

  const importMenuItems =
    importableScripts.length > 0 ? (
      <>
        {orderedScripts.length > 0 && <MenuSeparator />}
        <MenuGroup>
          <MenuGroupLabel>From t3.json</MenuGroupLabel>
          {importableScripts.map((fileScript) => (
            <MenuItem
              key={`${fileScript.name} ${fileScript.command}`}
              className={dropdownItemClassName}
              onClick={() => void importFileScript(fileScript)}
            >
              <ScriptIcon icon={fileScript.icon ?? "play"} className="size-4" />
              <span className="truncate">{fileScript.name}</span>
              <MenuShortcut className="ms-auto">
                <DownloadIcon className="size-3.5" aria-label="Import" />
              </MenuShortcut>
            </MenuItem>
          ))}
        </MenuGroup>
      </>
    ) : null;

  const actionButtons = orderedScripts.map((script) => {
    const label = `Run ${script.runOnWorktreeCreate ? `${script.name} (setup)` : script.name}`;
    return (
      <Tooltip key={script.id}>
        <TooltipTrigger
          render={
            <Button
              size="xs"
              variant="outline"
              className={ACTION_BUTTON_CLASS_NAME}
              aria-label={label}
              data-toolbar-control=""
              onClick={() => onRunScript(script)}
            />
          }
        >
          <ScriptIcon icon={script.icon} />
          <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
            {script.name}
          </span>
        </TooltipTrigger>
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
    );
  });

  return (
    <>
      <div
        aria-label="Project actions"
        className="flex min-w-0 max-w-full flex-nowrap items-center gap-1 overflow-x-auto [scrollbar-width:none]"
      >
        {actionButtons}
        {orderedScripts.length > 0 || importableScripts.length > 0 ? (
          <Menu
            highlightItemOnHover={false}
            open={actionsMenuOpen}
            onOpenChange={setActionsMenuOpen}
          >
            <MenuTrigger
              render={
                <Button size="icon-xs" variant="outline" aria-label="Manage project actions" />
              }
            >
              <MoreHorizontalIcon className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end">
              {importMenuItems}
              {orderedScripts.length > 0 && <MenuSeparator />}
              {orderedScripts.map((script) => {
                const shortcutLabel = shortcutLabelForCommand(
                  keybindings,
                  commandForProjectScript(script.id),
                );
                return (
                  <MenuItem
                    key={`edit-${script.id}`}
                    className={dropdownItemClassName}
                    onClick={() => openEditDialog(script)}
                  >
                    <SettingsIcon className="size-4" />
                    <span className="truncate">Edit {script.name}</span>
                    {shortcutLabel && <MenuShortcut>{shortcutLabel}</MenuShortcut>}
                  </MenuItem>
                );
              })}
              <MenuItem className={dropdownItemClassName} onClick={openAddDialog}>
                <PlusIcon className="size-4" />
                Add action
              </MenuItem>
            </MenuPopup>
          </Menu>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="xs"
                  variant="outline"
                  className={ACTION_BUTTON_CLASS_NAME}
                  aria-label="Add action"
                  data-toolbar-control=""
                  onClick={openAddDialog}
                />
              }
            >
              <PlusIcon className="size-3.5" />
              <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
                Add action
              </span>
            </TooltipTrigger>
            <TooltipPopup side="top">Add action</TooltipPopup>
          </Tooltip>
        )}
      </div>

      <ProjectScriptEditorDialog
        request={editorRequest}
        scripts={scripts}
        onSubmit={submitScript}
        onDelete={(scriptId) => void onDeleteScript(scriptId)}
        onClose={() => setEditorRequest(null)}
      />
    </>
  );
}
