import type { LoaderFunctionArgs } from "react-router";

import {
  FilterState,
  Summary,
  BulkOperationStatus,
  LoaderData,
  PREVIEW_COUNT,
} from "app/types/types";

import { authenticate } from "../../shopify.server";

import { buildProductQuery } from "./queryBuilder";
import {
  checkBulkOperationStatus,
  fetchProductsIteratively,
} from "./shopifyApi";
import { processBulkOperationResults } from "./bulkResultsProcessor";

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);

  const keyword = url.searchParams.get("keyword") || "";
  const productType = url.searchParams.get("productType") || "";
  const collectionHandle = url.searchParams.get("collectionHandle") || "";
  const preview = url.searchParams.get("preview") === "true";
  const checkStatus = url.searchParams.get("checkStatus") === "true";

  const totalFiltered = parseInt(
    url.searchParams.get("totalFiltered") || "0",
    10,
  );
  const totalProcessed = parseInt(
    url.searchParams.get("totalProcessed") || "0",
    10,
  );
  const appliedTag = url.searchParams.get("appliedTag") || "";

  const filters: FilterState = { keyword, productType, collectionHandle };
  const queryString = buildProductQuery(filters);

  let bulkOpStatus: BulkOperationStatus | null = null;
  let finalSummary: Summary | null = null;

  if (checkStatus) {
    try {
      bulkOpStatus = await checkBulkOperationStatus(admin);

      if (
        bulkOpStatus?.status === "COMPLETED" &&
        bulkOpStatus.url &&
        appliedTag
      ) {
        console.log("Bulk operation completed. Processing results...");
        finalSummary = await processBulkOperationResults({
          url: bulkOpStatus.url,
          totalProductsMatchingFilter: totalFiltered,
          totalProductsProcessed: totalProcessed,
          tag: appliedTag,
        });
      }

      return {
        products: [],
        totalCount: 0,
        filters,
        previewMode: false,
        error: null,
        bulkOperationStatus: bulkOpStatus || undefined,
        finalSummary,
      };
    } catch (error) {
      console.error(
        "Error checking bulk operation or processing results:",
        error,
      );
    }
  }

  if (!preview || !queryString) {
    return {
      products: [],
      totalCount: 0,
      filters,
      previewMode: false,
      error: null,
      finalSummary: null,
    };
  }

  try {
    const allProducts = await fetchProductsIteratively({ admin, queryString });
    const totalCount = allProducts.length;
    const productsForDisplay = allProducts.slice(0, PREVIEW_COUNT);

    return {
      products: productsForDisplay,
      totalCount,
      filters,
      previewMode: true,
      error: null,
      finalSummary: null,
    };
  } catch (error) {
    console.error("Loader error:", error);
    return {
      products: [],
      totalCount: 0,
      filters,
      previewMode: false,
      error: error instanceof Error ? error.message : "Failed to load products",
      finalSummary: null,
    };
  }
};
