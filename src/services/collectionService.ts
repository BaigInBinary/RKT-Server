import prisma from "../config/prisma";
import {
  CollectionSubCategoryMode,
  Discount,
  DiscountScope,
  DiscountType,
  Prisma,
} from "@prisma/client";

export interface CollectionSubCategoryInput {
  subCategoryId: string;
  mode: CollectionSubCategoryMode;
  itemIds?: string[];
}

export interface CreateCollectionInput {
  name: string;
  slug: string;
  bannerImage: string;
  isActive?: boolean;
  categoryIds?: string[];
  subCategories?: CollectionSubCategoryInput[];
  directItemIds?: string[];
}

export type UpdateCollectionInput = Partial<CreateCollectionInput>;

interface PaginatedInput {
  page?: number;
  limit?: number;
  search?: string;
}

type PublicCollectionRecord = {
  id: string;
  name: string;
  slug: string;
  bannerImage: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type ListingItemRecord = {
  id: string;
  slug: string | null;
  name: string;
  sku: string;
  category: string;
  subCategoryId: string | null;
  imageUrl: string | null;
  galleryImages: string[];
  shortDescription: string | null;
  productType: string | null;
  vendor: string | null;
  tags: string[];
  variants: Prisma.JsonValue;
  weightInGrams: number | null;
  isFreeDelivery: boolean | null;
  quantity: number;
  price: number;
  createdAt: Date;
  updatedAt: Date;
  showOnMainSite: boolean | null;
};

type ListingItemResponse = Omit<ListingItemRecord, "price" | "showOnMainSite"> & {
  pricing: {
    originalPrice: number;
    finalPrice: number;
    discountAmount: number;
    discountPercent: number;
    hasDiscount: boolean;
    appliedDiscounts: Array<{
      id: string;
      name: string;
      amount: number;
    }>;
  };
};

const AUTO_COLLECTIONS = [
  {
    id: "virtual-top-collection",
    name: "Top Collection",
    slug: "top-collection",
    bannerImage: "/assets/collection-gaming.jpg",
  },
  {
    id: "virtual-summer-sale",
    name: "Summer Sale",
    slug: "summer-sale",
    bannerImage: "/assets/product-printer.jpg",
  },
] satisfies Array<Pick<PublicCollectionRecord, "id" | "name" | "slug" | "bannerImage">>;

const AUTO_COLLECTION_SLUGS = new Set(AUTO_COLLECTIONS.map((collection) => collection.slug));

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const uniqueStrings = (values?: string[]) =>
  Array.from(new Set((values || []).map((v) => v.trim()).filter(Boolean)));

const isMongoObjectId = (value: string) => /^[0-9a-fA-F]{24}$/.test(value);
const isVisibleOnMainSite = (item: { showOnMainSite?: boolean | null }) =>
  item.showOnMainSite !== false;

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const isDiscountActive = (discount: Discount, at: Date) => {
  if (!discount.isActive) {
    return false;
  }
  if (discount.startDate && discount.startDate > at) {
    return false;
  }
  if (discount.endDate && discount.endDate < at) {
    return false;
  }
  return true;
};

const matchesDiscountScope = (
  discount: Discount,
  item: { id: string; category: string; subCategoryId: string | null },
) => {
  switch (discount.scope) {
    case DiscountScope.ALL:
      return true;
    case DiscountScope.CATEGORY:
      return item.category === discount.targetCategory;
    case DiscountScope.SUBCATEGORY:
      return Boolean(
        item.subCategoryId && item.subCategoryId === discount.targetSubCategoryId,
      );
    case DiscountScope.ITEM:
      return item.id === discount.targetItemId;
    default:
      return false;
  }
};

const parsePurchaseRules = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const row = entry as Record<string, unknown>;
      const minPurchaseValue = Number(row.minPurchaseValue);
      const discountAmount = Number(row.discountAmount);
      if (!Number.isFinite(minPurchaseValue) || !Number.isFinite(discountAmount)) {
        return null;
      }
      if (minPurchaseValue < 0 || discountAmount < 0) {
        return null;
      }
      return {
        minPurchaseValue,
        discountAmount,
      };
    })
    .filter(
      (entry): entry is { minPurchaseValue: number; discountAmount: number } => !!entry,
    )
    .sort((a, b) => b.minPurchaseValue - a.minPurchaseValue);
};

