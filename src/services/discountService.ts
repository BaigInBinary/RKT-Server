import prisma from "../config/prisma";
import { Discount, DiscountScope, DiscountType, Prisma } from "@prisma/client";

type DiscountRule = {
  minPurchaseValue: number;
  discountAmount: number;
};

export interface CartLineInput {
  itemId?: string;
  category?: string;
  subCategoryId?: string;
  unitPrice: number;
  quantity: number;
}

export interface CalculateDiscountInput {
  items: CartLineInput[];
  at?: Date;
}

export interface CreateDiscountInput {
  name: string;
  description?: string | null;
  discountType: DiscountType;
  scope: DiscountScope;
  discountValue?: number | null;
  purchaseValueRules?: DiscountRule[] | null;
  minimumPurchaseValue?: number;
  isActive?: boolean;
  startDate?: Date | null;
  endDate?: Date | null;
  targetCategory?: string | null;
  targetSubCategoryId?: string | null;
  targetItemId?: string | null;
}

export type UpdateDiscountInput = Partial<CreateDiscountInput>;

type EnrichedCartLine = {
  index: number;
  itemId?: string;
  category?: string;
  subCategoryId?: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  remainingTotal: number;
  discountTotal: number;
  appliedDiscounts: Array<{
    discountId: string;
    name: string;
    amount: number;
  }>;
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== "number") {
    return null;
  }
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
};

const parseDiscountRules = (value: unknown): DiscountRule[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const rules = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const rule = entry as Record<string, unknown>;
      const minPurchaseValue = toFiniteNumber(rule.minPurchaseValue);
      const discountAmount = toFiniteNumber(rule.discountAmount);
      if (minPurchaseValue === null || discountAmount === null) {
        return null;
      }
      if (minPurchaseValue < 0 || discountAmount < 0) {
        return null;
      }
      return {
        minPurchaseValue: round2(minPurchaseValue),
        discountAmount: round2(discountAmount),
      };
    })
    .filter((entry): entry is DiscountRule => !!entry)
    .sort((a, b) => b.minPurchaseValue - a.minPurchaseValue);

  return rules;
};

const validateAndBuildDiscountData = (
  payload: CreateDiscountInput | UpdateDiscountInput,
  isUpdate: boolean,
): Prisma.DiscountUncheckedCreateInput | Prisma.DiscountUncheckedUpdateInput => {
  const data: Prisma.DiscountUncheckedCreateInput | Prisma.DiscountUncheckedUpdateInput =
    {};

  if (!isUpdate || payload.name !== undefined) {
    const name = String(payload.name ?? "").trim();
    if (!name) {
      throw new Error("Discount name is required");
    }
    data.name = name;
  }

  if (payload.description !== undefined) {
    const description = String(payload.description ?? "").trim();
    data.description = description || null;
  }

  if (!isUpdate || payload.discountType !== undefined) {
    if (!payload.discountType) {
      throw new Error("discountType is required");
    }
    data.discountType = payload.discountType;
  }

  if (!isUpdate || payload.scope !== undefined) {
    if (!payload.scope) {
      throw new Error("scope is required");
    }
    data.scope = payload.scope;
  }

  if (payload.minimumPurchaseValue !== undefined) {
    if (!Number.isFinite(payload.minimumPurchaseValue) || payload.minimumPurchaseValue < 0) {
      throw new Error("minimumPurchaseValue must be a non-negative number");
    }
    data.minimumPurchaseValue = round2(payload.minimumPurchaseValue);
  } else if (!isUpdate) {
    data.minimumPurchaseValue = 0;
  }

  if (payload.isActive !== undefined) {
    data.isActive = Boolean(payload.isActive);
  } else if (!isUpdate) {
    data.isActive = true;
  }

  if (payload.startDate !== undefined) {
    data.startDate = payload.startDate ?? null;
  }

  if (payload.endDate !== undefined) {
    data.endDate = payload.endDate ?? null;
  }

  const discountType = payload.discountType;
  const hasDiscountValue = payload.discountValue !== undefined;
  const hasPurchaseValueRules = payload.purchaseValueRules !== undefined;

  if (discountType === DiscountType.VALUE_BASED) {
    const rules = parseDiscountRules(payload.purchaseValueRules);
    if (rules.length === 0 && !isUpdate) {
      throw new Error(
        "purchaseValueRules are required for VALUE_BASED discounts",
      );
    }
    if (hasPurchaseValueRules) {
      data.purchaseValueRules = rules;
    }
    if (hasDiscountValue) {
      data.discountValue = null;
    }
  } else {
    if (!isUpdate || hasDiscountValue) {
      const value = Number(payload.discountValue);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("discountValue must be greater than 0");
      }
      if (discountType === DiscountType.PERCENTAGE && value > 100) {
        throw new Error("Percentage discountValue cannot exceed 100");
      }
      data.discountValue = round2(value);
    }
    if (!isUpdate || hasPurchaseValueRules) {
      data.purchaseValueRules = null;
    }
  }

  const scope = payload.scope;
  const targetCategory = payload.targetCategory?.trim();
  const targetSubCategoryId = payload.targetSubCategoryId?.trim();
  const targetItemId = payload.targetItemId?.trim();

  if (scope === DiscountScope.CATEGORY) {
    if (!targetCategory) {
      throw new Error("targetCategory is required for CATEGORY scope");
    }
    data.targetCategory = targetCategory;
    data.targetSubCategoryId = null;
    data.targetItemId = null;
  } else if (scope === DiscountScope.SUBCATEGORY) {
    if (!targetSubCategoryId) {
      throw new Error("targetSubCategoryId is required for SUBCATEGORY scope");
    }
    data.targetCategory = null;
    data.targetSubCategoryId = targetSubCategoryId;
    data.targetItemId = null;
  } else if (scope === DiscountScope.ITEM) {
    if (!targetItemId) {
      throw new Error("targetItemId is required for ITEM scope");
    }
    data.targetCategory = null;
    data.targetSubCategoryId = null;
    data.targetItemId = targetItemId;
  } else if (scope === DiscountScope.ALL) {
    data.targetCategory = null;
    data.targetSubCategoryId = null;
    data.targetItemId = null;
  }

  if (payload.startDate && payload.endDate && payload.startDate > payload.endDate) {
    throw new Error("startDate cannot be later than endDate");
  }

  return data;
};

