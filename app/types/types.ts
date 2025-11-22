export const FETCH_PAGE_LIMIT = 250;
export const PREVIEW_COUNT = 10;

export type GraphQLResponse = {
  data?: any;
  errors?: { message: string; locations: any }[];
};

export interface FilterState {
  keyword: string;
  productType: string;
  collectionHandle: string;
}

export interface Product {
  id: string;
  title: string;
  handle: string;
  productType: string;
  tags: string[];
}

export type Summary = {
  updated: number;
  alreadyHadTag?: number;
  didNotHaveTag?: number;
  failed: number;
  total: number;
  tag: string;
  action?: "apply" | "remove";
};

export interface BulkOperationStatus {
  id: string;
  status: string;
  objectCount: number;
  url?: string | null;
}

export interface LoaderData {
  products: Product[];
  totalCount: number;
  filters: FilterState;
  previewMode: boolean;
  error: string | null;
  bulkOperationStatus?: BulkOperationStatus;
  finalSummary: Summary | null;
}

export interface ActionData {
  success: boolean;
  error: string | null;
  bulkOperationId?: string;
  preRunSummary?: Summary;
}
