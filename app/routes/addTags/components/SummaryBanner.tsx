import { BulkOperationStatus, Summary } from "../../../types/types";

type SummaryBannerProps = {
  summary: Summary;
  bulkOperationStatus: BulkOperationStatus | undefined;
  bulkOpId: string | null;
  actionType: "apply" | "remove";
};
export default function SummaryBanner({
  summary,
  bulkOperationStatus,
  bulkOpId,
  actionType,
}: SummaryBannerProps) {
  return (
    <s-banner
      tone={
        summary.failed > 0
          ? "critical"
          : bulkOpId ||
              bulkOperationStatus?.status === "RUNNING" ||
              bulkOperationStatus?.status === "CREATED"
            ? "info"
            : summary.updated > 0
              ? "success"
              : "warning"
      }
    >
      <s-text>
        {summary.failed > 0
          ? "Tagging Completed with Failures"
          : bulkOpId ||
              bulkOperationStatus?.status === "RUNNING" ||
              bulkOperationStatus?.status === "CREATED"
            ? "Bulk Operation Processing..."
            : summary.updated > 0
              ? "Tagging Complete!"
              : summary.total > 0 && summary.alreadyHadTag === summary.total
                ? "Tag Already Applied to All Products (Skipped)"
                : "Action Failed to Start or Invalid State"}
      </s-text>

      <s-box>
        {bulkOpId ||
        bulkOperationStatus?.status === "RUNNING" ||
        bulkOperationStatus?.status === "CREATED" ? (
          <s-text>
            Bulk operation is processing {summary.total.toLocaleString()}{" "}
            products in the background.
            {bulkOperationStatus && (
              <>
                {" "}
                Status: <strong>{bulkOperationStatus.status}</strong>
              </>
            )}
          </s-text>
        ) : summary.failed > 0 || summary.tag.includes("Failed") ? (
          <s-text>
            Error:{" "}
            <strong>
              {summary.failed > 0
                ? `${summary.failed.toLocaleString()} products failed to update.`
                : summary.tag}
            </strong>
          </s-text>
        ) : (
          <s-text>
            Tag <strong>"{summary.tag}"</strong>{" "}
            {actionType === "apply" ? "applied" : "removed"} to{" "}
            {summary.total.toLocaleString()} products:
            <strong> {summary.updated.toLocaleString()}</strong> updated
            successfully,
            <strong>
              {" "}
              {summary.alreadyHadTag?.toLocaleString()}
            </strong> already{" "}
            {actionType === "apply"
              ? "had the tag (skipped)"
              : "dont have the tag"}
            ,<strong> {summary.failed.toLocaleString()}</strong> failed.
          </s-text>
        )}
      </s-box>
    </s-banner>
  );
}