const computeDiscountAmount = (discount: Discount, subtotal: number) => {
  if (subtotal <= 0 || subtotal < discount.minimumPurchaseValue) {
    return 0;
  }

  if (discount.discountType === DiscountType.FLAT) {
    return Math.min(round2(discount.discountValue ?? 0), subtotal);
  }

  if (discount.discountType === DiscountType.PERCENTAGE) {
    const percentage = discount.discountValue ?? 0;
    return Math.min(round2((subtotal * percentage) / 100), subtotal);
  }

  const rules = parsePurchaseRules(discount.purchaseValueRules);
  const matched = rules.find((rule) => subtotal >= rule.minPurchaseValue);
  if (!matched) {
    return 0;
  }

  return Math.min(round2(matched.discountAmount), subtotal);
};

const applyListingDiscounts = (
  basePrice: number,
  item: { id: string; category: string; subCategoryId: string | null },
  discounts: Discount[],
) => {
  let remainingPrice = round2(basePrice);
  const applied: Array<{ id: string; name: string; amount: number }> = [];

  for (const discount of discounts) {
    if (!matchesDiscountScope(discount, item)) {
      continue;
    }

    const amount = computeDiscountAmount(discount, remainingPrice);
    if (amount <= 0) {
      continue;
    }

    remainingPrice = round2(Math.max(0, remainingPrice - amount));
    applied.push({ id: discount.id, name: discount.name, amount });
  }

  const discountAmount = round2(basePrice - remainingPrice);
  const discountPercent = basePrice > 0 ? round2((discountAmount / basePrice) * 100) : 0;

  return {
    originalPrice: round2(basePrice),
    finalPrice: remainingPrice,
    discountAmount,
    discountPercent,
    hasDiscount: discountAmount > 0,
    appliedDiscounts: applied,
  };
};

const getActiveListingDiscounts = async () => {
  const now = new Date();
  const activeDiscounts = await prisma.discount.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });

  return activeDiscounts.filter((discount) => isDiscountActive(discount, now));
};

const buildListingSelect = {
  id: true,
  slug: true,
  name: true,
  sku: true,
  category: true,
  subCategoryId: true,
  imageUrl: true,
  galleryImages: true,
  shortDescription: true,
  productType: true,
  vendor: true,
  tags: true,
  variants: true,
  weightInGrams: true,
  isFreeDelivery: true,
  quantity: true,
  price: true,
  createdAt: true,
  updatedAt: true,
  showOnMainSite: true,
} as const;

const buildListingResponse = (
  item: ListingItemRecord,
  discounts: Discount[],
): ListingItemResponse => {
  const pricing = applyListingDiscounts(
    item.price,
    {
      id: item.id,
      category: item.category,
      subCategoryId: item.subCategoryId,
    },
    discounts,
  );

  return {
    id: item.id,
    slug: item.slug,
    name: item.name,
    sku: item.sku,
    category: item.category,
    subCategoryId: item.subCategoryId,
    imageUrl: item.imageUrl,
    galleryImages: item.galleryImages || [],
    shortDescription: item.shortDescription,
    productType: item.productType,
    vendor: item.vendor,
    tags: item.tags || [],
    variants: item.variants || null,
    weightInGrams: item.weightInGrams,
    isFreeDelivery: item.isFreeDelivery,
    quantity: item.quantity,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    pricing,
  };
};

const isTopCollectionItem = (item: ListingItemResponse) =>
  Math.round(item.pricing.discountPercent) === 30;

const isSummerSaleItem = (item: ListingItemResponse) =>
  item.pricing.discountPercent > 0 && item.pricing.discountPercent <= 40.0001;

const filterVirtualCollectionItems = (
  collectionSlug: string,
  items: ListingItemResponse[],
) => {
  if (collectionSlug === "top-collection") {
    return items.filter(isTopCollectionItem);
  }
  if (collectionSlug === "summer-sale") {
    return items.filter(isSummerSaleItem);
  }
  return items;
};

const getVirtualCollectionBySlug = (slug: string) =>
  AUTO_COLLECTIONS.find((collection) => collection.slug === slug) || null;

const getAllVisibleListingItems = async () => {
  const [items, discounts] = await Promise.all([
    prisma.item.findMany({
      orderBy: { createdAt: "desc" },
      select: buildListingSelect,
    }),
    getActiveListingDiscounts(),
  ]);

  return items
    .filter(isVisibleOnMainSite)
    .map((item) => buildListingResponse(item as ListingItemRecord, discounts));
};

const buildPublicCollectionIdentifierFilter = (
  idOrSlug: string,
): Prisma.CollectionWhereInput => {
  if (isMongoObjectId(idOrSlug)) {
    return {
      OR: [{ id: idOrSlug }, { slug: idOrSlug }],
    };
  }

  return { slug: idOrSlug };
};