const getApplicableDiscountAmount = (
  discount: Discount,
  eligibleSubtotal: number,
): number => {
  if (eligibleSubtotal <= 0) {
    return 0;
  }

  if (discount.discountType === DiscountType.FLAT) {
    return Math.min(round2(discount.discountValue ?? 0), eligibleSubtotal);
  }

  if (discount.discountType === DiscountType.PERCENTAGE) {
    const percentage = discount.discountValue ?? 0;
    return Math.min(round2((eligibleSubtotal * percentage) / 100), eligibleSubtotal);
  }

  const rules = parseDiscountRules(discount.purchaseValueRules);
  const matchingRule = rules.find((rule) => eligibleSubtotal >= rule.minPurchaseValue);
  if (!matchingRule) {
    return 0;
  }

  return Math.min(round2(matchingRule.discountAmount), eligibleSubtotal);
};

const matchesScope = (discount: Discount, line: EnrichedCartLine): boolean => {
  switch (discount.scope) {
    case DiscountScope.ALL:
      return true;
    case DiscountScope.CATEGORY:
      return Boolean(line.category && line.category === discount.targetCategory);
    case DiscountScope.SUBCATEGORY:
      return Boolean(
        line.subCategoryId && line.subCategoryId === discount.targetSubCategoryId,
      );
    case DiscountScope.ITEM:
      return Boolean(line.itemId && line.itemId === discount.targetItemId);
    default:
      return false;
  }
};

const enrichCartItems = async (items: CartLineInput[]): Promise<EnrichedCartLine[]> => {
  const requestedItemIds = Array.from(
    new Set(
      items
        .map((line) => (line.itemId ? line.itemId.trim() : ""))
        .filter(Boolean),
    ),
  );

  const dbItems = requestedItemIds.length
    ? await prisma.item.findMany({
        where: { id: { in: requestedItemIds } },
        select: { id: true, category: true, subCategoryId: true },
      })
    : [];
  const itemById = new Map(dbItems.map((item) => [item.id, item]));

  return items.map((line, index) => {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new Error(`Invalid quantity for cart line at index ${index}`);
    }
    if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
      throw new Error(`Invalid unitPrice for cart line at index ${index}`);
    }

    const itemId = line.itemId?.trim() || undefined;
    const dbItem = itemId ? itemById.get(itemId) : undefined;
    const category = line.category?.trim() || dbItem?.category || undefined;
    const subCategoryId =
      line.subCategoryId?.trim() || dbItem?.subCategoryId || undefined;
    const subtotal = round2(line.unitPrice * line.quantity);

    return {
      index,
      itemId,
      category,
      subCategoryId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      subtotal,
      remainingTotal: subtotal,
      discountTotal: 0,
      appliedDiscounts: [],
    };
  });
};

export const getAllDiscounts = async (): Promise<Discount[]> => {
  return prisma.discount.findMany({
    orderBy: { createdAt: "desc" },
  });
};

export const getDiscountById = async (id: string): Promise<Discount | null> => {
  return prisma.discount.findUnique({ where: { id } });
};

export const createDiscount = async (
  payload: CreateDiscountInput,
): Promise<Discount> => {
  const data = validateAndBuildDiscountData(
    payload,
    false,
  ) as Prisma.DiscountUncheckedCreateInput;
  return prisma.discount.create({ data });
};

