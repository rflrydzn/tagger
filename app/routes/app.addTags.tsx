import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useState, useCallback, useEffect } from "react";
import { useSubmit, useNavigation, useActionData } from "react-router";
import { LegacyCard, EmptyState, Button } from "@shopify/polaris";

import { authenticate } from "../shopify.server";

const FETCH_PAGE_LIMIT = 250;
const PREVIEW_COUNT = 10;

type GraphQLResponse = {
  data?: any;
  errors?: { message: string; locations: any }[];
};

interface FilterState {
  keyword: string;
  productType: string;
  collectionHandle: string;
}

interface Product {
  id: string;
  title: string;
  handle: string;
  productType: string;
  tags: string[];
}

interface Summary {
  updated: number; // Products that were successfully mutated
  alreadyHadTag: number; // Products filtered but skipped from JSONL
  failed: number; // Products that failed mutation
  total: number; // Total products matching filter (updated + alreadyHadTag + failed)
  tag: string;
}

interface BulkOperationStatus {
  id: string;
  status: string;
  objectCount: number;
  url: string | null;
}

interface LoaderData {
  products: Product[];
  totalCount: number;
  filters: FilterState;
  previewMode: boolean;
  error: string | null;
  bulkOperationStatus?: BulkOperationStatus;
  // New field to return the final calculated summary
  finalSummary: Summary | null;
}

interface ActionData {
  success: boolean;
  error: string | null;
  bulkOperationId?: string;
  // This is the *pre-run* estimate, which we pass to the component/loader via state/URL
  preRunSummary?: Summary;
}

