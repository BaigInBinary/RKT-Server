import prisma from "../config/prisma";
import { Discount, DiscountScope, DiscountType, Item, Prisma } from "@prisma/client";

export type CreateItemInput = Prisma.ItemCreateInput;
export type UpdateItemInput = Prisma.ItemUpdateInput;

export type CatalogSortBy = "createdAt" | "price" | "name" | "soldCount";
export type CatalogSortOrder = "asc" | "desc";

export interface CatalogQueryInput {
  page?: number;
  limit?: number;
  search?: string;
  categories?: string[];
  subCategoryIds?: string[];
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
  sortBy?: CatalogSortBy;
  sortOrder?: CatalogSortOrder;
}

export interface TopSellingQueryInput {
  hours?: number;
  limit?: number;
}

type PurchaseRule = {
  minPurchaseValue: number;
  discountAmount: number;
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const isVisibleOnMainSite = (item: { showOnMainSite?: boolean | null }) =>
  item.showOnMainSite !== false;

const parsePurchaseRules = (value: unknown): PurchaseRule[] => {
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
      return { minPurchaseValue, discountAmount };
    })
    .filter((entry): entry is PurchaseRule => !!entry)
    .sort((a, b) => b.minPurchaseValue - a.minPurchaseValue);
};

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
      return Boolean(item.subCategoryId && item.subCategoryId === discount.targetSubCategoryId);
    case DiscountScope.ITEM:
      return item.id === discount.targetItemId;
    default:
      return false;
  }
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

export interface AdminItemsQueryInput {
  search?: string;
  category?: string;
  page?: number;
  limit?: number;
}

