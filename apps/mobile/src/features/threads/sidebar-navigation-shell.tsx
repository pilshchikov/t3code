import type { ReactNode } from "react";
import { StandaloneStack } from "../layout/nested-stacks";
import { pageRoute } from "../layout/route-options";
import { getCompactBrandHeaderOptions } from "../layout/workspace/brand-header-options";
const options = {
  ...pageRoute(),
  ...getCompactBrandHeaderOptions({ fontSize: 18, fontWeight: "800" }),
};
export function SidebarNavigationShell(props: { readonly children: ReactNode }) {
  return (
    <StandaloneStack surface="sidebar" options={options}>
      {props.children}
    </StandaloneStack>
  );
}