export const updateDiscount = async (
  id: string,
  payload: UpdateDiscountInput,
): Promise<Discount> => {
  const existing = await prisma.discount.findUnique({ where: { id } });
  if (!existing) {
    throw new Error("Discount not found");
  }

  const nextPayload: CreateDiscountInput = {
    name: payload.name ?? existing.name,
    description:
      payload.description !== undefined ? payload.description : existing.description,
    discountType: payload.discountType ?? existing.discountType,
    scope: payload.scope ?? existing.scope,
    discountValue:
      payload.discountValue !== undefined ? payload.discountValue : existing.discountValue,
    purchaseValueRules:
      payload.purchaseValueRules !== undefined
        ? payload.purchaseValueRules
        : parseDiscountRules(existing.purchaseValueRules),
    minimumPurchaseValue:
      payload.minimumPurchaseValue !== undefined
        ? payload.minimumPurchaseValue
        : existing.minimumPurchaseValue,
    isActive: payload.isActive !== undefined ? payload.isActive : existing.isActive,
    startDate: payload.startDate !== undefined ? payload.startDate : existing.startDate,
    endDate: payload.endDate !== undefined ? payload.endDate : existing.endDate,
    targetCategory:
      payload.targetCategory !== undefined
        ? payload.targetCategory
        : existing.targetCategory,
    targetSubCategoryId:
      payload.targetSubCategoryId !== undefined
        ? payload.targetSubCategoryId
        : existing.targetSubCategoryId,
    targetItemId:
      payload.targetItemId !== undefined ? payload.targetItemId : existing.targetItemId,
  };

  const data = validateAndBuildDiscountData(
    nextPayload,
    true,
  ) as Prisma.DiscountUncheckedUpdateInput;
  return prisma.discount.update({
    where: { id },
    data,
  });
};

export const deleteDiscount = async (id: string): Promise<Discount> => {
  return prisma.discount.delete({ where: { id } });
};

export const calculateDiscounts = async (payload: CalculateDiscountInput) => {
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw new Error("At least one cart line is required");
  }

  const at = payload.at ?? new Date();
  const lines = await enrichCartItems(payload.items);
  const subtotal = round2(lines.reduce((sum, line) => sum + line.subtotal, 0));

  const activeDiscounts = await prisma.discount.findMany({
    where: {
      isActive: true,
      AND: [
        {
          OR: [{ startDate: null }, { startDate: { lte: at } }],
        },
        {
          OR: [{ endDate: null }, { endDate: { gte: at } }],
        },
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  const appliedDiscounts: Array<{
    discountId: string;
    name: string;
    type: DiscountType;
    scope: DiscountScope;
    eligibleSubtotal: number;
    discountAmount: number;
  }> = [];

  for (const discount of activeDiscounts) {
    const matchingLines = lines.filter(
      (line) => matchesScope(discount, line) && line.remainingTotal > 0,
    );
    if (matchingLines.length === 0) {
      continue;
    }

    const eligibleSubtotal = round2(
      matchingLines.reduce((sum, line) => sum + line.remainingTotal, 0),
    );
    if (eligibleSubtotal <= 0) {
      continue;
    }

    if (eligibleSubtotal < discount.minimumPurchaseValue) {
      continue;
    }

    const discountAmount = getApplicableDiscountAmount(discount, eligibleSubtotal);
    if (discountAmount <= 0) {
      continue;
    }

    let allocated = 0;
    const lastIndex = matchingLines.length - 1;

    matchingLines.forEach((line, idx) => {
      const amount =
        idx === lastIndex
          ? round2(discountAmount - allocated)
          : round2((line.remainingTotal / eligibleSubtotal) * discountAmount);
      allocated = round2(allocated + amount);
      line.remainingTotal = round2(Math.max(0, line.remainingTotal - amount));
      line.discountTotal = round2(line.discountTotal + amount);
      line.appliedDiscounts.push({
        discountId: discount.id,
        name: discount.name,
        amount,
      });
    });

    appliedDiscounts.push({
      discountId: discount.id,
      name: discount.name,
      type: discount.discountType,
      scope: discount.scope,
      eligibleSubtotal,
      discountAmount: round2(discountAmount),
    });
  }

  const totalDiscount = round2(
    appliedDiscounts.reduce((sum, entry) => sum + entry.discountAmount, 0),
  );
  const finalTotal = round2(Math.max(0, subtotal - totalDiscount));

  return {
    subtotal,
    totalDiscount,
    finalTotal,
    appliedDiscounts,
    items: lines.map((line) => ({
      index: line.index,
      itemId: line.itemId ?? null,
      category: line.category ?? null,
      subCategoryId: line.subCategoryId ?? null,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      subtotal: line.subtotal,
      discount: line.discountTotal,
      finalTotal: line.remainingTotal,
      appliedDiscounts: line.appliedDiscounts,
    })),
  };
};
