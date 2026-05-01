# Quick Start: SEO Slugs Implementation

## TL;DR - 3 Steps to Enable

### 1️⃣ Sync Database Schema (MongoDB)
```bash
cd RKT-Server
npx prisma db push
```

### 2️⃣ Migrate Existing Products
```bash
npx tsx src/scripts/migrateItemSlugs.ts
```

### 3️⃣ (Optional) Enable Redirects
Update `src/routes/itemRoutes.ts`:
```typescript
import { redirectToSlugIfMongoId } from "../middlewares/slugRedirectMiddleware";

router.get("/catalog/:id", redirectToSlugIfMongoId, itemController.getCatalogItem);
```

---

## What Works Now

| URL Format | Works? | Notes |
|---|---|---|
| `/catalog/nike-air-max-90` | ✅ | **New** - SEO-friendly |
| `/catalog/507f1f77bcf86cd799439011` | ✅ | **Old** - Still works (backward compatible) |
| `POST /items` + create | ✅ | Slug auto-generated from name |
| `PUT /items/:id` + update name | ✅ | Slug auto-updated |

---

## Key Functions

### For Developers

**Get product by slug or ID:**
```typescript
import * as itemService from '../services/itemService';

const product = await itemService.getCatalogItemBySlugOrId('nike-air-max-90');
const product = await itemService.getCatalogItemBySlugOrId('507f1f77bcf86cd799439011');
// Both work!
```

**Generate slug:**
```typescript
import { generateItemSlug } from '../utils/slugUtils';

const slug = await generateItemSlug('Nike Air Max 90');
// Returns: "nike-air-max-90"
```

**Track legacy access (optional):**
```typescript
import { trackIdBasedAccess } from '../middlewares/slugRedirectMiddleware';

router.get("/catalog/:id", trackIdBasedAccess, handler);
```

---

## Files Added/Modified

| File | Status | Purpose |
|---|---|---|
| `prisma/schema.prisma` | ✏️ Modified | Added `slug` field to Item |
| `src/utils/slugUtils.ts` | ✨ New | Slug generation utilities |
| `src/services/itemService.ts` | ✏️ Modified | Added slug-aware lookup functions |
| `src/controllers/itemController.ts` | ✏️ Modified | Updated to use slug-aware functions |
| `src/middlewares/slugRedirectMiddleware.ts` | ✨ New | Optional redirects + tracking |
| `src/scripts/migrateItemSlugs.ts` | ✨ New | Migration script |
| `SEO_SLUGS_IMPLEMENTATION.md` | ✨ New | Full implementation guide |

---

## Edge Cases Covered

✅ Duplicate product names → Auto-incrementing slugs (`nike-air-max-90-1`, `nike-air-max-90-2`)  
✅ Special characters → Removed safely (`iPhone 15 Pro (Max)` → `iphone-15-pro-max`)  
✅ Products with no name → No slug generated, must access by ID  
✅ Existing IDs → Always work for backward compatibility  
✅ URL path parameters that are MongoDB IDs → Smart detection + fallback  

---

## Testing

```bash
# Create product
curl -X POST http://localhost:3000/items \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Product",
    "sku": "TEST-001",
    "price": 29.99,
    "quantity": 10,
    "minStock": 1,
    "costPrice": 15.00,
    "category": "Electronics"
  }'

# Access by slug (new way)
curl http://localhost:3000/catalog/test-product

# Access by ID (old way - still works!)
curl http://localhost:3000/catalog/[RETURNED_ID]
```

---

## ⚠️ Important Notes

- **Backup** your database before running migrations
- **Test** in development first
- **No breaking changes** - backward compatible with old URLs
- **Gradual rollout** - update frontend links over time
- **SEO benefit** - Use 301 redirects for better search engine crawling

---

## Troubleshooting

| Problem | Solution |
|---|---|
| "slug field not found" | Run `npx prisma migrate dev` |
| Migration script finds 0 items | All items likely already have slugs |
| Duplicate slug error on create | Shouldn't happen - check schema |
| Want to regenerate all slugs | Set all slugs to null in DB first |

---

## Need More Help?

See `SEO_SLUGS_IMPLEMENTATION.md` for:
- Detailed architecture explanation
- Performance considerations
- Advanced configurations
- FAQ section