export const getAllItems = async (query?: AdminItemsQueryInput): Promise<{ data: Item[]; meta: { page: number; limit: number; totalItems: number; totalPages: number } }> => {
  const page = query?.page && Number.isFinite(query.page) ? Math.max(1, query.page) : 1;
  const limit = query?.limit && Number.isFinite(query.limit) ? Math.min(200, Math.max(1, query.limit)) : 50;

  const where: Prisma.ItemWhereInput = {};
  const and: Prisma.ItemWhereInput[] = [];

  if (query?.search && query.search.trim()) {
    const term = query.search.trim();
    and.push({
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { sku: { contains: term, mode: "insensitive" } },
        { category: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  if (query?.category && query.category !== "all") {
    and.push({ category: query.category });
  }

  if (and.length > 0) {
    where.AND = and;
  }

  const [data, totalItems] = await Promise.all([
    prisma.item.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.item.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalItems / limit));

  return {
    data,
    meta: { page, limit, totalItems, totalPages },
  };
};

export const getCatalogItems = async (query: CatalogQueryInput) => {
  const page = Number.isFinite(query.page) ? Math.max(1, Math.floor(query.page as number)) : 1;
  const limit = Number.isFinite(query.limit)
    ? Math.min(100, Math.max(1, Math.floor(query.limit as number)))
    : 20;

  const where: Prisma.ItemWhereInput = {};
  const and: Prisma.ItemWhereInput[] = [];

  if (query.search && query.search.trim()) {
    const term = query.search.trim();
    and.push({
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { sku: { contains: term, mode: "insensitive" } },
        { category: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  if (query.categories && query.categories.length > 0) {
    and.push({ category: { in: query.categories } });
  }

  if (query.subCategoryIds && query.subCategoryIds.length > 0) {
    and.push({ subCategoryId: { in: query.subCategoryIds } });
  }

  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    and.push({
      price: {
        gte: query.minPrice,
        lte: query.maxPrice,
      },
    });
  }

  if (query.inStockOnly) {
    and.push({ quantity: { gt: 0 } });
  }

  if (and.length > 0) {
    where.AND = and;
  }

  const sortBy = query.sortBy || "createdAt";
  const sortOrder = query.sortOrder || "desc";

  const [items, activeDiscounts] = await Promise.all([
    prisma.item.findMany({
      where,
      include: {
        subCategory: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.discount.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const now = new Date();
  const discounts = activeDiscounts.filter((discount) => isDiscountActive(discount, now));

  const visibleItems = items.filter(isVisibleOnMainSite);
  const totalItems = visibleItems.length;
  const paginatedItems = visibleItems.slice((page - 1) * limit, page * limit);

  const data = paginatedItems.map((item) => {
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
      name: item.name,
      sku: item.sku,
      category: item.category,
      subCategoryId: item.subCategoryId,
      subCategoryName: item.subCategory?.name || null,
      imageUrl: item.imageUrl,
      galleryImages: item.galleryImages || [],
      shortDescription: item.shortDescription,
      productType: item.productType || null,
      vendor: item.vendor || null,
      tags: item.tags || [],
      variants: item.variants || null,
      weightInGrams: item.weightInGrams ?? null,
      quantity: item.quantity,
      inStock: item.quantity > 0,
      pricing,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  });

  const totalPages = Math.max(1, Math.ceil(totalItems / limit));

  return {
    data,
    meta: {
      page,
      limit,
      totalItems,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
};

export const getCatalogItemById = async (id: string) => {
  const [item, activeDiscounts] = await Promise.all([
    prisma.item.findUnique({
      where: { id },
      include: {
        subCategory: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    prisma.discount.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  if (!item) {
    return null;
  }
  if (!isVisibleOnMainSite(item)) {
    return null;
  }

  const now = new Date();
  const discounts = activeDiscounts.filter((discount) => isDiscountActive(discount, now));
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
    name: item.name,
    sku: item.sku,
    category: item.category,
    subCategoryId: item.subCategoryId,
    subCategoryName: item.subCategory?.name || null,
    imageUrl: item.imageUrl,
    galleryImages: item.galleryImages || [],
    shortDescription: item.shortDescription,
    features: item.features || [],
    specifications: item.specifications || null,
    reviews: item.reviews || null,
    variants: item.variants || null,
    tags: item.tags || [],
    productType: item.productType || null,
    vendor: item.vendor || null,
    weightInGrams: item.weightInGrams ?? null,
    quantity: item.quantity,
    inStock: item.quantity > 0,
    soldCount: item.soldCount,
    viewerCount: item.viewerCount,
    averageRating: item.averageRating,
    reviewCount: item.reviewCount,
    pricing,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
};

export const getMultipleCatalogItemsByIds = async (ids: string[]) => {
  const [items, activeDiscounts] = await Promise.all([
    prisma.item.findMany({
      where: { id: { in: ids } },
      include: {
        subCategory: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    prisma.discount.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const now = new Date();
  const discounts = activeDiscounts.filter((discount) => isDiscountActive(discount, now));

  return items.filter(isVisibleOnMainSite).map((item) => {
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
      name: item.name,
      sku: item.sku,
      category: item.category,
      subCategoryId: item.subCategoryId,
      subCategoryName: item.subCategory?.name || null,
      imageUrl: item.imageUrl,
      galleryImages: item.galleryImages || [],
      shortDescription: item.shortDescription,
      productType: item.productType || null,
      vendor: item.vendor || null,
      tags: item.tags || [],
      variants: item.variants || null,
      weightInGrams: item.weightInGrams ?? null,
      quantity: item.quantity,
      inStock: item.quantity > 0,
      pricing,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  });
};

export const getTopSellingItems = async (query: TopSellingQueryInput) => {
  const hours = Number.isFinite(query.hours) ? Math.max(1, Math.floor(query.hours as number)) : 24;
  const limit = Number.isFinite(query.limit)
    ? Math.min(50, Math.max(1, Math.floor(query.limit as number)))
    : 8;

  const from = new Date(Date.now() - hours * 60 * 60 * 1000);
  from.setMinutes(0, 0, 0);

  const hourlyRows = await prisma.itemSalesHourly.findMany({
    where: {
      bucketStart: {
        gte: from,
      },
    },
    select: {
      itemId: true,
      quantity: true,
    },
  });

  const soldByItem = new Map<string, number>();
  for (const row of hourlyRows) {
    soldByItem.set(row.itemId, (soldByItem.get(row.itemId) || 0) + row.quantity);
  }

  const ranked = Array.from(soldByItem.entries())
    .map(([itemId, sold]) => ({ itemId, sold }))
    .filter((entry) => entry.sold > 0)
    .sort((a, b) => b.sold - a.sold)
    .slice(0, limit);

  if (ranked.length === 0) {
    return {
      data: [],
      meta: {
        hours,
        limit,
        from,
      },
    };
  }

  const ids = ranked.map((entry) => entry.itemId);
  const items = await prisma.item.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      sku: true,
      category: true,
      imageUrl: true,
      price: true,
      soldCount: true,
      quantity: true,
      subCategoryId: true,
      showOnMainSite: true,
    },
  });
  const visibleItems = items.filter(isVisibleOnMainSite);
  const itemById = new Map(visibleItems.map((item) => [item.id, item]));

  const activeDiscounts = await prisma.discount.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });
  const now = new Date();
  const discounts = activeDiscounts.filter((d) => isDiscountActive(d, now));

  return {
    data: ranked
      .map((entry) => {
        const item = itemById.get(entry.itemId);
        if (!item) {
          return null;
        }
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
          name: item.name,
          sku: item.sku,
          category: item.category,
          imageUrl: item.imageUrl,
          pricing,
          quantity: item.quantity,
          soldLastHours: entry.sold,
          totalSold: item.soldCount,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => !!entry),
    meta: {
      hours,
      limit,
      from,
    },
  };
};

export const getNewArrivals = async () => {
  const [items, activeDiscounts] = await Promise.all([
    prisma.item.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.discount.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const now = new Date();
  const discounts = activeDiscounts.filter((discount) => isDiscountActive(discount, now));

  return items.filter(isVisibleOnMainSite).map((item) => {
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
      name: item.name,
      sku: item.sku,
      category: item.category,
      imageUrl: item.imageUrl,
      pricing,
      quantity: item.quantity,
      inStock: item.quantity > 0,
      createdAt: item.createdAt,
    };
  });
};

export const getRelatedCatalogItems = async (
  itemId: string,
  limitInput?: number,
) => {
  const sourceItem = await prisma.item.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      category: true,
      subCategoryId: true,
      showOnMainSite: true,
    },
  });

  if (!sourceItem) {
    return null;
  }
  if (!isVisibleOnMainSite(sourceItem)) {
    return null;
  }

  const limit = Number.isFinite(limitInput)
    ? Math.min(20, Math.max(1, Math.floor(limitInput as number)))
    : 8;

  const activeDiscounts = await prisma.discount.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });
  const now = new Date();
  const discounts = activeDiscounts.filter((discount) =>
    isDiscountActive(discount, now),
  );

  const mapCatalogCard = (item: {
    id: string;
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
    quantity: number;
    price: number;
    createdAt: Date;
    updatedAt: Date;
    showOnMainSite: boolean | null;
  }) => {
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
      name: item.name,
      sku: item.sku,
      category: item.category,
      subCategoryId: item.subCategoryId,
      imageUrl: item.imageUrl,
      galleryImages: item.galleryImages || [],
      shortDescription: item.shortDescription,
      productType: item.productType || null,
      vendor: item.vendor || null,
      tags: item.tags || [],
      variants: item.variants || null,
      weightInGrams: item.weightInGrams ?? null,
      quantity: item.quantity,
      inStock: item.quantity > 0,
      pricing,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  };

  const commonSelect = {
    id: true,
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
    quantity: true,
    price: true,
    createdAt: true,
    updatedAt: true,
    showOnMainSite: true,
  } as const;

  const subCategoryMatches = sourceItem.subCategoryId
    ? await prisma.item.findMany({
        where: {
          id: { not: sourceItem.id },
          subCategoryId: sourceItem.subCategoryId,
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: commonSelect,
      })
    : [];

  let relatedItems = subCategoryMatches.filter(isVisibleOnMainSite);

  if (relatedItems.length < limit) {
    const fallbackItems = await prisma.item.findMany({
      where: {
        id: {
          notIn: [sourceItem.id, ...relatedItems.map((entry) => entry.id)],
        },
        category: sourceItem.category,
      },
      orderBy: { createdAt: "desc" },
      take: limit - relatedItems.length,
      select: commonSelect,
    });

    relatedItems = [...relatedItems, ...fallbackItems].filter(isVisibleOnMainSite);
  }

  return {
    data: relatedItems.map(mapCatalogCard),
  };
};

export const getItemById = async (id: string): Promise<Item | null> => {
  return await prisma.item.findUnique({
    where: { id },
  });
};

export const createItem = async (data: CreateItemInput): Promise<Item> => {
  return await prisma.item.create({
    data,
  });
};

export const updateItem = async (
  id: string,
  data: UpdateItemInput,
): Promise<Item> => {
  return await prisma.item.update({
    where: { id },
    data,
  });
};

export const deleteItem = async (id: string): Promise<Item> => {
  return await prisma.item.delete({
    where: { id },
  });
};

export const getStockAlerts = async (): Promise<Item[]> => {
  const items = await prisma.item.findMany();
  return items.filter((item) => item.quantity < item.minStock);
};
