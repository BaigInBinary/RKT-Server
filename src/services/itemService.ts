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

type PurchaseRule = {
  minPurchaseValue: number;
  discountAmount: number;
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

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

export const getAllItems = async (): Promise<Item[]> => {
  return await prisma.item.findMany({
    orderBy: { createdAt: "desc" },
  });
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

  const [items, totalItems, activeDiscounts] = await prisma.$transaction([
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
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.item.count({ where }),
    prisma.discount.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const now = new Date();
  const discounts = activeDiscounts.filter((discount) => isDiscountActive(discount, now));

  const data = items.map((item) => {
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

export const getNewArrivals = async (): Promise<Item[]> => {
  return await prisma.item.findMany({
    orderBy: { createdAt: "desc" },
    take: 8,
  });
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