const loadResolvedItemIds = async (collectionId: string) => {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    include: {
      categories: {
        include: {
          category: true,
        },
      },
      subCategorySelections: {
        include: {
          selectedItems: true,
        },
      },
      directItems: true,
    },
  });

  if (!collection) {
    throw new Error("Collection not found");
  }

  const ids = new Set<string>();
  collection.directItems.forEach((entry) => ids.add(entry.itemId));

  // Include all products from categories selected as "whole category" in admin.
  const selectedCategoryNames = collection.categories
    .map((entry) => entry.category?.name?.trim())
    .filter((name): name is string => !!name);
  if (selectedCategoryNames.length > 0) {
    const categoryItems = await prisma.item.findMany({
      where: {
        category: { in: selectedCategoryNames },
      },
      select: { id: true, showOnMainSite: true },
    });
    categoryItems.filter(isVisibleOnMainSite).forEach((item) => ids.add(item.id));
  }

  const allSubCategoryIds = collection.subCategorySelections
    .filter((entry) => entry.mode === CollectionSubCategoryMode.ALL_ITEMS)
    .map((entry) => entry.subCategoryId);

  if (allSubCategoryIds.length > 0) {
    const items = await prisma.item.findMany({
      where: {
        subCategoryId: { in: allSubCategoryIds },
      },
      select: { id: true, showOnMainSite: true },
    });
    items.filter(isVisibleOnMainSite).forEach((item) => ids.add(item.id));
  }

  collection.subCategorySelections
    .filter((entry) => entry.mode === CollectionSubCategoryMode.SELECTED_ITEMS)
    .forEach((entry) => {
      entry.selectedItems.forEach((selected) => ids.add(selected.itemId));
    });

  return Array.from(ids);
};

const loadCollectionItems = async (collectionId: string) => {
  const itemIds = await loadResolvedItemIds(collectionId);
  if (itemIds.length === 0) {
    return [];
  }

  const [items, discounts] = await Promise.all([
    prisma.item.findMany({
      where: { id: { in: itemIds } },
      orderBy: { createdAt: "desc" },
      select: buildListingSelect,
    }),
    getActiveListingDiscounts(),
  ]);

  return items
    .filter(isVisibleOnMainSite)
    .map((item) => buildListingResponse(item as ListingItemRecord, discounts));
};

