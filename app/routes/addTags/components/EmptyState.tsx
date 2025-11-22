import { LegacyCard, EmptyState } from "@shopify/polaris";

export default function EmptyStateView() {
  return (
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
  );
}
