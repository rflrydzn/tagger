import { Summary } from "./types";

export async function processBulkOperationResults({
  url,
  totalProductsMatchingFilter,
  totalProductsProcessed,
  tag,
}: {
  url: string;
  totalProductsMatchingFilter: number;
  totalProductsProcessed: number;
  tag: string;
}): Promise<Summary> {
  try {
    const resultsResponse = await fetch(url);
    if (!resultsResponse.ok) {
      throw new Error("Failed to fetch bulk operation results file.");
    }

    const resultsText = await resultsResponse.text();
    const lines = resultsText.trim().split("\n").filter(Boolean);

    let successfulMutations = 0;
    let failedMutations = 0;

    for (const line of lines) {
      try {
        const result = JSON.parse(line);

        const hasRootErrors = !!result.errors;

        const hasUserErrors = result.productUpdate?.userErrors?.length > 0;

        if (hasRootErrors || hasUserErrors) {
          failedMutations++;
        } else {
          successfulMutations++;
        }
      } catch (e) {
        console.error("Error parsing result line:", e);
        failedMutations++;
      }
    }

    const totalMutationsAttempted = successfulMutations + failedMutations;

    const alreadyHadTag = totalProductsMatchingFilter - totalMutationsAttempted;

    return {
      updated: successfulMutations,
      alreadyHadTag: alreadyHadTag < 0 ? 0 : alreadyHadTag,
      failed: failedMutations,
      total: totalProductsMatchingFilter,
      tag: tag,
    };
  } catch (e) {
    console.error("Critical error processing bulk results:", e);
    return {
      updated: 0,
      alreadyHadTag: totalProductsMatchingFilter - totalProductsProcessed,
      failed: totalProductsProcessed,
      total: totalProductsMatchingFilter,
      tag: tag,
    };
  }
}
