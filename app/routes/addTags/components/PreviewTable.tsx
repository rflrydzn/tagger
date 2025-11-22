import { Product } from "../types";
type PreviewTableProps = {
  products: Product[];
  totalCount: number;
  tagToApply: string;
};
export default function PreviewTable({
  products,
  totalCount,
  tagToApply,
}: PreviewTableProps) {
  return (
    <>
      <s-box>
        <s-text>
          Showing first {products.length} of{" "}
          <strong>{totalCount.toLocaleString()}</strong> estimated matching
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
            {products.map((product) => (
              <s-table-row key={product.id}>
                <s-table-cell>{product.title}</s-table-cell>
                <s-table-cell>{product.handle}</s-table-cell>
                <s-table-cell>{product.productType || "N/A"}</s-table-cell>
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
  );
}
