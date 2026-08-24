import {
  type ApprovalRequestId,
  type ProviderApprovalDecision,
  type ProviderApprovalOption,
} from "@t3tools/contracts";
import { memo } from "react";
import { Button } from "../ui/button";

interface ComposerPendingApprovalActionsProps {
  requestId: ApprovalRequestId;
  isResponding: boolean;
  options?: ReadonlyArray<ProviderApprovalOption> | undefined;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
}

const APPROVAL_ACTION_CLASS_NAME = "font-normal";

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  requestId,
  isResponding,
  options = DEFAULT_APPROVAL_OPTIONS,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  return (
    <>
      <Button
        size="micro"
        variant="ghost-muted"
        className={APPROVAL_ACTION_CLASS_NAME}
        disabled={isResponding}
        onClick={() => void onRespondToApproval(requestId, "cancel")}
      >
        Cancel
      </Button>
      <Button
        size="micro"
        variant="ghost-muted"
        className={`${APPROVAL_ACTION_CLASS_NAME} text-destructive-foreground [:hover,[data-pressed]]:text-destructive-foreground`}
        disabled={isResponding}
        onClick={() => void onRespondToApproval(requestId, "decline")}
      >
        Decline
      </Button>
      <Button
        size="micro"
        variant="ghost-muted"
        className={APPROVAL_ACTION_CLASS_NAME}
        disabled={isResponding}
        onClick={() => void onRespondToApproval(requestId, "acceptForSession")}
      >
        Always allow this session
      </Button>
      <Button
        size="micro"
        variant="ghost-muted"
        className={`${APPROVAL_ACTION_CLASS_NAME} text-foreground`}
        disabled={isResponding}
        onClick={() => void onRespondToApproval(requestId, "accept")}
      >
        Approve
      </Button>
    </>
  );
});
