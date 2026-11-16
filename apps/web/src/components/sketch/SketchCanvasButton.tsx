import { PencilRulerIcon } from "lucide-react";

import type { ComposerThreadTarget } from "../../composerDraftStore";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useSketchCanvasStore } from "./sketchCanvasStore";

export function SketchCanvasButton(props: { target: ComposerThreadTarget; label: string }) {
  const openFor = useSketchCanvasStore((store) => store.openFor);
  const open = useSketchCanvasStore((store) => store.open);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Sketch"
            aria-pressed={open}
            data-pressed={open ? "" : undefined}
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) =>
              openFor(
                { target: props.target, label: props.label },
                event.currentTarget.getBoundingClientRect(),
              )
            }
            className="shrink-0"
          >
            <PencilRulerIcon />
          </Button>
        }
      />
      <TooltipPopup side="top">Sketch</TooltipPopup>
    </Tooltip>
  );
}