const buildProductQuery = ({
  keyword,
  productType,
  collectionHandle,
}: FilterState): string | undefined => {
  const queryParts: string[] = [];

  if (keyword.trim()) {
    const escaped = keyword.trim().replace(/['"]/g, "");
    queryParts.push(`title:*${escaped}*`);
  }

  if (productType.trim()) {
    const escaped = productType.trim().replace(/'/g, "\\'");
    queryParts.push(`product_type:'${escaped}'`);
  }

  if (collectionHandle.trim()) {
    const escaped = collectionHandle.trim().replace(/'/g, "\\'");
    queryParts.push(`collection:'${escaped}'`);
  }

  return queryParts.length > 0 ? queryParts.join(" AND ") : undefined;
};

async function fetchProductsIteratively({
  admin,
  queryString,
}: {
  admin: any;
  queryString: string;
}): Promise<Product[]> {
  let allProducts: Product[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const query = `
      #graphql
      query getProducts($query: String, $cursor: String) {
        products(first: ${FETCH_PAGE_LIMIT}, query: $query, after: $cursor) {
          edges {
            node {
              id
              title
              handle
              productType
              tags
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    try {
      const response = await admin.graphql(query, {
        variables: { query: queryString, cursor },
      });
      const data = (await response.json()) as GraphQLResponse;

      if (data.errors || data.data?.products === undefined) {
        console.error("GraphQL Errors during paginated fetch:", data.errors);
        throw new Error("Failed to fetch products during pagination.");
      }

      const pageProducts: Product[] = data.data.products.edges.map(
        (edge: any) => edge.node,
      );
      allProducts.push(...pageProducts);

      hasNextPage = data.data.products.pageInfo.hasNextPage;
      cursor = data.data.products.pageInfo.endCursor;

      if (hasNextPage && allProducts.length % FETCH_PAGE_LIMIT === 0) {
        // Wait briefly to avoid hitting rate limits too hard
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    } catch (error) {
      console.error("Critical error during paginated fetch:", error);
      hasNextPage = false;
      throw error;
    }
  }

  return allProducts;
}

async function checkBulkOperationStatus(
  admin: any,
): Promise<BulkOperationStatus | null> {
  const query = `
    #graphql
    query {
      currentBulkOperation(type: MUTATION) {
        id
        status
        errorCode
        createdAt
        completedAt
        objectCount
        url
      }
    }
  `;

  const response = await admin.graphql(query);
  const data = (await response.json()) as GraphQLResponse;

  if (data.data?.currentBulkOperation) {
    const op = data.data.currentBulkOperation;
    return {
      id: op.id,
      status: op.status,
      objectCount: parseInt(op.objectCount, 10),
      url: op.url,
    };
  }
  return null;
}

// FIX APPLIED HERE: Improved parsing of bulk operation results file.
async function processBulkOperationResults({
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

        // 1. Check for root-level errors (API connection failures)
        const hasRootErrors = !!result.errors;

        // 2. Check for user errors (mutation validation failures) under the operation name
        const hasUserErrors = result.productUpdate?.userErrors?.length > 0;

        if (hasRootErrors || hasUserErrors) {
          failedMutations++;
        } else {
          // If the line successfully parsed and has NO errors, it's a success.
          successfulMutations++;
        }
      } catch (e) {
        // Malformed line is considered a failure
        console.error("Error parsing result line:", e);
        failedMutations++;
      }
    }

    const totalMutationsAttempted = successfulMutations + failedMutations;

    // Calculate alreadyHadTag based on total filter matches vs actual attempts (JSONL lines)
    // This value should match the preRunSummary.alreadyHadTag if the fetch was complete.
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
    // Fallback error summary
    return {
      updated: 0,
      alreadyHadTag: totalProductsMatchingFilter - totalProductsProcessed,
      failed: totalProductsProcessed, // Assume all failed if we can't read the file
      total: totalProductsMatchingFilter,
      tag: tag,
    };
  }
}

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

  // Context passed from the client for final summary calculation
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

  // Check bulk operation status if requested
  if (checkStatus) {
    try {
      bulkOpStatus = await checkBulkOperationStatus(admin);

      // If the operation is COMPLETE and we have a results URL, process the file
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
        finalSummary, // Return the final summary if calculated
      };
    } catch (error) {
      console.error(
        "Error checking bulk operation or processing results:",
        error,
      );
    }
  }

  // Handle preview or initial load logic
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

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionData> => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const actionIntent = formData.get("action");
  const keyword = formData.get("keyword") as string;
  const productType = formData.get("productType") as string;
  const collectionHandle = formData.get("collectionHandle") as string;
  const tagToApply = formData.get("tagToApply") as string;

  if (!tagToApply?.trim()) {
    return { success: false, error: "Tag name cannot be empty." };
  }

  const TAG = tagToApply.trim();

  if (actionIntent === "applyTag") {
    const filters: FilterState = { keyword, productType, collectionHandle };
    const queryString = buildProductQuery(filters);

    if (!queryString) {
      return {
        success: false,
        error: "Please apply at least one filter before tagging.",
      };
    }

    try {
      // Step 1: Fetch all products to create JSONL
      const allProducts = await fetchProductsIteratively({
        admin,
        queryString,
      });

      const totalFiltered = allProducts.length;

      if (totalFiltered === 0) {
        return {
          success: false,
          error: "No products found matching your filters to tag.",
        };
      }

      // Step 2: Create JSONL content - filter out products that already have the tag
      const productsToUpdate = allProducts.filter(
        (product) =>
          !product.tags.some((tag) => tag.toLowerCase() === TAG.toLowerCase()),
      );

      const jsonlLines = productsToUpdate.map((product) => {
        const newTags = [...product.tags, TAG];
        // Bulk operations expect the input object inside a root object.
        // The productUpdate mutation expects a ProductInput object.
        return JSON.stringify({
          input: {
            id: product.id,
            tags: newTags,
          },
        });
      });

      const totalProcessed = jsonlLines.length;

      const preRunSummary: Summary = {
        updated: totalProcessed, // Estimated successful updates
        alreadyHadTag: totalFiltered - totalProcessed,
        failed: 0,
        total: totalFiltered,
        tag: TAG,
      };

      if (totalProcessed === 0) {
        return {
          success: true,
          preRunSummary,
          error: null,
        };
      }

      const jsonlContent = jsonlLines.join("\n");

      // Step 3: Create staged upload
      const stagedUploadMutation = `
        mutation {
          stagedUploadsCreate(input:[{
            resource: BULK_MUTATION_VARIABLES,
            filename: "bulk_tag_vars",
            mimeType: "text/jsonl",
            httpMethod: POST
          }]){
            userErrors{
              field
              message
            }
            stagedTargets{
              url
              resourceUrl
              parameters {
                name
                value
              }
            }
          }
        }
      `;

      const stagedResponse = await admin.graphql(stagedUploadMutation);
      const stagedData = (await stagedResponse.json()) as GraphQLResponse;

      if (
        stagedData.errors ||
        stagedData.data?.stagedUploadsCreate?.userErrors?.length > 0
      ) {
        throw new Error("Failed to create staged upload");
      }

      const stagedTarget = stagedData.data.stagedUploadsCreate.stagedTargets[0];
      const uploadUrl = stagedTarget.url;
      const parameters = stagedTarget.parameters;

      // Step 4: Upload JSONL file
      const formDataUpload = new FormData();
      parameters.forEach((param: any) => {
        formDataUpload.append(param.name, param.value);
      });
      formDataUpload.append(
        "file",
        new Blob([jsonlContent], { type: "text/jsonl" }),
        "bulk_tag_vars",
      );

      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        body: formDataUpload,
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload JSONL file");
      }

      // Step 5: Get the staged upload path (key parameter)
      const keyParam = parameters.find((p: any) => p.name === "key");
      if (!keyParam) {
        throw new Error("Upload key not found");
      }

      // Step 6: Run bulk operation
      // FIX APPLIED HERE: Simplified the inner mutation to only request userErrors.
      const bulkMutation = `
        mutation {
          bulkOperationRunMutation(
            mutation: "mutation call($input: ProductInput!) { productUpdate(input: $input) { userErrors { message field } } }",
            stagedUploadPath: "${keyParam.value}"
          ) {
            bulkOperation {
              id
              url
              status
            }
            userErrors {
              message
              field
            }
          }
        }
      `;

      const bulkResponse = await admin.graphql(bulkMutation);
      const bulkData = (await bulkResponse.json()) as GraphQLResponse;

      if (
        bulkData.errors ||
        bulkData.data?.bulkOperationRunMutation?.userErrors?.length > 0
      ) {
        // Log detailed error from Shopify if possible
        const shopifyError =
          bulkData.data?.bulkOperationRunMutation?.userErrors?.[0]?.message ||
          "Unknown Shopify API error.";
        console.error("Shopify Bulk Run Error:", shopifyError, bulkData.errors);

        throw new Error(`Failed to create bulk operation: ${shopifyError}`);
      }

      const bulkOperationId =
        bulkData.data.bulkOperationRunMutation.bulkOperation.id;

      // SUCCESS: Return the pre-run summary and the operation ID
      return {
        success: true,
        bulkOperationId,
        error: null,
        preRunSummary,
      };
    } catch (error) {
      console.error("Bulk operation error:", error);
      return {
        success: false,
        error: `Failed to start bulk operation: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  return { success: false, error: "Invalid action" };
};

// Helper to determine initial state for persistence across refreshes
const getInitialStates = (
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

  // State initialization now checks if a job is active on load/refresh
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
  const filtersSet =
    !!keyword.trim() || !!productType.trim() || !!collectionHandle.trim();

  const totalCountText = loaderData.totalCount.toLocaleString();

  // 1. Handle action data (starts a new job)
  useEffect(() => {
    if (actionData) {
      if (actionData.error && !actionData.bulkOperationId) {
        // Handle Action failure
        setCurrentSummary({
          updated: 0,
          alreadyHadTag: 0,
          failed: 0,
          total: 0,
          tag: actionData.error,
        });
      } else if (actionData.preRunSummary) {
        // If operation started (or all skipped), set initial summary
        setCurrentSummary(actionData.preRunSummary);

        // If a bulk operation ID exists, set state for polling
        if (actionData.bulkOperationId) {
          const context = {
            totalFiltered: actionData.preRunSummary.total,
            totalProcessed: actionData.preRunSummary.updated, // 'updated' is the number of lines processed
            tag: actionData.preRunSummary.tag,
          };
          setBulkOpId(actionData.bulkOperationId);
          setBulkOpContext(context);
        }

        // If no bulkOperationId, but preRunSummary exists (meaning all were skipped)
        if (
          !actionData.bulkOperationId &&
          actionData.preRunSummary.updated === 0
        ) {
          setCurrentSummary(actionData.preRunSummary);
        }
      }
    }
  }, [actionData]);

  // 2. Poll for bulk operation status and context
  useEffect(() => {
    const status = loaderData.bulkOperationStatus?.status;
    // An operation is terminal if it is COMPLETED, FAILED, or CANCELED.
    const isTerminal =
      status === "COMPLETED" || status === "FAILED" || status === "CANCELED";

    // Polling condition:
    // If we have an operation ID (from state, which is initialized from action or loader/URL)
    // AND the status is not terminal (or is undefined/null, meaning we need the first check)
    if (bulkOpId && !isTerminal) {
      const params = new URLSearchParams();
      params.set("checkStatus", "true");
      // Pass context needed for final result calculation, which survives refresh via URL
      if (bulkOpContext) {
        params.set("totalFiltered", bulkOpContext.totalFiltered.toString());
        params.set("totalProcessed", bulkOpContext.totalProcessed.toString());
        params.set("appliedTag", bulkOpContext.tag);
      }

      const timer = setTimeout(() => {
        submit(params, { method: "get", replace: true }); // Use replace to keep URL cleaner
      }, 3000); // Poll every 3 seconds
      return () => clearTimeout(timer);
    }

    // 3. Handle final completion via loaderData
    if (loaderData.finalSummary) {
      console.log(
        "Final summary received from loader, updating state and stopping polling.",
      );
      // Set the final, accurate summary
      setCurrentSummary(loaderData.finalSummary);
      // Clear context states to stop the polling loop (and implicitly clear URL params on next clean load)
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

  // Clear summary/context when filters change
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
    // Submit a clean request to clear the URL parameters entirely
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

          <s-banner
            tone={
              summary.failed > 0
                ? "critical"
                : bulkOpId ||
                    loaderData.bulkOperationStatus?.status === "RUNNING" ||
                    loaderData.bulkOperationStatus?.status === "CREATED"
                  ? "info" // Info for in-progress operations
                  : summary.updated > 0
                    ? "success"
                    : "warning" // Warning for success state where nothing was updated (all skipped)
            }
          >
            <s-text>
              {summary.failed > 0
                ? "Tagging Completed with Failures"
                : bulkOpId ||
                    loaderData.bulkOperationStatus?.status === "RUNNING" ||
                    loaderData.bulkOperationStatus?.status === "CREATED"
                  ? "Bulk Operation Processing..."
                  : summary.updated > 0
                    ? "Tagging Complete!"
                    : summary.total > 0 &&
                        summary.alreadyHadTag === summary.total
                      ? "Tag Already Applied to All Products (Skipped)"
                      : "Action Failed to Start or Invalid State"}
            </s-text>

            <s-box>
              {bulkOpId ||
              loaderData.bulkOperationStatus?.status === "RUNNING" ||
              loaderData.bulkOperationStatus?.status === "CREATED" ? (
                <s-text>
                  Bulk operation is processing {summary.total.toLocaleString()}{" "}
                  products in the background.
                  {loaderData.bulkOperationStatus && (
                    <>
                      {" "}
                      Status:{" "}
                      <strong>{loaderData.bulkOperationStatus.status}</strong>
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
                  Tag <strong>"{summary.tag}"</strong> applied to{" "}
                  {summary.total.toLocaleString()} products:
                  <strong> {summary.updated.toLocaleString()}</strong> updated
                  successfully,
                  <strong>
                    {" "}
                    {summary.alreadyHadTag.toLocaleString()}
                  </strong>{" "}
                  already had the tag (skipped),
                  <strong> {summary.failed.toLocaleString()}</strong> failed.
                </s-text>
              )}
            </s-box>
          </s-banner>
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
                <>
                  <s-box>
                    <s-text>
                      Showing first {loaderData.products.length} of{" "}
                      <strong>{loaderData.totalCount.toLocaleString()}</strong>{" "}
                      estimated matching products
                    </s-text>
                  </s-box>

                  <s-section padding="none">
                    <s-table>
                      <s-table-header-row>
                        <s-table-header>Name</s-table-header>
                        <s-table-header>Handle</s-table-header>
                        <s-table-header>Product type</s-table-header>
                        <s-table-header>Tags</s-table-header>
                      </s-table-header-row>

                      <s-table-body>
                        {loaderData.products.map((product) => (
                          <s-table-row key={product.id}>
                            <s-table-cell>{product.title}</s-table-cell>
                            <s-table-cell>{product.handle}</s-table-cell>
                            <s-table-cell>
                              {product.productType || "N/A"}
                            </s-table-cell>
                            <s-table-cell>
                              {product.tags.length > 0 ? (
                                <>
                                  {product.tags.map((tag, idx) => (
                                    <s-badge
                                      key={idx}
                                      tone={
                                        tag.toLowerCase() ===
                                        tagToApply.trim().toLowerCase()
                                          ? "success"
                                          : undefined
                                      }
                                    >
                                      {tag}
                                    </s-badge>
                                  ))}
                                </>
                              ) : (
                                <s-text>No tags</s-text>
                              )}
                            </s-table-cell>
                          </s-table-row>
                        ))}
                      </s-table-body>
                    </s-table>
                  </s-section>
                </>
              )}
            </s-box>
          </s-section>
        ) : (
          <LegacyCard sectioned>
            <EmptyState
              heading="Automate Product Tagging"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                Begin by adding search filters to define which products should
                automatically receive your new tags. This uses Shopify's bulk
                operations API for efficient processing.
              </p>
            </EmptyState>
          </LegacyCard>
        )}
      </s-section>

      <s-section slot="aside" heading="Filter Products">
        <s-text-field
          label="Search by keyword"
          value={keyword}
          onChange={(e) => setKeyword(e.currentTarget.value)}
          placeholder="e.g., shirt, vintage, 2024"
          disabled={isSubmitting}
        />
        <s-text-field
          label="Search by product type"
          value={productType}
          onChange={(e) => setProductType(e.currentTarget.value)}
          placeholder="e.g., Shirts, Pants"
          disabled={isSubmitting}
        />
        <s-text-field
          label="Search by collection"
          value={collectionHandle}
          onChange={(e) => setCollectionHandle(e.currentTarget.value)}
          placeholder="e.g., summer-collection"
          disabled={isSubmitting}
        />
        <s-button
          variant="primary"
          onClick={handlePreview}
          loading={isPreviewing}
          disabled={isApplyingTag}
        >
          Preview Matches
        </s-button>

        <s-button
          variant="secondary"
          onClick={handleClearFilters}
          disabled={isSubmitting}
        >
          Clear all filters
        </s-button>
      </s-section>

      <s-section slot="aside" heading="Apply Tag">
        <s-text-field
          value={tagToApply}
          placeholder="e.g., Free shipping"
          onChange={(e) => setTagToApply(e.currentTarget.value)}
          disabled={isSubmitting}
        />
        <s-button
          variant="primary"
          commandFor="modal"
          loading={isApplyingTag}
          disabled={
            !loaderData.previewMode ||
            loaderData.totalCount === 0 ||
            isSubmitting
          }
        >
          {isApplyingTag
            ? "Starting Bulk Operation..."
            : `Apply Tag (${loaderData.totalCount.toLocaleString()} Products)`}
        </s-button>
      </s-section>

      <s-modal id="modal" heading="Confirm Bulk Tag Operation">
        <s-paragraph>
          Are you sure you want to apply the tag "{tagToApply.trim()}" to all{" "}
          {loaderData.totalCount.toLocaleString()} matched products using bulk
          operations?
        </s-paragraph>
        <s-paragraph>
          This will run in the background and may take a few minutes to
          complete.
        </s-paragraph>

        <s-button slot="secondary-actions" commandFor="modal" command="--hide">
          Cancel
        </s-button>
        <s-button
          slot="primary-action"
          variant="primary"
          commandFor="modal"
          command="--hide"
          onClick={handleApplyTag}
        >
          Confirm
        </s-button>
      </s-modal>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
