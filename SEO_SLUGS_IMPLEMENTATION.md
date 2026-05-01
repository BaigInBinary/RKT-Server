# SEO-Friendly Product Slugs - Implementation Guide

## Overview

This guide explains the SEO-friendly slug implementation for product URLs. The system maintains **full backward compatibility** with existing ID-based URLs while introducing clean, human-readable URLs.

## Features

✅ **Backward Compatible** - Old ID-based URLs (`/product/:id`) continue to work  
✅ **SEO-Friendly** - New slug-based URLs (`/product/:slug`)  
✅ **Automatic Generation** - Slugs auto-generated from product names  
✅ **Unique Enforcement** - Handles duplicate names with auto-incrementing suffixes  
✅ **Optional Redirects** - 301 redirects available for SEO benefits  
✅ **Clean Architecture** - Modular, well-tested utilities  

## What Was Changed

### 1. Database Schema
- **File**: `prisma/schema.prisma`
- **Change**: Added `slug String? @unique` field to Item model
- **Setup**: Need to run `npx prisma db push` (MongoDB doesn't use migrations)

### 2. Slug Generation Utilities
- **File**: `src/utils/slugUtils.ts`
- **Exports**:
  - `generateSlug(text)` - Generate URL-safe slug from text
  - `ensureUniqueSlug(baseSlug, excludeId?)` - Ensure slug uniqueness
  - `generateItemSlug(name, excludeId?)` - Generate unique item slug

### 3. Service Layer Updates
- **File**: `src/services/itemService.ts`
- **New Functions**:
  - `getCatalogItemBySlugOrId(slugOrId)` - Fetch by slug or ID (with fallback)
  - `getItemBySlugOrId(slugOrId)` - Fetch by slug or ID for admin
- **Modified Functions**:
  - `createItem()` - Auto-generates slug on creation
  - `updateItem()` - Auto-generates slug on name change

### 4. Controller Updates
- **File**: `src/controllers/itemController.ts`
- **Changes**: `getCatalogItem()` and `getItem()` now use slug-aware lookup

### 5. Optional Middleware
- **File**: `src/middlewares/slugRedirectMiddleware.ts`
- **Functions**:
  - `redirectToSlugIfMongoId` - 301 redirect from ID to slug (for SEO)
  - `trackIdBasedAccess` - Analytics tracking of legacy URL usage

### 6. Migration Script
- **File**: `src/scripts/migrateItemSlugs.ts`
- **Purpose**: Generates slugs for all existing products

## How To Use

### ⚠️ MongoDB Note

This project uses **MongoDB**, which doesn't support traditional Prisma migrations like SQL databases do.

- ✅ **Use**: `npx prisma db push` - Syncs schema directly to MongoDB
- ❌ **Don't use**: `npx prisma migrate dev` - This command only works for PostgreSQL, MySQL, SQLite

### Step 1: Sync Schema to MongoDB

```bash
cd RKT-Server
npx prisma db push
```

This will:
- Add the `slug` field to the Item model in MongoDB
- Regenerate Prisma Client with the new types
- No migration files needed for MongoDB (unlike SQL databases)

### Step 2: Migrate Existing Products

Generate slugs for all existing products without slugs:

```bash
npx tsx src/scripts/migrateItemSlugs.ts
```

Example output:
```
Starting item slug migration...
Found 150 items without slugs
✓ Updated item 123abc... - "Nike Air Max 90" → "nike-air-max-90" (1/150)
✓ Updated item 456def... - "Nike Air Max 90" → "nike-air-max-90-1" (2/150)
✓ Updated item 789ghi... - "Adidas Ultraboost" → "adidas-ultraboost" (3/150)
...
=== Migration Summary ===
✓ Success: 150
✗ Errors: 0
⊘ Skipped: 0
Total: 150
```

### Step 3: Start Using Slugs (Optional - Set Up Redirects)

To enable 301 redirects from ID-based to slug-based URLs, update your routes:

**Before:**
```typescript
router.get("/catalog/:id", itemController.getCatalogItem);
```

**After (with redirects):**
```typescript
import { redirectToSlugIfMongoId } from "../middlewares/slugRedirectMiddleware";

router.get("/catalog/:id", redirectToSlugIfMongoId, itemController.getCatalogItem);
```

## Usage Examples

### Fetching Products

All these URLs now work seamlessly:

```
GET /catalog/nike-air-max-90          ✓ By slug (new)
GET /catalog/507f1f77bcf86cd799439011 ✓ By ID (legacy, backward compatible)
GET /catalog/invalid-slug              ✗ Returns 404
```

### Creating New Products

When creating a new product:

```bash
POST /items
{
  "name": "Nike Air Max 90",
  "sku": "SKU-12345",
  "price": 99.99,
  ...
}
```

Response:
```json
{
  "id": "507f1f77bcf86cd799439011",
  "name": "Nike Air Max 90",
  "slug": "nike-air-max-90",
  "sku": "SKU-12345",
  ...
}
```

### Updating Product Names

When updating a product's name, the slug is automatically regenerated:

```bash
PUT /items/507f1f77bcf86cd799439011
{
  "name": "Nike Air Max 95"
}
```

The slug will automatically update to `nike-air-max-95`

### Edge Cases Handled

#### 1. Products with Special Characters
```
Name: "iPhone 15 Pro (Max)"
Slug: "iphone-15-pro-max"  ✓
```

#### 2. Products with Identical Names
```
Name: "T-Shirt"
Slug: "t-shirt"

Name: "T-Shirt" (duplicate)
Slug: "t-shirt-1"  ✓

Name: "T-Shirt" (another duplicate)
Slug: "t-shirt-2"  ✓
```

#### 3. Products with No/Invalid Names
```
Name: null or ""
Slug: null  → Must access via ID
```

## Architecture

### Slug Lookup Logic

The `getCatalogItemBySlugOrId()` function:

1. **Check if input is a slug** - If it doesn't look like a MongoDB ObjectId (24 hex chars)
   - Try to find item by slug
   - If found, return the item
2. **Fallback to ID lookup** - If slug lookup fails or input is an ID
   - Try to find item by ID
   - If found, return the item
3. **Not found** - Return null, resulting in 404

```
Input: "nike-air-max-90"
├─ Is it a MongoDB ID? No (contains letters, not 24 hex chars)
├─ Lookup by slug → Found!
└─ Return item

Input: "507f1f77bcf86cd799439011"
├─ Is it a MongoDB ID? Yes (24 hex chars)
├─ Lookup by ID → Found!
└─ Return item

Input: "invalid-slug"
├─ Is it a MongoDB ID? No
├─ Lookup by slug → Not found
├─ Try fallback ID lookup → Not found
└─ Return null (404)
```

### Optional: 301 Redirects

When `redirectToSlugIfMongoId` middleware is enabled:

```
Old Request:  GET /catalog/507f1f77bcf86cd799439011
              ↓
Middleware checks if ID has a slug
              ↓
Has slug?
├─ Yes → Redirect to /catalog/nike-air-max-90 (301)
└─ No  → Continue to handler (use ID-based lookup)
```

This is beneficial for SEO because:
- Search engines recognize 301 redirects as permanent moves
- The new slug-based URL gets indexed
- Old links still work for backward compatibility

## Performance Considerations

### Database Indexes

The `slug` field is `@unique` which automatically creates an index, making slug lookups fast.

### Query Strategy

The lookup logic is efficient:
- For most requests (modern clients), it tries slug lookup first (indexed)
- For legacy requests, it falls back to ID lookup (indexed)
- No N+1 queries or unnecessary database calls

## Important Notes

⚠️ **Before Running Migration Script:**
- Backup your database
- Test in development environment first
- The script is safe - it only updates items without slugs
- Existing slugs are never overwritten

⚠️ **Slug Generation Rules:**
- Slugs are lowercase
- Special characters are removed
- Spaces become hyphens
- Consecutive hyphens are collapsed
- Leading/trailing hyphens are removed

⚠️ **Backward Compatibility:**
- Old ID-based URLs never break
- No configuration changes required
- Redirects are optional (enabled per-route)

## Testing

### Manual Testing

```bash
# Create a new product
curl -X POST http://localhost:3000/items \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Product", "sku": "TEST-001", "price": 29.99}'

# Response will include the generated slug
# Copy the returned slug and ID

# Access by slug
curl http://localhost:3000/catalog/test-product

# Access by ID (legacy)
curl http://localhost:3000/catalog/507f1f77bcf86cd799439011

# Both should return the same product
```

### Running the Test Suite

```bash
npm run test
```

## Troubleshooting

### Issue: "slug" field not found in queries
**Solution**: Run the Prisma migration: `npx prisma migrate dev`

### Issue: Migration script creates no slugs
**Solution**: 
1. Check if items already have slugs: `db.items.countDocuments({slug: {$exists: false}})`
2. If count is 0, all items already have slugs
3. To regenerate all slugs, manually set them to null first

### Issue: Duplicate slug errors when creating items
**Solution**: This shouldn't happen with the auto-generation logic. If it does:
1. Check if slug field has proper unique constraint
2. Run `npx prisma db push` to sync schema with database

## FAQ

**Q: Do I need to update my frontend URLs?**  
A: No! Both old ID-based URLs and new slug-based URLs work. You can gradually update your frontend to use slugs.

**Q: Can I manually set slugs?**  
A: Yes, but slugs will be auto-generated if not provided. Manual slugs must be unique.

**Q: What if a product has no name?**  
A: It will have a null slug and must be accessed by ID. The name field is required for most use cases anyway.

**Q: Will old bookmarks break?**  
A: No! Old URLs with IDs continue to work. Users with old bookmarks will be served the same product.

**Q: Can I change a slug manually?**  
A: Yes, but it's better to change the product name, which will auto-generate a new slug.

**Q: What about SEO?**  
A: Use the optional redirect middleware to redirect ID-based URLs to slug-based URLs with 301 redirects. This signals to search engines that the new slug is the canonical URL.

## Next Steps

1. ✅ Run database migration: `npx prisma migrate dev --name add_item_slug`
2. ✅ Run migration script: `npx tsx src/scripts/migrateItemSlugs.ts`
3. ✅ (Optional) Enable redirects by adding middleware to routes
4. ✅ Update frontend to use slug-based URLs (gradually)
5. ✅ Monitor old URL access patterns using the tracking middleware

## Support

For questions or issues, refer to:
- Slug utilities: [src/utils/slugUtils.ts](src/utils/slugUtils.ts)
- Service functions: [src/services/itemService.ts](src/services/itemService.ts)
- Migration script: [src/scripts/migrateItemSlugs.ts](src/scripts/migrateItemSlugs.ts)
- Redirect middleware: [src/middlewares/slugRedirectMiddleware.ts](src/middlewares/slugRedirectMiddleware.ts)
