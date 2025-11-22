import { LoaderData, Summary } from "../../types/types";

export const getInitialStates = (
  loaderData: LoaderData,
): {
  initialBulkOpId: string | null;
  initialBulkOpContext: {
    totalFiltered: number;
    totalProcessed: number;
    tag: string;
  } | null;
  initialSummary: Summary | null;
} => {
  // Check if we are hydrating the client (window is available)
  if (typeof window === "undefined") {
    return {
      initialBulkOpId: null,
      initialBulkOpContext: null,
      initialSummary: loaderData.finalSummary,
    };
  }

  const status = loaderData.bulkOperationStatus;
  const urlParams = new URLSearchParams(window.location.search);
  const isPolling = urlParams.get("checkStatus") === "true";

  // If the loader found an active operation AND the URL has the context params, resume state
  if (
    isPolling &&
    status?.id &&
    status.status !== "COMPLETED" &&
    status.status !== "FAILED" &&
    status.status !== "CANCELED"
  ) {
    const totalFiltered = parseInt(urlParams.get("totalFiltered") || "0", 10);
    const totalProcessed = parseInt(urlParams.get("totalProcessed") || "0", 10);
    const appliedTag = urlParams.get("appliedTag") || "";

    const context = { totalFiltered, totalProcessed, tag: appliedTag };

    return {
      initialBulkOpId: status.id,
      initialBulkOpContext: context,
      initialSummary: {
        // Use the context to display the running job's progress placeholder
        updated: totalProcessed,
        alreadyHadTag: totalFiltered - totalProcessed,
        failed: 0,
        total: totalFiltered,
        tag: appliedTag,
      },
    };
  }

  return {
    initialBulkOpId: null,
    initialBulkOpContext: null,
    initialSummary: loaderData.finalSummary,
  };
};
