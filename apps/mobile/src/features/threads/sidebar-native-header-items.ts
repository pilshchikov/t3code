import type { NativeStackHeaderItem } from "@react-navigation/native-stack";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";

export function createSidebarHeaderItems(input: {
  readonly onOpenProjects: () => void;
  readonly onOpenSettings: () => void;
}): NativeStackHeaderItem[] {
  return [
    withNativeGlassHeaderItem({
      type: "button",
      axisBehavior: "horizontalOnly",
      label: "Projects",
      accessibilityLabel: "Choose project",
      icon: { type: "sfSymbol" as const, name: "sidebar.left" as const },
      onPress: input.onOpenProjects,
    }),
    withNativeGlassHeaderItem({
      type: "button",
      axisBehavior: "horizontalOnly",
      label: "Settings",
      accessibilityLabel: "Open settings",
      icon: { type: "sfSymbol" as const, name: "gearshape" as const },
      onPress: input.onOpenSettings,
    }),
  ];
}
