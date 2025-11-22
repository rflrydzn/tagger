import type { HeadersFunction } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useState, useCallback, useEffect } from "react";
import { useSubmit, useNavigation, useActionData } from "react-router";
import { getInitialStates } from "./addTags/stateManager";
import { Summary } from "app/types/types";
import { loader } from "./addTags/loader.server";
import { action } from "./addTags/action.server";
import ConfirmationModal from "./addTags/components/ConfirmationModal";
import TagSidebar from "./addTags/components/TagSidebar";
import FilterSidebar from "./addTags/components/FilterSidebar";
import EmptyStateView from "./addTags/components/EmptyState";
import PreviewTable from "./addTags/components/PreviewTable";
import SummaryBanner from "./addTags/components/SummaryBanner";
export { loader, action };

export default function AddTags() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const { initialBulkOpId, initialBulkOpContext, initialSummary } =
    getInitialStates(loaderData);

  const [keyword, setKeyword] = useState(loaderData.filters.keyword);
  const [productType, setProductType] = useState(
    loaderData.filters.productType,
  );
  const [collectionHandle, setCollectionHandle] = useState(
    loaderData.filters.collectionHandle,
  );
  const [tagToApply, setTagToApply] = useState("");

  const [currentSummary, setCurrentSummary] = useState<Summary | null>(
    initialSummary,
  );
  const [bulkOpId, setBulkOpId] = useState<string | null>(initialBulkOpId);
  const [bulkOpContext, setBulkOpContext] =
    useState<typeof initialBulkOpContext>(initialBulkOpContext);

  const isSubmitting = navigation.state === "submitting";
  const isApplyingTag =
    isSubmitting && navigation.formData?.get("action") === "applyTag";
  const isPreviewing =
    isSubmitting && navigation.formData?.get("action") === "preview";

  useEffect(() => {
    if (actionData) {
      if (actionData.error && !actionData.bulkOperationId) {
        setCurrentSummary({
          updated: 0,
          alreadyHadTag: 0,
          failed: 0,
          total: 0,
          tag: actionData.error,
        });
      } else if (actionData.preRunSummary) {
        setCurrentSummary(actionData.preRunSummary);

        if (actionData.bulkOperationId) {
          const context = {
            totalFiltered: actionData.preRunSummary.total,
            totalProcessed: actionData.preRunSummary.updated,
            tag: actionData.preRunSummary.tag,
          };
          setBulkOpId(actionData.bulkOperationId);
          setBulkOpContext(context);
        }

        if (
          !actionData.bulkOperationId &&
          actionData.preRunSummary.updated === 0
        ) {
          setCurrentSummary(actionData.preRunSummary);
        }
      }
    }
  }, [actionData]);

  //  poll for status
  useEffect(() => {
    const status = loaderData.bulkOperationStatus?.status;
    // terminal if it is COMPLETED, FAILED, or CANCELED.
    const isTerminal =
      status === "COMPLETED" || status === "FAILED" || status === "CANCELED";

    // polling condition:
    // if we have an operation ID (from state, which is initialized from action or loader/URL)
    // AND the status is not terminal (or is undefined/null, meaning we need the first check)
    if (bulkOpId && !isTerminal) {
      const params = new URLSearchParams();
      params.set("checkStatus", "true");
      // pass context needed for final result calculation, which survives refresh via URL
      if (bulkOpContext) {
        params.set("totalFiltered", bulkOpContext.totalFiltered.toString());
        params.set("totalProcessed", bulkOpContext.totalProcessed.toString());
        params.set("appliedTag", bulkOpContext.tag);
      }

      const timer = setTimeout(() => {
        submit(params, { method: "get", replace: true }); // use replace to keep URL cleaner
      }, 3000); // Poll every 3 seconds
      return () => clearTimeout(timer);
    }

    // 3. handle final completion via loaderdata
    if (loaderData.finalSummary) {
      console.log(
        "Final summary received from loader, updating state and stopping polling.",
      );
      // set the final, accurate summary
      setCurrentSummary(loaderData.finalSummary);
      // clear context states to stop the polling loop (and implicitly clear URL params on next clean load)
      setBulkOpId(null);
      setBulkOpContext(null);
    }
  }, [
    bulkOpId,
    loaderData.bulkOperationStatus,
    loaderData.finalSummary,
    bulkOpContext,
    submit,
  ]);

  // clear summary/context when filters change
  useEffect(() => {
    // Only clear if no job is actively running or completed (i.e., bulkOpId is null)
    if (!bulkOpId && !loaderData.finalSummary) {
      setCurrentSummary(null);
      setBulkOpId(null);
      setBulkOpContext(null);
    }
  }, [
    keyword,
    productType,
    collectionHandle,
    bulkOpId,
    loaderData.finalSummary,
  ]);

  const handlePreview = useCallback(() => {
    setCurrentSummary(null);
    setBulkOpId(null);
    setBulkOpContext(null);
    const params = new URLSearchParams();
    params.set("preview", "true");
    if (keyword) params.set("keyword", keyword);
    if (productType) params.set("productType", productType);
    if (collectionHandle) params.set("collectionHandle", collectionHandle);

    submit(params, { method: "get" });
  }, [keyword, productType, collectionHandle, submit]);

  const handleApplyTag = useCallback(() => {
    setCurrentSummary(null);

    const formData = new FormData();
    formData.append("action", "applyTag");
    formData.append("keyword", keyword);
    formData.append("productType", productType);
    formData.append("collectionHandle", collectionHandle);
    formData.append("tagToApply", tagToApply);

    submit(formData, { method: "post" });
  }, [keyword, productType, collectionHandle, tagToApply, submit]);

  const handleClearFilters = useCallback(() => {
    setKeyword("");
    setProductType("");
    setCollectionHandle("");
    setTagToApply("");
    setCurrentSummary(null);
    setBulkOpId(null);
    setBulkOpContext(null);
    // submit a clean request to clear the URL parameters entirely
    submit(new URLSearchParams(), { method: "get" });
  }, [submit]);

  const summary = currentSummary;

  return (
    <s-page heading="Product Tagger">
      {summary && (
        <s-section>
          {loaderData.error && (
            <s-banner tone="critical">
              <s-text>Error Loading Products</s-text>
              <s-text>{loaderData.error}</s-text>
            </s-banner>
          )}

          <SummaryBanner
            summary={summary}
            bulkOperationStatus={loaderData?.bulkOperationStatus}
            bulkOpId={bulkOpId}
          />
        </s-section>
      )}

      <s-section>
        {loaderData.previewMode ? (
          <s-section heading="Preview results">
            <s-box borderRadius="base">
              {loaderData.products.length === 0 &&
              loaderData.totalCount === 0 ? (
                <s-box>
                  <s-text>No products match your filters</s-text>
                  <s-box>
                    <s-text>
                      Try adjusting your filters or clearing them to see more
                      products.
                    </s-text>
                  </s-box>
                </s-box>
              ) : (
                <PreviewTable
                  products={loaderData.products}
                  totalCount={loaderData.totalCount}
                  tagToApply={tagToApply}
                />
              )}
            </s-box>
          </s-section>
        ) : (
          <EmptyStateView />
        )}
      </s-section>

      <FilterSidebar
        keyword={keyword}
        productType={productType}
        collectionHandle={collectionHandle}
        onKeywordChange={setKeyword}
        onProductTypeChange={setProductType}
        onCollectionHandleChange={setCollectionHandle}
        onPreview={handlePreview}
        onClearFilters={handleClearFilters}
        isPreviewing={isPreviewing}
        isSubmitting={isSubmitting}
        isApplyingTag={isApplyingTag}
      />

      <TagSidebar
        tagToApply={tagToApply}
        onTagChange={(newValue) => setTagToApply(newValue)}
        isSubmitting={isSubmitting}
        totalCount={loaderData.totalCount}
        isApplyingTag={isApplyingTag}
        previewMode={loaderData.previewMode}
      />

      <ConfirmationModal
        tagToApply={tagToApply}
        totalCount={loaderData.totalCount}
        onConfirm={handleApplyTag}
      />
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
