# 🏷️ Shopify Product Tagger App

A Shopify-embedded application that allows merchants to **filter products** and **bulk-apply tags** using the Shopify **Bulk Operations API**, designed for speed, safety, and idempotency.

---

## 🧰 Prerequisites

Before you begin, you'll need the following:

1. **Node.js**: [Download and install](https://nodejs.org/en/download/) it if you haven't already.
2. **Shopify Partner Account**: [Create an account](https://partners.shopify.com/signup) if you don't have one.
3. **Test Store**: Set up either a
   - [Development Store](https://help.shopify.com/en/partners/dashboard/development-stores#create-a-development-store), or
   - [Shopify Plus Sandbox Store](https://help.shopify.com/en/partners/dashboard/managing-stores/plus-sandbox-store)
4. **Shopify CLI**: [Install the CLI](https://shopify.dev/docs/apps/tools/cli/getting-started)

```shell
npm install -g @shopify/cli@latest
```

---

## 📦 Installation

### 1. Clone the Repository

```bash
git clone https://github.com/rflrydzn/tagger.git
cd tagger
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Shopify App

Update `shopify.app.toml`:

```toml
client_id = "YOUR_API_KEY"
name = "tagger"
application_url = "https://app-tagger.myshopify.com"
embedded = true

[build]
automatically_update_urls_on_dev = true
include_config_on_deploy = true

[webhooks]
api_version = "2026-01"

  [[webhooks.subscriptions]]
  topics = [ "app/uninstalled" ]
  uri = "/webhooks/app/uninstalled"

  [[webhooks.subscriptions]]
  topics = [ "app/scopes_update" ]
  uri = "/webhooks/app/scopes_update"

[access_scopes]
scopes = "read_products,write_products"

[auth]
redirect_urls = [ "https://app-tagger.myshopify/api/auth" ]
```

### 4. Run the Development Server

```bash
npm run dev
```

The CLI will open a browser window to authenticate and install the app on your development store.

---

## 📌 Features

### 🔍 Filter Products

- Keyword search (in title)
- Product type
- Collection handle

### 👁️ Preview Results

- Total matched product count
- Preview of first 10 products

### 🏷️ Bulk Tagging

- Apply a custom tag to thousands of products
- Uses Shopify Bulk Operations API
- Idempotent: skips products already containing the tag
- Safe to re-run

---

## 🏗️ Architecture Overview

### 1. **Preview Flow**

- User enters filters → clicks Preview
- Server fetches all matching products via GraphQL pagination
- Returns:
  - Total count
  - First 10 sample products

### 2. **Tag Application Flow**

- Client sends POST request to action
- App:
  - Fetches all products again
  - Filters out products already tagged
  - Generates JSONL file of `productUpdate` mutations
  - Starts Bulk Operation
  - Returns operation ID

### 3. **Polling Flow**

- Client polls loader every few seconds
- When bulk job finishes:
  - Results JSONL file downloaded
  - Mutations parsed
  - Final summary returned

---

## 🚦 Pagination & Rate Limits

### GraphQL Pagination

- Fetches products in pages of 250
- Follows `hasNextPage` and `cursor`
- Includes delay to avoid rate limits

### bulkOperationRunMutation

- Passes all mutations to Shopify background worker
- Runs async to prevent Error 524 (120s of no HTTP response)
- Efficient and fast bulk tagging instead of synchronus one by one

---

## 🛡️ Idempotency

```ts
const productsToUpdate = allProducts.filter(
  (product) =>
    !product.tags.some((tag) => tag.toLowerCase() === TAG.toLowerCase()),
);
```

Ensures re-running the same tag operation is **safe**.

---

## 📂 Simplified File Structure

```
/app
  /routes
    /addTags
      /components
        ConfirmationModa.tsx
        EmptyState.tsx
        FilterSidebar.tsx
        PreviewTable.tsx
        SummaryBanner.tsx
        TagSidebar.tsx
      app.server.ts
      bulkResultsProcessor.ts
      loader.server.ts
      queryBuilder.ts
      shopifyApi.ts
      stateManager.ts
    app.addTags.tsx
  /types
    admin.generated.d.ts
    admin.types.d.ts
    types.ts

```
