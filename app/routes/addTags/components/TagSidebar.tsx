import { Button } from "@shopify/polaris";
type TagSidebarProps = {
  tagToApply: string;
  onTagChange: (newValue: string) => void;
  isSubmitting: boolean;
  totalCount: number;
  isApplyingTag: boolean;
  isRemovingTag: boolean;
  previewMode: boolean;
  actionType: "apply" | "remove";
  onActionTypeChange: (type: "apply" | "remove") => void;
};
export default function TagSidebar({
  tagToApply,
  isSubmitting,
  isApplyingTag,
  previewMode,
  totalCount,
  onTagChange,
  actionType,
  onActionTypeChange,
  isRemovingTag,
}: TagSidebarProps) {
  return (
    <s-section slot="aside" heading="Apply/Remove Tag">
      <s-text-field
        value={tagToApply}
        placeholder="e.g., Free shipping"
        onChange={(e) => onTagChange(e.currentTarget.value)}
        disabled={isSubmitting}
      />
      <s-button
        variant="primary"
        commandFor="modal"
        loading={isApplyingTag}
        disabled={!previewMode || totalCount === 0 || isSubmitting}
        onClick={() => onActionTypeChange("apply")}
      >
        {isApplyingTag ? "Starting Bulk Operation..." : "Apply Tag"}
      </s-button>
      <s-button
        variant="primary"
        tone="critical"
        commandFor="modal"
        loading={isRemovingTag}
        disabled={!previewMode || totalCount === 0 || isSubmitting}
        onClick={() => onActionTypeChange("remove")}
      >
        {isRemovingTag ? "Starting Bulk Operation..." : "Remove Tag"}
      </s-button>
    </s-section>
  );
}
