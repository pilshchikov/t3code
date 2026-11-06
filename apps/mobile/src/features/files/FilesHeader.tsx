import type { ReactNode } from "react";
import { AppBar } from "../../components/ui/AppBar";

export function FilesHeader(props: {
  readonly projectName: string;
  readonly searchQuery: string;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onRefresh: () => void;
  readonly onBack?: () => void;
  readonly leading?: ReactNode;
}) {
  return (
    <AppBar
      title="Files"
      subtitle={props.projectName}
      onBack={props.onBack}
      leading={props.leading}
      search={{
        value: props.searchQuery,
        onChangeText: props.onSearchQueryChange,
        placeholder: "Search files",
        mode: "collapsible",
      }}
      refresh={{ accessibilityLabel: "Refresh files", onPress: props.onRefresh }}
    />
  );
}