const findCollectionBySlugPublic = async (slug: string) => {
  const virtualCollection = getVirtualCollectionBySlug(slug);
  if (virtualCollection) {
    return {
      ...virtualCollection,
      isActive: true,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    } satisfies PublicCollectionRecord;
  }

  return prisma.collection.findFirst({
    where: {
      AND: [{ isActive: true }, { slug }],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      bannerImage: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });
};

const validateAndNormalizePayload = async (
  payload: CreateCollectionInput | UpdateCollectionInput,
  forUpdate: boolean,
) => {
  const normalized = {
    name: payload.name?.trim(),
    slug: payload.slug ? slugify(payload.slug) : undefined,
    bannerImage: payload.bannerImage?.trim(),
    isActive: payload.isActive,
    categoryIds: uniqueStrings(payload.categoryIds),
    directItemIds: uniqueStrings(payload.directItemIds),
    subCategories: (payload.subCategories || []).map((entry) => ({
      subCategoryId: entry.subCategoryId?.trim(),
      mode: entry.mode,
      itemIds: uniqueStrings(entry.itemIds),
    })),
  };

  if (!forUpdate) {
    if (!normalized.name) {
      throw new Error("name is required");
    }
    if (!normalized.slug) {
      throw new Error("slug is required");
    }
    if (!normalized.bannerImage) {
      throw new Error("bannerImage is required");
    }
  }

  if (normalized.slug && normalized.slug.length < 2) {
    throw new Error("slug must be at least 2 characters");
  }

  return normalized;
};

const validateReferences = async (payload: {
  categoryIds: string[];
  directItemIds: string[];
  subCategories: Array<{
    subCategoryId?: string;
    mode: CollectionSubCategoryMode;
    itemIds: string[];
  }>;
}) => {
  if (payload.categoryIds.length > 0) {
    const categories = await prisma.category.findMany({
      where: { id: { in: payload.categoryIds } },
      select: { id: true },
    });
    if (categories.length !== payload.categoryIds.length) {
      throw new Error("One or more categoryIds are invalid");
    }
  }

  if (payload.directItemIds.length > 0) {
    const items = await prisma.item.findMany({
      where: { id: { in: payload.directItemIds } },
      select: { id: true },
    });
    if (items.length !== payload.directItemIds.length) {
      throw new Error("One or more directItemIds are invalid");
    }
  }

  const subCategoryIds = payload.subCategories
    .map((entry) => entry.subCategoryId)
    .filter((id): id is string => !!id);
  if (subCategoryIds.length > 0) {
    const subs = await prisma.subCategory.findMany({
      where: { id: { in: subCategoryIds } },
      select: { id: true, categoryId: true },
    });
    if (subs.length !== subCategoryIds.length) {
      throw new Error("One or more subCategoryIds are invalid");
    }

    const subById = new Map(subs.map((entry) => [entry.id, entry]));
    for (const subInput of payload.subCategories) {
      if (!subInput.subCategoryId) {
        throw new Error("subCategoryId is required in subCategories");
      }
      const sub = subById.get(subInput.subCategoryId);
      if (!sub) {
        throw new Error("Invalid subCategoryId");
      }

      if (
        payload.categoryIds.length > 0 &&
        !payload.categoryIds.includes(sub.categoryId)
      ) {
        throw new Error("Subcategory must belong to one of selected categories");
      }

      if (subInput.mode === CollectionSubCategoryMode.SELECTED_ITEMS) {
        if (subInput.itemIds.length === 0) {
          throw new Error(
            "SELECTED_ITEMS mode requires at least one itemId",
          );
        }
        const selectedItems = await prisma.item.findMany({
          where: {
            id: { in: subInput.itemIds },
            subCategoryId: subInput.subCategoryId,
          },
          select: { id: true },
        });
        if (selectedItems.length !== subInput.itemIds.length) {
          throw new Error(
            "All selected itemIds must exist and belong to the subcategory",
          );
        }
      }
    }
  }
};

const buildCollectionCreateData = (
  normalized: Awaited<ReturnType<typeof validateAndNormalizePayload>>,
): Prisma.CollectionCreateInput => {
  const categoryIds = normalized.categoryIds;
  const directItemIds = normalized.directItemIds;
  const subCategories = normalized.subCategories;

  return {
    name: normalized.name!,
    slug: normalized.slug!,
    bannerImage: normalized.bannerImage!,
    isActive: normalized.isActive ?? true,
    categories:
      categoryIds.length > 0
        ? {
            create: categoryIds.map((categoryId) => ({
              category: { connect: { id: categoryId } },
            })),
          }
        : undefined,
    directItems:
      directItemIds.length > 0
        ? {
            create: directItemIds.map((itemId) => ({ itemId })),
          }
        : undefined,
    subCategorySelections:
      subCategories.length > 0
        ? {
            create: subCategories.map((entry) => ({
              subCategory: { connect: { id: entry.subCategoryId! } },
              mode: entry.mode,
              selectedItems:
                entry.mode === CollectionSubCategoryMode.SELECTED_ITEMS
                  ? {
                      create: entry.itemIds.map((itemId) => ({ itemId })),
                    }
                  : undefined,
            })),
          }
        : undefined,
  };
};

export const listCollectionsPublic = async () => {
  const collections = await prisma.collection.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      bannerImage: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const filteredCollections = collections.filter(
    (collection) => !AUTO_COLLECTION_SLUGS.has(collection.slug),
  );

  return [
    ...AUTO_COLLECTIONS.map((collection) => ({
      ...collection,
      isActive: true,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })),
    ...filteredCollections,
  ];
};

export const getCollectionByIdPublic = async (idOrSlug: string) => {
  if (!isMongoObjectId(idOrSlug)) {
    return findCollectionBySlugPublic(idOrSlug);
  }

  return prisma.collection.findFirst({
    where: {
      AND: [
        { isActive: true },
        buildPublicCollectionIdentifierFilter(idOrSlug),
      ],
    },
    include: {
      categories: {
        include: { category: true },
      },
      subCategorySelections: {
        include: {
          subCategory: true,
          selectedItems: true,
        },
      },
      directItems: true,
    },
  });
};

export const getCollectionItemsPublic = async (
  idOrSlug: string,
  query: PaginatedInput,
) => {
  const page = Number.isFinite(query.page) ? Math.max(1, Math.floor(query.page as number)) : 1;
  const limit = Number.isFinite(query.limit) ? Math.min(100, Math.max(1, Math.floor(query.limit as number))) : 20;

  const collection = await getCollectionByIdPublic(idOrSlug);
  if (!collection) {
    throw new Error("Collection not found");
  }

  let items: ListingItemResponse[] = [];

  if (AUTO_COLLECTION_SLUGS.has(collection.slug)) {
    items = filterVirtualCollectionItems(
      collection.slug,
      await getAllVisibleListingItems(),
    );
  } else {
    items = await loadCollectionItems(collection.id);
  }

  const searchedItems = query.search && query.search.trim()
    ? items.filter((item) => {
        const term = query.search!.trim().toLowerCase();
        return (
          item.name.toLowerCase().includes(term) ||
          item.sku.toLowerCase().includes(term) ||
          item.category.toLowerCase().includes(term)
        );
      })
    : items;

  const totalItems = searchedItems.length;
  const paginatedItems = searchedItems.slice((page - 1) * limit, page * limit);

  return {
    data: paginatedItems,
    meta: {
      page,
      limit,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / limit)),
    },
  };
};

