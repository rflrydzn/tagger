import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useState, useCallback, useEffect } from "react";
import { useSubmit, useNavigation, useActionData } from "react-router";
import { LegacyCard, EmptyState } from "@shopify/polaris";

import { authenticate } from "../shopify.server";

const FETCH_PAGE_LIMIT = 50;
const PREVIEW_COUNT = 10;

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

interface LoaderData {
  products: Product[];
  totalCount: number;
  filters: FilterState;
  previewMode: boolean;
  error: string | null;
}

interface ActionData {
  success: boolean;
  error: string | null;
  summary?: {
    updated: number;
    alreadyHadTag: number;
    failed: number;
    total: number;
    tag: string;
  };
}

// ============================================================================
// UTILITIES
// ============================================================================

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
      const data = await response.json();

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

      if (hasNextPage) {
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

// ============================================================================
// LOADER
// ============================================================================
export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);

  const keyword = url.searchParams.get("keyword") || "";
  const productType = url.searchParams.get("productType") || "";
  const collectionHandle = url.searchParams.get("collectionHandle") || "";
  const preview = url.searchParams.get("preview") === "true";

  const filters: FilterState = { keyword, productType, collectionHandle };
  const queryString = buildProductQuery(filters);

  if (!preview || !queryString) {
    return {
      products: [],
      totalCount: 0,
      filters,
      previewMode: false,
      error: null,
    };
  }

  try {
    const query = `
      #graphql
      query getProducts($query: String) {
        products(first: ${FETCH_PAGE_LIMIT}, query: $query) {
          edges {
            node {
              id
              title
              handle
              productType
              status
              tags
            }
          }
          pageInfo {
            hasNextPage
          }
        }
      }
    `;

    const response = await admin.graphql(query, {
      variables: { query: queryString },
    });
    const data = await response.json();

    if (data.errors) {
      console.error("GraphQL errors in loader:", data.errors);
      return {
        products: [],
        totalCount: 0,
        filters,
        previewMode: false,
        error: `Query error: ${data.errors[0].message}`,
      };
    }

    const allProducts: Product[] =
      data.data?.products?.edges.map((edge: any) => edge.node) || [];

    let totalCount = allProducts.length;
    if (data.data?.products?.pageInfo?.hasNextPage) {
      totalCount = allProducts.length + 500;
    }

    const productsForDisplay = allProducts.slice(0, PREVIEW_COUNT);

    return {
      products: productsForDisplay,
      totalCount,
      filters,
      previewMode: true,
      error: null,
    };
  } catch (error) {
    console.error("Loader error:", error);
    return {
      products: [],
      totalCount: 0,
      filters,
      previewMode: false,
      error: error instanceof Error ? error.message : "Failed to load products",
    };
  }
};

