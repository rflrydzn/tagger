type ModalProps = {
  tagToApply: string;
  totalCount: number;
  onConfirm: () => void;
};

export default function ConfirmationModal({
  tagToApply,
  totalCount,
  onConfirm,
}: ModalProps) {
  return (
    <s-modal id="modal" heading="Confirm Bulk Tag Operation">
      <s-paragraph>
        Are you sure you want to apply the tag "{tagToApply.trim()}" to all{" "}
        {totalCount.toLocaleString()} matched products using bulk operations?
      </s-paragraph>
      <s-paragraph>
        This will run in the background and may take a few minutes to complete.
      </s-paragraph>

      <s-button slot="secondary-actions" commandFor="modal" command="--hide">
        Cancel
      </s-button>
      <s-button
        slot="primary-action"
        variant="primary"
        commandFor="modal"
        command="--hide"
        onClick={onConfirm}
      >
        Confirm
      </s-button>
    </s-modal>
  );
}