export const listCollectionsAdmin = async () => {
  return prisma.collection.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      categories: { include: { category: true } },
      subCategorySelections: { include: { subCategory: true, selectedItems: true } },
      directItems: true,
    },
  });
};

export const createCollection = async (payload: CreateCollectionInput) => {
  const normalized = await validateAndNormalizePayload(payload, false);
  await validateReferences({
    categoryIds: normalized.categoryIds,
    directItemIds: normalized.directItemIds,
    subCategories: normalized.subCategories,
  });

  return prisma.collection.create({
    data: buildCollectionCreateData(normalized),
    include: {
      categories: { include: { category: true } },
      subCategorySelections: { include: { subCategory: true, selectedItems: true } },
      directItems: true,
    },
  });
};

export const updateCollection = async (
  id: string,
  payload: UpdateCollectionInput,
) => {
  const existing = await prisma.collection.findUnique({ where: { id } });
  if (!existing) {
    throw new Error("Collection not found");
  }

  const normalized = await validateAndNormalizePayload(
    {
      name: payload.name ?? existing.name,
      slug: payload.slug ?? existing.slug,
      bannerImage: payload.bannerImage ?? existing.bannerImage,
      isActive: payload.isActive ?? existing.isActive,
      categoryIds: payload.categoryIds ?? [],
      subCategories: payload.subCategories ?? [],
      directItemIds: payload.directItemIds ?? [],
    },
    true,
  );
  await validateReferences({
    categoryIds: normalized.categoryIds,
    directItemIds: normalized.directItemIds,
    subCategories: normalized.subCategories,
  });

  return prisma.$transaction(async (tx) => {
    await tx.collectionCategorySelection.deleteMany({ where: { collectionId: id } });
    const selectionRows = await tx.collectionSubCategorySelection.findMany({
      where: { collectionId: id },
      select: { id: true },
    });
    if (selectionRows.length > 0) {
      await tx.collectionSubCategoryItem.deleteMany({
        where: {
          subCategorySelectionId: {
            in: selectionRows.map((entry) => entry.id),
          },
        },
      });
    }
    await tx.collectionSubCategorySelection.deleteMany({ where: { collectionId: id } });
    await tx.collectionItemSelection.deleteMany({ where: { collectionId: id } });

    return tx.collection.update({
      where: { id },
      data: {
        name: normalized.name,
        slug: normalized.slug,
        bannerImage: normalized.bannerImage,
        isActive: normalized.isActive,
        categories:
          normalized.categoryIds.length > 0
            ? {
                create: normalized.categoryIds.map((categoryId) => ({
                  category: { connect: { id: categoryId } },
                })),
              }
            : undefined,
        directItems:
          normalized.directItemIds.length > 0
            ? {
                create: normalized.directItemIds.map((itemId) => ({ itemId })),
              }
            : undefined,
        subCategorySelections:
          normalized.subCategories.length > 0
            ? {
                create: normalized.subCategories.map((entry) => ({
                  subCategory: { connect: { id: entry.subCategoryId! } },
                  mode: entry.mode,
                  selectedItems:
                    entry.mode === CollectionSubCategoryMode.SELECTED_ITEMS
                      ? { create: entry.itemIds.map((itemId) => ({ itemId })) }
                      : undefined,
                })),
              }
            : undefined,
      },
      include: {
        categories: { include: { category: true } },
        subCategorySelections: { include: { subCategory: true, selectedItems: true } },
        directItems: true,
      },
    });
  });
};

export const deleteCollection = async (id: string) => {
  const [, , , , deletedCollection] = await prisma.$transaction([
    prisma.collectionSubCategoryItem.deleteMany({
      where: {
        subCategorySelection: {
          is: {
            collectionId: id,
          },
        },
      },
    }),
    prisma.collectionCategorySelection.deleteMany({ where: { collectionId: id } }),
    prisma.collectionSubCategorySelection.deleteMany({ where: { collectionId: id } }),
    prisma.collectionItemSelection.deleteMany({ where: { collectionId: id } }),
    prisma.collection.delete({ where: { id } }),
  ]);

  return deletedCollection;
};
