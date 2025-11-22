type FilterSidebarProps = {
  keyword: string;
  onKeywordChange: (newValue: string) => void;
  isSubmitting: boolean;
  productType: string;
  onProductTypeChange: (newValue: string) => void;
  collectionHandle: string;
  onCollectionHandleChange: (newValue: string) => void;
  onPreview: () => void;
  onClearFilters: () => void;
  isApplyingTag: boolean;
  isPreviewing: boolean;
};
export default function FilterSidebar({
  keyword,
  onKeywordChange,
  isSubmitting,
  isPreviewing,
  isApplyingTag,
  productType,
  onProductTypeChange,
  collectionHandle,
  onCollectionHandleChange,
  onPreview,
  onClearFilters,
}: FilterSidebarProps) {
  return (
    <s-section slot="aside" heading="Filter Products">
      <s-text-field
        label="Search by keyword"
        value={keyword}
        onChange={(e) => onKeywordChange(e.currentTarget.value)}
        placeholder="e.g., shirt, vintage, 2024"
        disabled={isSubmitting}
      />
      <s-text-field
        label="Search by product type"
        value={productType}
        onChange={(e) => onProductTypeChange(e.currentTarget.value)}
        placeholder="e.g., Shirts, Pants"
        disabled={isSubmitting}
      />
      <s-text-field
        label="Search by collection"
        value={collectionHandle}
        onChange={(e) => onCollectionHandleChange(e.currentTarget.value)}
        placeholder="e.g., summer-collection"
        disabled={isSubmitting}
      />
      <s-button
        variant="primary"
        onClick={onPreview}
        loading={isPreviewing}
        disabled={isApplyingTag}
      >
        Preview Matches
      </s-button>

      <s-button
        variant="secondary"
        onClick={onClearFilters}
        disabled={isSubmitting}
      >
        Clear all filters
      </s-button>
    </s-section>
  );
}
