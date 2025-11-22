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
  const isFilterActive =
    keyword.trim().length > 0 ||
    productType.trim().length > 0 ||
    collectionHandle.trim().length > 0;

  // 2. The button should be disabled if:
  //    a) No filter is currently active (isFilterActive is false) AND no operation is running, OR
  //    b) An operation (isSubmitting or isApplyingTag) is currently running.
  const isPreviewDisabled = isSubmitting || isApplyingTag || !isFilterActive;
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
        disabled={isPreviewDisabled}
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
