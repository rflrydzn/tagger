import { FilterState } from "../../types/types";

export const buildProductQuery = ({
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
