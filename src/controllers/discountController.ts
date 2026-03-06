import { NextFunction, Request, Response } from "express";
import { DiscountScope, DiscountType } from "@prisma/client";
import * as discountService from "../services/discountService";

const toNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const toBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return undefined;
};

const toDate = (value: unknown): Date | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date;
};

const toScope = (value: unknown): DiscountScope | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  if (Object.values(DiscountScope).includes(value as DiscountScope)) {
    return value as DiscountScope;
  }
  return undefined;
};

const toDiscountType = (value: unknown): DiscountType | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  if (Object.values(DiscountType).includes(value as DiscountType)) {
    return value as DiscountType;
  }
  return undefined;
};

const toRules = (value: unknown): Array<{
  minPurchaseValue: number;
  discountAmount: number;
}> | undefined => {
  if (value === undefined) {
    return undefined;
  }

  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  if (!Array.isArray(parsed)) {
    return undefined;
  }

  return parsed
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const row = entry as Record<string, unknown>;
      const minPurchaseValue = toNumber(row.minPurchaseValue);
      const discountAmount = toNumber(row.discountAmount);
      if (minPurchaseValue === undefined || discountAmount === undefined) {
        return null;
      }
      return { minPurchaseValue, discountAmount };
    })
    .filter(
      (
        entry,
      ): entry is { minPurchaseValue: number; discountAmount: number } => !!entry,
    );
};

const normalizePayload = (body: Record<string, unknown>) => ({
  name: body.name !== undefined ? String(body.name) : undefined,
  description:
    body.description !== undefined ? String(body.description ?? "") : undefined,
  discountType: toDiscountType(body.discountType),
  scope: toScope(body.scope),
  discountValue: toNumber(body.discountValue),
  purchaseValueRules: toRules(body.purchaseValueRules),
  minimumPurchaseValue: toNumber(body.minimumPurchaseValue),
  isActive: toBoolean(body.isActive),
  startDate: toDate(body.startDate),
  endDate: toDate(body.endDate),
  targetCategory:
    body.targetCategory !== undefined ? String(body.targetCategory ?? "") : undefined,
  targetSubCategoryId:
    body.targetSubCategoryId !== undefined
      ? String(body.targetSubCategoryId ?? "")
      : undefined,
  targetItemId:
    body.targetItemId !== undefined ? String(body.targetItemId ?? "") : undefined,
});

const getIdParam = (value: string | string[]) =>
  Array.isArray(value) ? value[0] : value;

export const getDiscounts = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const discounts = await discountService.getAllDiscounts();
    res.status(200).json(discounts);
  } catch (error) {
    next(error);
  }
};

export const getDiscount = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const discount = await discountService.getDiscountById(getIdParam(req.params.id));
    if (!discount) {
      return res.status(404).json({ message: "Discount not found" });
    }
    res.status(200).json(discount);
  } catch (error) {
    next(error);
  }
};

export const createDiscount = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const payload = normalizePayload(req.body as Record<string, unknown>);
    const discount = await discountService.createDiscount(
      payload as discountService.CreateDiscountInput,
    );
    res.status(201).json(discount);
  } catch (error) {
    next(error);
  }
};

export const updateDiscount = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const payload = normalizePayload(req.body as Record<string, unknown>);
    const discount = await discountService.updateDiscount(
      getIdParam(req.params.id),
      payload,
    );
    res.status(200).json(discount);
  } catch (error) {
    next(error);
  }
};

export const deleteDiscount = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    await discountService.deleteDiscount(getIdParam(req.params.id));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

export const calculateDiscounts = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const body = req.body as Record<string, unknown>;
    const items = Array.isArray(body.items)
      ? body.items.map((entry) => {
          const row = (entry ?? {}) as Record<string, unknown>;
          return {
            itemId:
              row.itemId !== undefined ? String(row.itemId).trim() || undefined : undefined,
            category:
              row.category !== undefined
                ? String(row.category).trim() || undefined
                : undefined,
            subCategoryId:
              row.subCategoryId !== undefined
                ? String(row.subCategoryId).trim() || undefined
                : undefined,
            unitPrice: Number(row.unitPrice),
            quantity: Number(row.quantity),
          };
        })
      : [];
    const at = toDate(body.at);
    const result = await discountService.calculateDiscounts({
      items,
      at: at ?? undefined,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