// ============================================================================
// ACTION
// ============================================================================
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

  const filters: FilterState = { keyword, productType, collectionHandle };
  const queryString = buildProductQuery(filters);

  if (!queryString) {
    return {
      success: false,
      error: "Please apply at least one filter before tagging.",
    };
  }

  if (actionIntent === "applyTag") {
    let allProducts: Product[] = [];
    try {
      allProducts = await fetchProductsIteratively({ admin, queryString });
    } catch (e) {
      console.error("Error during paginated product fetch:", e);
      return {
        success: false,
        error: `Failed to fetch all products for tagging: ${e instanceof Error ? e.message : "Unknown error"}`,
      };
    }

    if (allProducts.length === 0) {
      return {
        success: false,
        error: "No products found matching your filters to tag.",
      };
    }

    let updated = 0;
    let alreadyHadTag = 0;
    let failed = 0;
    const TAG = tagToApply.trim();
    const MAX_RETRIES = 3;
    const BASE_DELAY = 500;

    const updateMutation = `
      #graphql
      mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
            tags
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    let specificErrorMessage: string | null = null;
    const failedProducts: string[] = [];

    for (const product of allProducts) {
      const hasTag = product.tags.some(
        (tag) => tag.toLowerCase() === TAG.toLowerCase(),
      );

      if (hasTag) {
        alreadyHadTag++;
        continue;
      }

      let productUpdateFailed = false;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const newTags = [...product.tags, TAG];

          const updateResponse = await admin.graphql(updateMutation, {
            variables: {
              input: {
                id: product.id,
                tags: newTags,
              },
            },
          });

          const updateData = await updateResponse.json();

          if (updateData.errors) {
            console.error(
              `GraphQL error for ${product.id}:`,
              updateData.errors,
            );
            specificErrorMessage = `GraphQL Error: ${updateData.errors[0].message}`;
            productUpdateFailed = true;
            break;
          }

          if (updateData.data?.productUpdate?.userErrors?.length > 0) {
            const errorMessage =
              updateData.data.productUpdate.userErrors[0].message;

            if (!specificErrorMessage) {
              const productIdShort = product.id.split("/").pop();
              specificErrorMessage = `Product ${productIdShort} (${product.title}): ${errorMessage}`;
            }

            failedProducts.push(product.title);
            productUpdateFailed = true;
            break;
          }

          updated++;
          break;
        } catch (error: any) {
          console.error(
            `Transient error updating product ${product.id} on attempt ${attempt + 1}:`,
            error,
          );

          if (attempt < MAX_RETRIES - 1) {
            const delay = BASE_DELAY * Math.pow(2, attempt);
            await new Promise((resolve) => setTimeout(resolve, delay));
          } else {
            productUpdateFailed = true;
            failedProducts.push(product.title);

            if (!specificErrorMessage) {
              specificErrorMessage = `Network error after ${MAX_RETRIES} retries: ${error.message}`;
            }
          }
        }
      }

      if (productUpdateFailed) {
        failed++;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const errorDetails = specificErrorMessage
      ? `${specificErrorMessage}${failedProducts.length > 0 ? ` | Failed products: ${failedProducts.slice(0, 3).join(", ")}${failedProducts.length > 3 ? "..." : ""}` : ""}`
      : null;

    return {
      success: failed < allProducts.length,
      summary: {
        updated,
        alreadyHadTag,
        failed,
        total: allProducts.length,
        tag: TAG,
      },
      error: errorDetails,
    };
  }

  return { success: false, error: "Invalid action" };
};

export default function AddTags() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [keyword, setKeyword] = useState(loaderData.filters.keyword);
  const [productType, setProductType] = useState(
    loaderData.filters.productType,
  );
  const [collectionHandle, setCollectionHandle] = useState(
    loaderData.filters.collectionHandle,
  );
  const [tagToApply, setTagToApply] = useState("");
  const [showSummary, setShowSummary] = useState(false);
  const [summary, setSummary] = useState<any>(null);

  const isSubmitting = navigation.state === "submitting";
  const isApplyingTag =
    isSubmitting && navigation.formData?.get("action") === "applyTag";
  const isPreviewing =
    isSubmitting && navigation.formData?.get("action") === "preview";
  const filtersSet =
    !!keyword.trim() || !!productType.trim() || !!collectionHandle.trim();

  const totalCountText =
    loaderData.totalCount > FETCH_PAGE_LIMIT
      ? `${loaderData.totalCount.toLocaleString()}+`
      : loaderData.totalCount.toString();

  useEffect(() => {
    if (actionData) {
      setSummary(actionData.summary || { error: actionData.error });
      setShowSummary(true);
      if (actionData.success && !actionData.error) {
        setTagToApply("");
      }
    }
  }, [actionData]);

  useEffect(() => {
    setShowSummary(false);
    setSummary(null);
  }, [keyword, productType, collectionHandle]);

  const handlePreview = useCallback(() => {
    setShowSummary(false);
    setSummary(null);
    const params = new URLSearchParams();
    params.set("preview", "true");
    if (keyword) params.set("keyword", keyword);
    if (productType) params.set("productType", productType);
    if (collectionHandle) params.set("collectionHandle", collectionHandle);

    submit(params, { method: "get" });
  }, [keyword, productType, collectionHandle, submit]);

  const handleApplyTag = useCallback(() => {
    setShowSummary(false);
    setSummary(null);

    const formData = new FormData();
    formData.append("action", "applyTag");
    formData.append("keyword", keyword);
    formData.append("productType", productType);
    formData.append("collectionHandle", collectionHandle);
    formData.append("tagToApply", tagToApply);

    submit(formData, { method: "post" });
  }, [
    keyword,
    productType,
    collectionHandle,
    tagToApply,
    loaderData.totalCount,
    submit,
  ]);

  const handleClearFilters = useCallback(() => {
    setKeyword("");
    setProductType("");
    setCollectionHandle("");
    setTagToApply("");
    setShowSummary(false);
    setSummary(null);
    submit(new URLSearchParams(), { method: "get" });
  }, [submit]);

  const totalCountDisplay =
    loaderData.totalCount > FETCH_PAGE_LIMIT
      ? `${loaderData.totalCount.toLocaleString()}+`
      : loaderData.totalCount.toString();

  return (
    <s-page heading="Product Tagger">
      {showSummary && summary && (
        <s-section>
          {loaderData.error && (
            <s-banner tone="critical">
              <s-text>Error Loading Products</s-text>
              <s-text>{loaderData.error}</s-text>
            </s-banner>
          )}

          {/* Success / Error Banner */}

          <s-banner
            tone={
              summary.error
                ? summary.updated > 0
                  ? "warning"
                  : "critical"
                : "success"
            }
          >
            <s-text>
              {summary.error && summary.updated === 0
                ? "Tagging Action Failed"
                : summary.error
                  ? "Tagging Completed with Errors"
                  : "Tag Applied Successfully!"}
            </s-text>
            <s-box>
              {summary.error && summary.updated === 0 ? (
                <s-text>
                  <strong>Error Details:</strong> {summary.error}
                </s-text>
              ) : summary.error ? (
                <>
                  <s-text>
                    Tag <strong>"{summary.tag}"</strong> partially applied to{" "}
                    {summary.total} products: <strong>{summary.updated}</strong>{" "}
                    updated, <strong>{summary.alreadyHadTag}</strong> already
                    had the tag (skipped), <strong>{summary.failed}</strong>{" "}
                    failed.
                  </s-text>
                  <s-box>
                    <s-text tone="critical">
                      <strong>Error Details:</strong> {summary.error}
                    </s-text>
                  </s-box>
                </>
              ) : (
                <s-text>
                  Tag <strong>"{summary.tag}"</strong> applied to{" "}
                  {summary.total} products: <strong>{summary.updated}</strong>{" "}
                  updated, <strong>{summary.alreadyHadTag}</strong> already had
                  the tag (skipped), <strong>{summary.failed}</strong> failed.
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
              {/* <s-stack>
                <s-badge
                  tone={loaderData.products.length > 0 ? "success" : "info"}
                >
                  {totalCountDisplay}{" "}
                  {loaderData.totalCount === 1 ? "product" : "products"} found
                </s-badge>
              </s-stack> */}

              {loaderData.products.length === 0 ? (
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
                      <strong>{totalCountDisplay}</strong> estimated matching
                      products
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
                        {loaderData.products.map((product) => {
                          const hasTag = product.tags.some(
                            (tag) =>
                              tag.toLowerCase() ===
                              tagToApply.trim().toLowerCase(),
                          );

                          return (
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
                          );
                        })}
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
                automatically receive your new tags.
              </p>
            </EmptyState>
          </LegacyCard>
        )}

        {/* Initial State */}
        {/* {!loaderData.previewMode && !loaderData.error && (
          <s-section>
            <s-section>
              <s-box
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-text>Ready to tag products</s-text>
                <s-box>
                  <s-text>
                    Set your filters and click <strong>Preview Matches</strong>{" "}
                    to see which products will be tagged.
                  </s-text>
                </s-box>
                <s-box>
                  <s-text variant="bodyMd">
                    The system supports cursor-based pagination and can handle
                    1,000+ products efficiently.
                  </s-text>
                </s-box>
              </s-box>
            </s-section>
          </s-section>
        )} */}
      </s-section>

      {/* Filters Card */}
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
          value={productType}
          onChange={(e) => setCollectionHandle(e.currentTarget.value)}
          placeholder="e.g., summer-collection"
          disabled={isSubmitting}
        />
        <s-button
          variant="primary"
          onClick={handlePreview}
          loading={isPreviewing}
          disabled={isApplyingTag || !filtersSet}
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

      {/* Tag Card */}
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
            !tagToApply.trim() ||
            loaderData.products.length === 0 ||
            isSubmitting
          }
        >
          {isApplyingTag
            ? "Applying Tag..."
            : `Apply Tag (${totalCountDisplay} Products)`}
        </s-button>
      </s-section>

      {/* <s-layout-section>
          <s-section heading="Tag Configuration">
           

              {!filtersSet && (
                <s-box paddingBlockStart="300">
                  <s-banner tone="info">
                    <s-text variant="bodyMd">
                      Add at least one filter above to preview matching products
                    </s-text>
                  </s-banner>
                </s-box>
              )}

    
            </s-box>
          </s-section>
        </s-layout-section> */}
      <>
        <s-modal id="modal" heading="Details">
          <s-paragraph>
            `Are you sure you want to apply the tag "{tagToApply.trim()}" to all{" "}
            {totalCountText} matched products?`,
          </s-paragraph>

          <s-button
            slot="secondary-actions"
            commandFor="modal"
            command="--hide"
          >
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
      </>
    </s-page>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
