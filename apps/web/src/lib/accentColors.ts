import type { CSSProperties } from "react";

export interface AccentColorOption {
  readonly id: string;
  readonly label: string;
  readonly hex: string;
}

/**
 * Ten muted mid-tones. They are deliberately desaturated: an accent marks a card at a glance
 * without competing with the status colors the row already uses for PR state and diff counts.
 */
export const ACCENT_COLOR_OPTIONS: ReadonlyArray<AccentColorOption> = [
  { id: "slate", label: "Slate", hex: "#6b7a8f" },
  { id: "red", label: "Red", hex: "#b25a52" },
  { id: "orange", label: "Orange", hex: "#b2794a" },
  { id: "amber", label: "Amber", hex: "#a8913f" },
  { id: "green", label: "Green", hex: "#5f9464" },
  { id: "teal", label: "Teal", hex: "#4e938c" },
  { id: "cyan", label: "Cyan", hex: "#4d8aa0" },
  { id: "blue", label: "Blue", hex: "#5b7fb8" },
  { id: "violet", label: "Violet", hex: "#8069b5" },
  { id: "pink", label: "Pink", hex: "#ab5f92" },
];

const OPTION_BY_ID = new Map(ACCENT_COLOR_OPTIONS.map((option) => [option.id, option]));

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * An accent is stored either as a palette id or as a literal `#rrggbb`, so a project can carry a
 * colour the palette does not offer without a second field to keep in sync.
 */
export function resolveAccentHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const option = OPTION_BY_ID.get(value);
  if (option) return option.hex;
  return HEX_PATTERN.test(value) ? value : null;
}

export function accentColorLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return OPTION_BY_ID.get(value)?.label ?? (HEX_PATTERN.test(value) ? value.toUpperCase() : null);
}

export function isAccentColorValue(value: string): boolean {
  return OPTION_BY_ID.has(value) || HEX_PATTERN.test(value);
}

const tint = (hex: string, percent: number) =>
  `color-mix(in srgb, ${hex} ${percent}%, transparent)`;

/**
 * The colour is strongest at the edge and gives way to whatever the row already sits on, so the
 * tail reads as the surface darkening rather than as a second colour painted over it.
 */
function edgeGradient(hex: string, direction: "to right" | "to left", strength: number): string {
  return [
    `linear-gradient(${direction},`,
    `${tint(hex, strength)} 0%,`,
    `${tint(hex, strength * 0.55)} 9%,`,
    `${tint(hex, strength * 0.22)} 18%,`,
    `transparent 29%)`,
  ].join(" ");
}

/**
 * Background layers for a thread card: its own colour enters from the left, its project's from the
 * right, and either may be absent. The layers go on `background-image`, which paints above the
 * row's background colour and below its content, so no extra element is needed.
 */
export function threadCardAccentStyle(input: {
  readonly threadColor: string | null | undefined;
  readonly projectColor: string | null | undefined;
}): CSSProperties | undefined {
  const leading = resolveAccentHex(input.threadColor);
  const trailing = resolveAccentHex(input.projectColor);
  if (leading === null && trailing === null) return undefined;

  const layers = [
    ...(leading === null ? [] : [edgeGradient(leading, "to right", 34)]),
    ...(trailing === null ? [] : [edgeGradient(trailing, "to left", 26)]),
  ];
  return {
    backgroundImage: layers.join(", "),
    // An inset rule rather than a border width, so a coloured card keeps the same box as a plain one.
    ...(leading === null ? {} : { boxShadow: `inset 2px 0 0 0 ${tint(leading, 72)}` }),
  };
}

/**
 * The same colour as a quiet wash across a project row in the scope menu. Background only: these
 * rows keep their own focus ring, and an inline box-shadow would paint over it.
 */
export function projectAccentStyle(color: string | null | undefined): CSSProperties | undefined {
  const hex = resolveAccentHex(color);
  if (hex === null) return undefined;
  return {
    backgroundImage: `linear-gradient(to right, ${tint(hex, 24)} 0%, ${tint(hex, 10)} 45%, transparent 88%)`,
  };
}
