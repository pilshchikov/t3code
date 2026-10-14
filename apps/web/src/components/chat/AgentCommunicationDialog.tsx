import { useState, type ReactNode } from "react";
import { MessagesSquareIcon } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { ThreadDetailsControl } from "./ThreadDetailsControl";

export function AgentCommunicationDialog(props: { children: (onClose: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<ThreadDetailsControl aria-label="Agent communication" />}>
        <MessagesSquareIcon aria-hidden />
        Agent communication
      </DialogTrigger>
      <DialogPopup
        size="large"
        bottomStickOnMobile={false}
        className="h-[min(48rem,calc(100dvh-2rem))]"
        data-agent-communication-dialog
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>Agent communication</DialogTitle>
          <DialogDescription>
            Task conversations and connections between the parent, subagents, and other
            environments.
          </DialogDescription>
        </DialogHeader>
        {open ? props.children(() => setOpen(false)) : null}
      </DialogPopup>
    </Dialog>
  );
}
