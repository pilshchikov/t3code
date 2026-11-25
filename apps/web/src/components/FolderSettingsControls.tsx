import type { ProjectWorkspaceColor } from "@t3tools/contracts";
import { CheckIcon, NotebookPenIcon } from "lucide-react";
import { T, useGT } from "gt-react";
import { useState } from "react";

import {
  PROJECT_WORKSPACE_COLORS,
  workspaceColorOption,
} from "../lib/projectWorkspacePresentation";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { Textarea } from "./ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function FolderColorMenuItems(props: {
  color: ProjectWorkspaceColor;
  onChange: (color: ProjectWorkspaceColor) => void;
}) {
  return (
    <MenuGroup>
      <MenuGroupLabel>
        <T>Directory color</T>
      </MenuGroupLabel>
      {PROJECT_WORKSPACE_COLORS.map((option) => (
        <MenuItem key={option.color} onClick={() => props.onChange(option.color)}>
          <span className={`size-2.5 rounded-full ${option.dotClassName}`} />
          <span>{option.label}</span>
          {option.color === props.color ? <CheckIcon className="ms-auto size-3.5" /> : null}
        </MenuItem>
      ))}
    </MenuGroup>
  );
}

export function FolderColorButton(props: {
  color: ProjectWorkspaceColor;
  folderName: string;
  disabled?: boolean;
  onChange: (color: ProjectWorkspaceColor) => void;
}) {
  const gt = useGT();
  return (
    <Menu>
      <MenuTrigger
        render={<Button type="button" size="icon-xs" variant="ghost" />}
        disabled={props.disabled}
        aria-label={gt("Color for {directory}", { directory: props.folderName })}
      >
        <span
          className={cn("size-3 rounded-full", workspaceColorOption(props.color).dotClassName)}
        />
      </MenuTrigger>
      <MenuPopup align="end" className="w-36">
        <FolderColorMenuItems color={props.color} onChange={props.onChange} />
      </MenuPopup>
    </Menu>
  );
}

export function AgentGuidanceButton(props: {
  folderName: string;
  hasGuidance: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const gt = useGT();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={props.hasGuidance ? "secondary" : "ghost"}
            size="icon-xs"
            disabled={props.disabled}
            aria-label={gt("Edit agent guidance for {directory}", {
              directory: props.folderName,
            })}
            onClick={props.onClick}
          />
        }
      >
        <NotebookPenIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="top">
        {props.hasGuidance ? gt("Edit agent guidance") : gt("Add agent guidance")}
      </TooltipPopup>
    </Tooltip>
  );
}

/** Mount with a `key` per folder so the draft starts from that folder's guidance. */
export function AgentGuidanceDialog(props: {
  path: string;
  guidance: string;
  onClose: () => void;
  onSave: (guidance: string) => void;
}) {
  const gt = useGT();
  const [draft, setDraft] = useState(props.guidance);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            <T>Agent guidance</T>
          </DialogTitle>
          <DialogDescription>
            <T>
              Private instructions sent with every agent turn for this directory. They are not shown
              in the chat transcript.
            </T>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-2">
            <p className="truncate font-mono text-2xs text-muted-foreground">{props.path}</p>
            <Textarea
              value={draft}
              maxLength={8000}
              placeholder={gt(
                "Example: Commit directly to main after each completed change. Do not create a branch.",
              )}
              onChange={(event) => setDraft(event.target.value)}
            />
            <p className="text-2xs text-muted-foreground">
              {gt("{count} / 8,000 characters", { count: draft.length.toLocaleString() })}
            </p>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={props.onClose}>
            <T>Cancel</T>
          </Button>
          <Button type="button" onClick={() => props.onSave(draft)}>
            <T>Save guidance</T>
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
