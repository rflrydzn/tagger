// app/routes/app._index.tsx
import { useState, useCallback, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  useLoaderData,
  useSubmit,
  useNavigation,
  useActionData,
} from "react-router";

import { authenticate } from "../shopify.server";

// --- TYPESCRIPT INTERFACES ---

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
    // Escape special characters in keyword
    const escaped = keyword.trim().replace(/['"]/g, "");
    queryParts.push(`title:*${escaped}*`);
  }

  if (productType.trim()) {
    // Escape special characters in product type
    const escaped = productType.trim().replace(/'/g, "\\'");
    queryParts.push(`product_type:'${escaped}'`);
  }

  if (collectionHandle.trim()) {
    const escaped = collectionHandle.trim().replace(/'/g, "\\'");
    queryParts.push(`collection:'${escaped}'`);
  }

  return queryParts.length > 0 ? queryParts.join(" AND ") : undefined;
};

// ============================================================================
// LOADER - Handles product filtering and preview (MAX 250 PRODUCTS)
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
        products(first: 250, query: $query) {
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
        }
      }
    `;

    const response = await admin.graphql(query, {
      variables: { query: queryString },
    });
    const data = await response.json();

    // Check for GraphQL errors
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

    const productsForDisplay = allProducts.slice(0, 10);
    const totalCount = allProducts.length;

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
// ACTION - Handles bulk tag application (MAX 250 PRODUCTS)
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
    // 1. Fetch ALL matching product IDs (MAX 250)
    const fetchQuery = `
      #graphql
      query getProducts($query: String) {
        products(first: 250, query: $query) {
          edges {
            node {
              id
              title
              tags
            }
          }
        }
      }
    `;

    let allProducts: Product[] = [];
    try {
      const response = await admin.graphql(fetchQuery, {
        variables: { query: queryString },
      });
      const data = await response.json();

      // Check for GraphQL errors
      if (data.errors) {
        console.error("GraphQL errors during fetch:", data.errors);
        return {
          success: false,
          error: `Fetch error: ${data.errors[0].message}`,
        };
      }

      allProducts =
        data.data?.products?.edges.map((edge: any) => edge.node) || [];

      if (allProducts.length === 0) {
        return {
          success: false,
          error: "No products found matching your filters.",
        };
      }
    } catch (e) {
      console.error("Error during product fetch:", e);
      return {
        success: false,
        error: `Failed to fetch products: ${e instanceof Error ? e.message : "Unknown error"}`,
      };
    }

    // 2. Apply tags to products using productUpdate (more reliable than tagsAdd)
    let updated = 0;
    let alreadyHadTag = 0;
    let failed = 0;
    const TAG = tagToApply.trim();
    const MAX_RETRIES = 3;
    const BASE_DELAY = 500;

    // ✅ FIX: Use productUpdate instead of tagsAdd
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
      // Check if product already has the tag (case-insensitive)
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
          // ✅ FIX: Add tag to existing tags array
          const newTags = [...product.tags, TAG];

          const updateResponse = await admin.graphql(updateMutation, {
            variables: {
              input: {
                id: product.id,
                tags: newTags, // Send complete tags array
              },
            },
          });

          const updateData = await updateResponse.json();

          // Check for GraphQL errors
          if (updateData.errors) {
            console.error(
              `GraphQL error for ${product.id}:`,
              updateData.errors,
            );
            specificErrorMessage = `GraphQL Error: ${updateData.errors[0].message}`;
            productUpdateFailed = true;
            break;
          }

          // Check for user errors
          if (updateData.data?.productUpdate?.userErrors?.length > 0) {
            const errorMessage =
              updateData.data.productUpdate.userErrors[0].message;
            console.error(
              `Failed to update product ${product.id}:`,
              errorMessage,
            );

            if (!specificErrorMessage) {
              const productIdShort = product.id.split("/").pop();
              specificErrorMessage = `Product ${productIdShort} (${product.title}): ${errorMessage}`;
            }

            failedProducts.push(product.title);
            productUpdateFailed = true;
            break;
          }

          // Success!
          updated++;
          break;
        } catch (error: any) {
          console.error(
            `Transient error updating product ${product.id} on attempt ${attempt + 1}:`,
            error,
          );

          if (attempt < MAX_RETRIES - 1) {
            // Exponential backoff
            const delay = BASE_DELAY * Math.pow(2, attempt);
            await new Promise((resolve) => setTimeout(resolve, delay));
          } else {
            // Failed after all retries
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

      // ✅ FIX: Add delay between requests to respect rate limits
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // 3. Return Final Summary with detailed error info
    const errorDetails = specificErrorMessage
      ? `${specificErrorMessage}${failedProducts.length > 0 ? ` | Failed products: ${failedProducts.slice(0, 3).join(", ")}${failedProducts.length > 3 ? "..." : ""}` : ""}`
      : null;

    return {
      success: failed < allProducts.length, // Success if at least some products updated
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

// ============================================================================
// COMPONENT (NO STYLING - FOCUS ON INTERACTION)
// ============================================================================
export default function Index() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  // Local state for inputs and summary display
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

  // Effect to handle action completion and show the summary banner
  useEffect(() => {
    if (actionData) {
      setSummary(actionData.summary || { error: actionData.error });
      setShowSummary(true);
      if (actionData.success && !actionData.error) {
        setTagToApply(""); // Clear tag input on full success
      }
    }
  }, [actionData]);

  // Reset summary banner if filters change
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

    if (
      !window.confirm(
        `Are you sure you want to apply the tag "${tagToApply.trim()}" to ${loaderData.totalCount} products?`,
      )
    ) {
      return;
    }

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

  // Custom Banner replacement (unstyled div)
  const UnstyledBanner = ({
    type,
    title,
    children,
  }: {
    type: "success" | "critical" | "warning";
    title: string;
    children: React.ReactNode;
  }) => {
    return (
      <div
        id={`status-banner-${type}`}
        style={{
          padding: "12px",
          marginBottom: "16px",
          border: "2px solid",
          borderColor:
            type === "success"
              ? "green"
              : type === "critical"
                ? "red"
                : "orange",
          backgroundColor:
            type === "success"
              ? "#e6ffe6"
              : type === "critical"
                ? "#ffe6e6"
                : "#fff3cd",
        }}
      >
        <h3 style={{ margin: "0 0 8px 0" }}>{title}</h3>
        {children}
      </div>
    );
  };

  return (
    <div style={{ padding: "20px", maxWidth: "1200px", margin: "0 auto" }}>
      <h1>Product Tagger (Functional Only)</h1>
      <p>
        The goal is to **filter** products and **bulk-add a tag**.
        <strong>
          {" "}
          (Currently limited to 250 products, requires `write_products` scope).
        </strong>
      </p>

      {/* Loader Error */}
      {loaderData.error && (
        <UnstyledBanner type="critical" title="Error Loading Products">
          <p>⚠️ {loaderData.error}</p>
        </UnstyledBanner>
      )}

      {/* Success / Error Banner */}
      {showSummary && summary && (
        <UnstyledBanner
          type={
            summary.error
              ? summary.updated > 0
                ? "warning"
                : "critical"
              : "success"
          }
          title={
            summary.error && summary.updated === 0
              ? "Tagging Action Failed"
              : summary.error
                ? "Tagging Completed with Errors"
                : "Tag Applied Successfully!"
          }
        >
          {summary.error && summary.updated === 0 ? (
            <p>
              ⚠️ <strong>Error Details:</strong> {summary.error}
            </p>
          ) : summary.error ? (
            <>
              <p>
                Tag "{summary.tag}" partially applied to {summary.total}{" "}
                products: <strong>{summary.updated}</strong> updated,{" "}
                <strong>{summary.alreadyHadTag}</strong> already had the tag
                (skipped), <strong>{summary.failed}</strong> failed.
              </p>
              <p style={{ marginTop: "8px" }}>
                ⚠️ <strong>Error Details:</strong> {summary.error}
              </p>
            </>
          ) : (
            <p>
              Tag "{summary.tag}" applied to {summary.total} products:{" "}
              <strong>{summary.updated}</strong> updated,{" "}
              <strong>{summary.alreadyHadTag}</strong> already had the tag
              (skipped), <strong>{summary.failed}</strong> failed.
            </p>
          )}
        </UnstyledBanner>
      )}

      {/* FILTERS AND TAG CARDS */}
      <div style={{ marginTop: "20px" }}>
        {/* FILTERS CARD */}
        <div
          style={{
            border: "1px solid #ddd",
            padding: "16px",
            marginBottom: "16px",
            borderRadius: "4px",
          }}
        >
          <h2>Filters</h2>
          <p>Choose or combine filters to select products:</p>
          <div style={{ display: "grid", gap: "12px", marginTop: "12px" }}>
            {/* Keyword Input*/}
            <div>
              <label
                htmlFor="keyword"
                style={{
                  display: "block",
                  marginBottom: "4px",
                  fontWeight: "bold",
                }}
              >
                Keyword in Title
              </label>
              <input
                id="keyword"
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="title contains [text]"
                disabled={isSubmitting}
                style={{ width: "100%", padding: "8px" }}
              />
            </div>
            {/* Product Type Input*/}
            <div>
              <label
                htmlFor="productType"
                style={{
                  display: "block",
                  marginBottom: "4px",
                  fontWeight: "bold",
                }}
              >
                Product Type
              </label>
              <input
                id="productType"
                type="text"
                value={productType}
                onChange={(e) => setProductType(e.target.value)}
                placeholder="product type equals [text]"
                disabled={isSubmitting}
                style={{ width: "100%", padding: "8px" }}
              />
            </div>
            {/* Collection Handle Input*/}
            <div>
              <label
                htmlFor="collectionHandle"
                style={{
                  display: "block",
                  marginBottom: "4px",
                  fontWeight: "bold",
                }}
              >
                Collection Handle
              </label>
              <input
                id="collectionHandle"
                type="text"
                value={collectionHandle}
                onChange={(e) => setCollectionHandle(e.target.value)}
                placeholder="collection handle/ID"
                disabled={isSubmitting}
                style={{ width: "100%", padding: "8px" }}
              />
            </div>
          </div>
          <div style={{ marginTop: "12px" }}>
            <button
              onClick={handleClearFilters}
              disabled={isSubmitting}
              style={{
                padding: "8px 16px",
                cursor: isSubmitting ? "not-allowed" : "pointer",
              }}
            >
              Clear All Filters
            </button>
          </div>
        </div>

        <hr />

        {/* TAG APPLICATION CARD */}
        <div
          style={{
            border: "1px solid #ddd",
            padding: "16px",
            marginBottom: "16px",
            borderRadius: "4px",
          }}
        >
          <h2>Tag to Apply</h2>
          <div style={{ marginBottom: "12px" }}>
            <label
              htmlFor="tagToApply"
              style={{
                display: "block",
                marginBottom: "4px",
                fontWeight: "bold",
              }}
            >
              Tag to apply (free-text)
            </label>
            <input
              id="tagToApply"
              type="text"
              value={tagToApply}
              onChange={(e) => setTagToApply(e.target.value)}
              placeholder="e.g., Free Ship"
              disabled={isSubmitting}
              style={{ width: "100%", padding: "8px" }}
            />
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={handlePreview}
              disabled={isApplyingTag || !filtersSet || !tagToApply.trim()}
              style={{
                padding: "8px 16px",
                cursor:
                  isApplyingTag || !filtersSet || !tagToApply.trim()
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  isApplyingTag || !filtersSet || !tagToApply.trim() ? 0.5 : 1,
              }}
            >
              {isPreviewing ? "Loading Preview..." : "Preview Matches"}
            </button>

            <s-button
              onClick={handleApplyTag}
              disabled={
                !loaderData.previewMode ||
                !tagToApply.trim() ||
                loaderData.totalCount === 0 ||
                isSubmitting
              }
              style={{
                padding: "8px 16px",
                backgroundColor: "#007bff",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor:
                  !loaderData.previewMode ||
                  !tagToApply.trim() ||
                  loaderData.totalCount === 0 ||
                  isSubmitting
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  !loaderData.previewMode ||
                  !tagToApply.trim() ||
                  loaderData.totalCount === 0 ||
                  isSubmitting
                    ? 0.5
                    : 1,
              }}
            >
              {isApplyingTag
                ? `Applying Tag...`
                : `Apply Tag (${loaderData.totalCount} Products)`}
            </s-button>
          </div>
        </div>
      </div>

      <hr />

      {/* PRODUCT LIST / PREVIEW RESULTS SECTION */}
      <div>
        <h2>Product List Preview</h2>
        <div>
          {/* Case 1: Initial Load (No Preview) */}
          {!loaderData.previewMode && (
            <div
              style={{ padding: "20px", textAlign: "center", color: "#666" }}
            >
              <h3>Initial State</h3>
              <p>Use the filters and click **Preview Matches** to load data.</p>
            </div>
          )}

          {/* Case 2: Preview Mode (After button click) */}
          {loaderData.previewMode && (
            <>
              {loaderData.products.length === 0 ? (
                <div
                  style={{
                    padding: "20px",
                    textAlign: "center",
                    color: "#666",
                  }}
                >
                  <h3>No products found</h3>
                  <p>
                    No products matched your criteria. Try adjusting your
                    filters.
                  </p>
                </div>
              ) : (
                <>
                  <p style={{ marginBottom: "16px", fontWeight: "bold" }}>
                    Showing first {loaderData.products.length} of{" "}
                    <strong>{loaderData.totalCount}</strong> total matching
                    products.
                  </p>
                  <ul style={{ listStyle: "none", padding: 0 }}>
                    {loaderData.products.map((item) => {
                      const { id, title, handle, productType, tags } = item;
                      const hasTag = tags.some(
                        (tag) =>
                          tag.toLowerCase() === tagToApply.trim().toLowerCase(),
                      );

                      return (
                        <li
                          key={id}
                          style={{
                            border: "1px solid #ddd",
                            padding: "12px",
                            marginBottom: "8px",
                            borderRadius: "4px",
                            backgroundColor: hasTag ? "#ffffcc" : "white",
                          }}
                        >
                          <div>
                            <h4 style={{ margin: "0 0 8px 0" }}>
                              {title}{" "}
                              {hasTag && (
                                <span
                                  style={{ color: "green", fontWeight: "bold" }}
                                >
                                  [ALREADY HAS TAG]
                                </span>
                              )}
                            </h4>
                          </div>
                          <p style={{ margin: "4px 0", color: "#666" }}>
                            Type: {productType || "N/A"} | Handle: {handle}
                          </p>
                          {tags.length > 0 && (
                            <div style={{ marginTop: "8px" }}>
                              <strong>Existing Tags:</strong> {tags.join(", ")}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
