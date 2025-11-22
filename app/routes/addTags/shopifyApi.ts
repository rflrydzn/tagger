import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useState, useCallback, useEffect } from "react";
import { useSubmit, useNavigation, useActionData } from "react-router";
import { LegacyCard, EmptyState, Button } from "@shopify/polaris";

import { authenticate } from "../../shopify.server";

import {
  GraphQLResponse,
  FilterState,
  Product,
  Summary,
  BulkOperationStatus,
  LoaderData,
  ActionData,
  FETCH_PAGE_LIMIT,
  PREVIEW_COUNT,
} from "app/routes/addTags/types";

export async function fetchProductsIteratively({
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

export async function checkBulkOperationStatus(
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
