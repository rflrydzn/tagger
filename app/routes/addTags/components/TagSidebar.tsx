type TagSidebarProps = {
  tagToApply: string;
  onTagChange: (newValue: string) => void;
  isSubmitting: boolean;
  totalCount: number;
  isApplyingTag: boolean;
  previewMode: boolean;
};
export default function TagSidebar({
  tagToApply,
  isSubmitting,
  isApplyingTag,
  previewMode,
  totalCount,
  onTagChange,
}: TagSidebarProps) {
  return (
    <s-section slot="aside" heading="Apply Tag">
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
      >
        {isApplyingTag ? "Starting Bulk Operation..." : "Apply Tag"}
      </s-button>
    </s-section>
  );
}
