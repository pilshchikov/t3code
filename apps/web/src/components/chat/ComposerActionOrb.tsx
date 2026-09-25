import { memo, useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { mountOrb, type OrbHandle } from "./composerOrbRenderer";

interface ComposerActionOrbProps {
  color: string;
  className?: string;
}

/**
 * Fills its positioned parent (a composer button) with the orb. Falls back to
 * a still gradient when WebGL is unavailable, so the button never loses its
 * surface.
 */
export const ComposerActionOrb = memo(function ComposerActionOrb({
  color,
  className,
}: ComposerActionOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<OrbHandle | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handle = mountOrb(canvas, color);
    if (!handle) {
      setSupported(false);
      return;
    }
    handleRef.current = handle;
    const button = canvas.parentElement?.closest("button") ?? null;
    const focus = (focused: boolean) => () => handle.setFocused(focused);
    const enter = focus(true);
    const leave = focus(false);
    button?.addEventListener("pointerenter", enter);
    button?.addEventListener("pointerleave", leave);
    return () => {
      button?.removeEventListener("pointerenter", enter);
      button?.removeEventListener("pointerleave", leave);
      handle.destroy();
      handleRef.current = null;
    };
    // The colour is pushed through the handle rather than remounting the context.
  }, []);

  useEffect(() => {
    handleRef.current?.setColor(color);
  }, [color]);

  return (
    <span
      className={cn("pointer-events-none absolute inset-0 -z-10 rounded-full", className)}
      aria-hidden="true"
    >
      {supported ? (
        <canvas ref={canvasRef} className="size-full rounded-full" />
      ) : (
        <span
          className="block size-full rounded-full"
          style={{ background: `radial-gradient(circle at 34% 30%, ${color}, #0c0913 96%)` }}
        />
      )}
    </span>
  );
});
