import type { ActionFunctionArgs } from "react-router";
import {
  GraphQLResponse,
  FilterState,
  Summary,
  ActionData,
} from "app/types/types";
import { authenticate } from "../../shopify.server";
import { fetchProductsIteratively } from "./shopifyApi";
import { buildProductQuery } from "./queryBuilder";

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

  // Handle apply tag action
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

      const productsToUpdate = allProducts.filter(
        (product) =>
          !product.tags.some((tag) => tag.toLowerCase() === TAG.toLowerCase()),
      );

      const jsonlLines = productsToUpdate.map((product) => {
        const newTags = [...product.tags, TAG];
        return JSON.stringify({
          input: {
            id: product.id,
            tags: newTags,
          },
        });
      });

      const totalProcessed = jsonlLines.length;

      const preRunSummary: Summary = {
        updated: totalProcessed,
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

      const keyParam = parameters.find((p: any) => p.name === "key");
      if (!keyParam) {
        throw new Error("Upload key not found");
      }

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
        const shopifyError =
          bulkData.data?.bulkOperationRunMutation?.userErrors?.[0]?.message ||
          "Unknown Shopify API error.";
        console.error("Shopify Bulk Run Error:", shopifyError, bulkData.errors);

        throw new Error(`Failed to create bulk operation: ${shopifyError}`);
      }

      const bulkOperationId =
        bulkData.data.bulkOperationRunMutation.bulkOperation.id;

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

  // Handle remove tag action
  if (actionIntent === "removeTag") {
    const filters: FilterState = { keyword, productType, collectionHandle };
    const queryString = buildProductQuery(filters);

    if (!queryString) {
      return {
        success: false,
        error: "Please apply at least one filter before removing tags.",
      };
    }

    try {
      const allProducts = await fetchProductsIteratively({
        admin,
        queryString,
      });

      const totalFiltered = allProducts.length;

      if (totalFiltered === 0) {
        return {
          success: false,
          error: "No products found matching your filters.",
        };
      }

      // Filter products that actually have the tag to remove
      const productsToUpdate = allProducts.filter((product) =>
        product.tags.some((tag) => tag.toLowerCase() === TAG.toLowerCase()),
      );

      const jsonlLines = productsToUpdate.map((product) => {
        // Remove the tag (case-insensitive)
        const newTags = product.tags.filter(
          (tag) => tag.toLowerCase() !== TAG.toLowerCase(),
        );
        return JSON.stringify({
          input: {
            id: product.id,
            tags: newTags,
          },
        });
      });

      const totalProcessed = jsonlLines.length;

      const preRunSummary: Summary = {
        updated: totalProcessed,
        alreadyHadTag: 0, // Not applicable for remove
        didNotHaveTag: totalFiltered - totalProcessed,
        failed: 0,
        total: totalFiltered,
        tag: TAG,
        action: "remove",
      };

      if (totalProcessed === 0) {
        return {
          success: true,
          preRunSummary,
          error: null,
        };
      }

      const jsonlContent = jsonlLines.join("\n");

      const stagedUploadMutation = `
        mutation {
          stagedUploadsCreate(input:[{
            resource: BULK_MUTATION_VARIABLES,
            filename: "bulk_tag_remove_vars",
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

      const formDataUpload = new FormData();
      parameters.forEach((param: any) => {
        formDataUpload.append(param.name, param.value);
      });
      formDataUpload.append(
        "file",
        new Blob([jsonlContent], { type: "text/jsonl" }),
        "bulk_tag_remove_vars",
      );

      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        body: formDataUpload,
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload JSONL file");
      }

      const keyParam = parameters.find((p: any) => p.name === "key");
      if (!keyParam) {
        throw new Error("Upload key not found");
      }

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
        const shopifyError =
          bulkData.data?.bulkOperationRunMutation?.userErrors?.[0]?.message ||
          "Unknown Shopify API error.";
        console.error("Shopify Bulk Run Error:", shopifyError, bulkData.errors);

        throw new Error(`Failed to create bulk operation: ${shopifyError}`);
      }

      const bulkOperationId =
        bulkData.data.bulkOperationRunMutation.bulkOperation.id;

      return {
        success: true,
        bulkOperationId,
        error: null,
        preRunSummary,
      };
    } catch (error) {
      console.error("Bulk remove operation error:", error);
      return {
        success: false,
        error: `Failed to start bulk remove operation: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  return { success: false, error: "Invalid action" };
};
