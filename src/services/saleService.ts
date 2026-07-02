import prisma from "../config/prisma";
import { Prisma, Sale } from "@prisma/client";

export interface SaleItemInput {
  itemId: string;
  variantId?: string;
  variantLabel?: string;
  image?: string;
  name: string;
  price: number;
  quantity: number;
  total: number;
}

export interface CreateSaleInput {
  items: SaleItemInput[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  shippingAddress?: string;
  city?: string;
  postalCode?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  bankReceiptUrl?: string;
  bankReceiptPublicId?: string;
  loanDueDate?: Date;
  deliveryCharge?: number;
  txnRefNo?: string;
  date?: Date;
}

export interface UpdateSaleInput {
  items: SaleItemInput[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  shippingAddress?: string;
  city?: string;
  postalCode?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  bankReceiptUrl?: string;
  bankReceiptPublicId?: string;
  loanDueDate?: Date;
  deliveryCharge?: number;
  txnRefNo?: string;
  date?: Date;
}

export interface SalesAnalytics {
  totalSales: number;
  totalRevenue: number;
  sales: Sale[];
}

export interface OrderAnalytics {
  totalOrders: number;
  deliveredOrders: number;
  revenueEligibleOrders: number;
  totalRevenue: number;
  chequeRevenue: {
    id: string;
    chequeRef: string;
    chequeDate: string | null;
    amount: number;
  }[];
  orders: Sale[];
}

type ItemQuantityDelta = Map<string, number>;
type VariantQuantityDelta = Map<string, number>;
type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
const MAX_TXN_REF_RETRIES = 5;
const MAX_TRANSACTION_RETRIES = 3;
const TRANSACTION_MAX_WAIT_MS = 10_000;
const TRANSACTION_TIMEOUT_MS = 20_000;
const RESTOCK_COURIER_STATUSES = new Set(["returned", "cancelled", "canceled"]);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransientTransactionError = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2034" || error.code === "P2028";
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = `${error.name}: ${error.message} ${(error as { meta?: unknown }).meta ? JSON.stringify((error as { meta?: unknown }).meta) : ""}`.toLowerCase();
  return (
    message.includes("transienttransactionerror") ||
    message.includes("transaction already closed") ||
    message.includes("expired transaction") ||
    message.includes("os error 10054") ||
    message.includes("forcibly closed by the remote host") ||
    message.includes("connection was closed") ||
    message.includes("connection closed") ||
    message.includes("socket hang up")
  );
};

const runTransactionWithRetry = async <T>(
  operation: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>,
  label: string,
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => operation(tx),
        {
          maxWait: TRANSACTION_MAX_WAIT_MS,
          timeout: TRANSACTION_TIMEOUT_MS,
        },
      );
    } catch (error) {
      lastError = error;
      if (!isTransientTransactionError(error) || attempt === MAX_TRANSACTION_RETRIES) {
        throw error;
      }

      const waitMs = attempt * 250;
      console.warn(`${label} transaction retry ${attempt}/${MAX_TRANSACTION_RETRIES} after transient error`);
      await delay(waitMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label} transaction failed`);
};

const toHourBucketStart = (value: Date): Date => {
  const date = new Date(value);
  date.setMinutes(0, 0, 0);
  return date;
};

const buildQuantityMap = (items: SaleItemInput[]): ItemQuantityDelta => {
  const map: ItemQuantityDelta = new Map();
  for (const item of items) {
    map.set(item.itemId, (map.get(item.itemId) || 0) + item.quantity);
  }
  return map;
};

const toVariantKey = (itemId: string, variantId?: string): string | null => {
  const normalizedItemId = String(itemId || "").trim();
  const normalizedVariantId = String(variantId || "").trim();
  if (!normalizedItemId || !normalizedVariantId) {
    return null;
  }
  return `${normalizedItemId}::${normalizedVariantId}`;
};

const parseVariantKey = (key: string): { itemId: string; variantId: string } | null => {
  const delimiterIndex = key.indexOf("::");
  if (delimiterIndex <= 0) {
    return null;
  }
  const itemId = key.slice(0, delimiterIndex).trim();
  const variantId = key.slice(delimiterIndex + 2).trim();
  if (!itemId || !variantId) {
    return null;
  }
  return { itemId, variantId };
};

const buildVariantQuantityMap = (items: SaleItemInput[]): VariantQuantityDelta => {
  const map: VariantQuantityDelta = new Map();
  for (const item of items) {
    const variantKey = toVariantKey(item.itemId, item.variantId);
    if (!variantKey) {
      continue;
    }
    map.set(variantKey, (map.get(variantKey) || 0) + item.quantity);
  }
  return map;
};

const applyVariantQuantityDeltas = async (
  tx: TransactionClient,
  deltas: VariantQuantityDelta,
) => {
  for (const [variantKey, delta] of deltas.entries()) {
    if (delta === 0) {
      continue;
    }

    const parsed = parseVariantKey(variantKey);
    if (!parsed) {
      continue;
    }

    const item = await tx.item.findUnique({
      where: { id: parsed.itemId },
      select: {
        variants: true,
      },
    });

    if (!item || !Array.isArray(item.variants) || item.variants.length === 0) {
      continue;
    }

    let didUpdate = false;
    const nextVariants = item.variants.map((entry) => {
      if (!entry || typeof entry !== "object") {
        return entry;
      }

      const row = entry as Record<string, unknown>;
      const rowId = typeof row.id === "string" ? row.id.trim() : "";
      if (rowId !== parsed.variantId) {
        return entry;
      }

      const existingQty =
        Number.isFinite(Number(row.quantity)) ? Number(row.quantity) : 0;
      const nextQty = Math.max(0, Math.floor(existingQty + delta));
      didUpdate = true;

      return {
        ...row,
        quantity: nextQty,
      };
    });

    if (!didUpdate) {
      continue;
    }

    await tx.item.update({
      where: { id: parsed.itemId },
      data: {
        variants: nextVariants as Prisma.InputJsonValue,
      },
    });
  }
};

const mergeDeltaMaps = (base: ItemQuantityDelta, delta: ItemQuantityDelta) => {
  for (const [itemId, quantity] of delta.entries()) {
    base.set(itemId, (base.get(itemId) || 0) + quantity);
  }
};

const normalizeTxnRefNo = (value?: string): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const generateTxnRefNo = (): string => {
  const timePart = Date.now().toString(36).toUpperCase();
  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `SALE-${timePart}-${randomPart}`;
};

const normalizeCourierStatus = (value?: string): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.toLowerCase() === "canceled") {
    return "Cancelled";
  }
  return trimmed;
};

const isRestockCourierStatus = (value?: string | null): boolean => {
  if (typeof value !== "string") {
    return false;
  }
  return RESTOCK_COURIER_STATUSES.has(value.trim().toLowerCase());
};

const CONFIRMED_ONLINE_COURIER_STATUSES = new Set([
  "BOOKED",
  "IN TRANSIT",
  "OUT FOR DELIVERY",
  "DELIVERED",
]);

// An online order counts as a confirmed sale once it has been approved/booked
// with a courier and is progressing (or delivered). Pending, Cancelled and
// Returned orders are excluded. Payment method does not gate this, so COD
// online orders are counted once confirmed.
const isConfirmedOnlineOrder = (order: Pick<Sale, "courierStatus">): boolean => {
  const courierStatus = (order.courierStatus ?? "").trim().toUpperCase();
  return CONFIRMED_ONLINE_COURIER_STATUSES.has(courierStatus);
};

const isBookedStatus = (value?: string | null) =>
  (value ?? "").trim().toUpperCase() === "BOOKED";

const isBankDepositPaymentMethod = (value?: string | null) =>
  (value ?? "").trim().toUpperCase() === "BANK_DEPOSIT";

const parseChequePaymentDate = (value?: string | null): Date | null => {
  if (!value || typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const isoDate = new Date(normalized);
  if (!Number.isNaN(isoDate.getTime())) {
    return isoDate;
  }

  const match = normalized.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!day || !month || !year) {
    return null;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseSignedAmount = (value: string): number | null => {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const hasParentheses = normalized.includes("(") && normalized.includes(")");
  const isNegative = normalized.includes("-") || hasParentheses;
  const numeric = normalized
    .replace(/,/g, "")
    .replace(/[^\d.]/g, "");
  const parsed = Number(numeric);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return isNegative ? -parsed : parsed;
};

const extractNetPayableAmountFromHtml = (htmlContent?: string | null): number | null => {
  if (!htmlContent || typeof htmlContent !== "string") {
    return null;
  }

  const plainText = htmlContent
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ");
  const marker = /net\s*payable\s*amount/i;
  const markerMatch = marker.exec(plainText);
  if (!markerMatch) {
    return null;
  }

  const startIndex = markerMatch.index + markerMatch[0].length;
  const slice = plainText.slice(startIndex, startIndex + 200);
  const amountTokenMatch = slice.match(/[+\-]?\s*\(?\d[\d,]*(?:\.\d+)?\)?/);
  if (!amountTokenMatch) {
    return null;
  }

  const parsed = parseSignedAmount(amountTokenMatch[0]);
  return parsed === null ? null : Math.abs(parsed);
};

const isTxnRefUniqueConstraintError = (error: unknown): boolean => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) {
    return target.includes("txnRefNo");
  }
  if (typeof target === "string") {
    return target.includes("txnRefNo");
  }
  return false;
};

const applyHourlyAndSoldCountDeltas = async (
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  bucketDate: Date,
  deltas: ItemQuantityDelta,
) => {
  const bucketStart = toHourBucketStart(bucketDate);

  for (const [itemId, quantity] of deltas.entries()) {
    if (quantity === 0) {
      continue;
    }

    await tx.itemSalesHourly.upsert({
      where: {
        itemId_bucketStart: {
          itemId,
          bucketStart,
        },
      },
      create: {
        itemId,
        bucketStart,
        quantity,
      },
      update: {
        quantity: {
          increment: quantity,
        },
      },
    });

    await tx.item.update({
      where: { id: itemId },
      data: {
        soldCount: {
          increment: quantity,
        },
      },
    });
  }
};

export const getAllSales = async (): Promise<Sale[]> => {
  return await prisma.sale.findMany({
    orderBy: { date: "desc" },
  });
};

export const getSaleById = async (id: string): Promise<Sale | null> => {
  return await prisma.sale.findUnique({
    where: { id },
  });
};

export const createSale = async (data: CreateSaleInput): Promise<Sale> => {
  // Use a transaction to ensure both sale creation and stock update succeed
  return await runTransactionWithRetry(async (tx) => {
    const saleDate = data.date || new Date();
    const quantityMap = buildQuantityMap(data.items);
    const variantDeltas = new Map<string, number>();
    for (const [key, quantity] of buildVariantQuantityMap(data.items).entries()) {
      variantDeltas.set(key, -quantity);
    }
    let txnRefNo = normalizeTxnRefNo(data.txnRefNo) ?? generateTxnRefNo();
    let sale: Sale | null = null;

    // 1. Create the sale. If txnRefNo collides, regenerate and retry.
    for (let attempt = 0; attempt < MAX_TXN_REF_RETRIES; attempt += 1) {
      try {
        sale = await tx.sale.create({
          data: {
            items: data.items,
            subtotal: data.subtotal,
            tax: data.tax,
            discount: data.discount,
            total: data.total,
            customerName: data.customerName,
            customerEmail: data.customerEmail,
            customerPhone: data.customerPhone,
            shippingAddress: data.shippingAddress,
            city: data.city,
            postalCode: data.postalCode,
            paymentMethod: data.paymentMethod,
            paymentStatus: data.paymentStatus,
            bankReceiptUrl: data.bankReceiptUrl,
            bankReceiptPublicId: data.bankReceiptPublicId,
            loanDueDate: data.loanDueDate,
            deliveryCharge: data.deliveryCharge,
            txnRefNo,
            date: saleDate,
          },
        });
        break;
      } catch (error) {
        if (!isTxnRefUniqueConstraintError(error)) {
          throw error;
        }
        if (attempt === MAX_TXN_REF_RETRIES - 1) {
          throw error;
        }
        txnRefNo = generateTxnRefNo();
      }
    }

    if (!sale) {
      throw new Error("Failed to create sale due to transaction reference conflict");
    }

    // 2. Update stock for each item
    for (const item of data.items) {
      await tx.item.update({
        where: { id: item.itemId },
        data: {
          quantity: {
            decrement: item.quantity,
          },
        },
      });
    }

    if (variantDeltas.size > 0) {
      await applyVariantQuantityDeltas(tx, variantDeltas);
    }

    await applyHourlyAndSoldCountDeltas(tx, saleDate, quantityMap);

    return sale;
  }, "createSale");
};

export const updateSale = async (
  id: string,
  data: UpdateSaleInput,
): Promise<Sale> => {
  return await runTransactionWithRetry(async (tx) => {
    const existingSale = await tx.sale.findUnique({ where: { id } });
    if (!existingSale) {
      throw new Error("Sale not found");
    }

    const previousItems = existingSale.items as unknown as SaleItemInput[];
    const nextSaleDate = data.date || existingSale.date;
    const normalizedTxnRefNo = normalizeTxnRefNo(data.txnRefNo);

    const previousByItemId = new Map<string, number>();
    const nextByItemId = new Map<string, number>();
    const previousByVariant = buildVariantQuantityMap(previousItems);
    const nextByVariant = buildVariantQuantityMap(data.items);

    for (const item of previousItems) {
      previousByItemId.set(item.itemId, (previousByItemId.get(item.itemId) || 0) + item.quantity);
    }

    for (const item of data.items) {
      nextByItemId.set(item.itemId, (nextByItemId.get(item.itemId) || 0) + item.quantity);
    }

    const allItemIds = new Set<string>([
      ...Array.from(previousByItemId.keys()),
      ...Array.from(nextByItemId.keys()),
    ]);

    for (const itemId of allItemIds) {
      const previousQty = previousByItemId.get(itemId) || 0;
      const nextQty = nextByItemId.get(itemId) || 0;
      const delta = nextQty - previousQty;

      if (delta === 0) {
        continue;
      }

      const item = await tx.item.findUnique({ where: { id: itemId } });
      if (!item) {
        throw new Error(`Item not found: ${itemId}`);
      }

      if (delta > 0 && item.quantity < delta) {
        throw new Error(`Insufficient stock for item ${item.name}`);
      }

      await tx.item.update({
        where: { id: itemId },
        data: {
          quantity: {
            increment: -delta,
          },
        },
      });
    }

    const variantAdjustments = new Map<string, number>();
    const allVariantKeys = new Set<string>([
      ...Array.from(previousByVariant.keys()),
      ...Array.from(nextByVariant.keys()),
    ]);

    for (const variantKey of allVariantKeys) {
      const previousQty = previousByVariant.get(variantKey) || 0;
      const nextQty = nextByVariant.get(variantKey) || 0;
      const delta = nextQty - previousQty;
      if (delta === 0) {
        continue;
      }
      variantAdjustments.set(variantKey, -delta);
    }

    const oldBucketDelta = new Map<string, number>();
    for (const [itemId, qty] of previousByItemId.entries()) {
      oldBucketDelta.set(itemId, -qty);
    }

    const newBucketDelta = new Map<string, number>();
    for (const [itemId, qty] of nextByItemId.entries()) {
      newBucketDelta.set(itemId, qty);
    }

    if (toHourBucketStart(existingSale.date).getTime() === toHourBucketStart(nextSaleDate).getTime()) {
      const merged = new Map<string, number>();
      mergeDeltaMaps(merged, oldBucketDelta);
      mergeDeltaMaps(merged, newBucketDelta);
      await applyHourlyAndSoldCountDeltas(tx, nextSaleDate, merged);
    } else {
      await applyHourlyAndSoldCountDeltas(tx, existingSale.date, oldBucketDelta);
      await applyHourlyAndSoldCountDeltas(tx, nextSaleDate, newBucketDelta);
    }

    if (variantAdjustments.size > 0) {
      await applyVariantQuantityDeltas(tx, variantAdjustments);
    }

    return await tx.sale.update({
      where: { id },
      data: {
        items: data.items,
        subtotal: data.subtotal,
        tax: data.tax,
        discount: data.discount,
        total: data.total,
        customerName: data.customerName,
        customerEmail: data.customerEmail,
        customerPhone: data.customerPhone,
        shippingAddress: data.shippingAddress,
        city: data.city,
        postalCode: data.postalCode,
        paymentMethod: data.paymentMethod,
        paymentStatus: data.paymentStatus,
        bankReceiptUrl: data.bankReceiptUrl,
        bankReceiptPublicId: data.bankReceiptPublicId,
        loanDueDate: data.loanDueDate,
        deliveryCharge: data.deliveryCharge,
        txnRefNo: normalizedTxnRefNo,
        date: nextSaleDate,
      },
    });
  }, "updateSale");
};

export const deleteSale = async (id: string): Promise<void> => {
  await runTransactionWithRetry(async (tx) => {
    const existingSale = await tx.sale.findUnique({ where: { id } });
    if (!existingSale) {
      throw Object.assign(new Error("Sale not found"), { statusCode: 404 });
    }

    // If order was already returned/cancelled, stock was previously restored.
    // Skip restore here to avoid double increment on delete.
    if (!isRestockCourierStatus(existingSale.courierStatus)) {
      const previousItems = existingSale.items as unknown as SaleItemInput[];
      const itemIds = Array.from(new Set(previousItems.map((item) => item.itemId)));
      const existingItems = await tx.item.findMany({
        where: { id: { in: itemIds } },
        select: { id: true },
      });
      const existingItemIds = new Set(existingItems.map((item) => item.id));

      const soldDelta = new Map<string, number>();
      const variantDeltas = new Map<string, number>();
      for (const item of previousItems) {
        if (!existingItemIds.has(item.itemId)) {
          continue;
        }
        soldDelta.set(item.itemId, (soldDelta.get(item.itemId) || 0) - item.quantity);
        const variantKey = toVariantKey(item.itemId, item.variantId);
        if (variantKey) {
          variantDeltas.set(variantKey, (variantDeltas.get(variantKey) || 0) + item.quantity);
        }
        await tx.item.update({
          where: { id: item.itemId },
          data: {
            quantity: {
              increment: item.quantity,
            },
          },
        });
      }

      if (soldDelta.size > 0) {
        await applyHourlyAndSoldCountDeltas(tx, existingSale.date, soldDelta);
      }
      if (variantDeltas.size > 0) {
        await applyVariantQuantityDeltas(tx, variantDeltas);
      }
    }

    await tx.sale.delete({ where: { id } });
  }, "deleteSale");
};

export const getSaleByTxnRefNo = async (txnRefNo: string): Promise<Sale | null> => {
  return await prisma.sale.findUnique({
    where: { txnRefNo },
  });
};

export const getSaleByTrackingNumber = async (trackingNumber: string): Promise<Sale | null> => {
  return await prisma.sale.findFirst({
    where: { trackingNumber: trackingNumber.trim() },
    orderBy: { date: "desc" },
  });
};

export const updatePaymentStatus = async (txnRefNo: string, status: string): Promise<Sale> => {
  return await prisma.sale.update({
    where: { txnRefNo },
    data: {
      paymentStatus: status,
    },
  });
};

// Returns only online orders (i.e. those submitted from the main site,
// identified by having a shippingAddress set).
export const getAllOrders = async (): Promise<Sale[]> => {
  return await prisma.sale.findMany({
    where: {
      shippingAddress: { not: null },
    },
    orderBy: { date: "desc" },
  });
};

export interface UpdateOrderStatusInput {
  courierStatus?: string;
  paymentStatus?: string;
}

export interface UpdateOrderCustomerDetailsInput {
  shippingAddress: string;
  city?: string | null;
  postalCode?: string | null;
}

// Update courier / payment status. When moved to Returned/Cancelled/Canceled,
// this also restores item stock and sold/hourly counters once.
export const updateOrderStatus = async (
  id: string,
  data: UpdateOrderStatusInput,
): Promise<Sale> => {
  return await runTransactionWithRetry(async (tx) => {
    const existingOrder = await tx.sale.findUnique({ where: { id } });
    if (!existingOrder) {
      throw Object.assign(new Error("Order not found"), { statusCode: 404 });
    }

    const nextCourierStatus = data.courierStatus !== undefined
      ? normalizeCourierStatus(data.courierStatus) ?? existingOrder.courierStatus ?? undefined
      : existingOrder.courierStatus ?? undefined;

    let nextPaymentStatus =
      data.paymentStatus !== undefined ? data.paymentStatus : existingOrder.paymentStatus ?? undefined;

    // Bank deposit orders are considered paid once admin confirms booking.
    if (isBankDepositPaymentMethod(existingOrder.paymentMethod) && isBookedStatus(nextCourierStatus)) {
      nextPaymentStatus = "paid";
    }

    const becameRestocked =
      !isRestockCourierStatus(existingOrder.courierStatus) &&
      isRestockCourierStatus(nextCourierStatus);

    // Restore stock once when order moves into Returned/Cancelled/Canceled.
    if (becameRestocked) {
      const previousItems = existingOrder.items as unknown as SaleItemInput[];
      const itemIds = Array.from(new Set(previousItems.map((item) => item.itemId)));
      const existingItems = await tx.item.findMany({
        where: { id: { in: itemIds } },
        select: { id: true },
      });
      const existingItemIds = new Set(existingItems.map((item) => item.id));

      const soldDelta = new Map<string, number>();
      const variantDeltas = new Map<string, number>();
      for (const item of previousItems) {
        if (!existingItemIds.has(item.itemId)) {
          continue;
        }
        soldDelta.set(item.itemId, (soldDelta.get(item.itemId) || 0) - item.quantity);
        const variantKey = toVariantKey(item.itemId, item.variantId);
        if (variantKey) {
          variantDeltas.set(variantKey, (variantDeltas.get(variantKey) || 0) + item.quantity);
        }
        await tx.item.update({
          where: { id: item.itemId },
          data: {
            quantity: {
              increment: item.quantity,
            },
          },
        });
      }

      if (soldDelta.size > 0) {
        await applyHourlyAndSoldCountDeltas(tx, existingOrder.date, soldDelta);
      }
      if (variantDeltas.size > 0) {
        await applyVariantQuantityDeltas(tx, variantDeltas);
      }
    }

    return await tx.sale.update({
      where: { id },
      data: {
        ...(data.courierStatus !== undefined && { courierStatus: nextCourierStatus }),
        ...(nextPaymentStatus !== undefined && { paymentStatus: nextPaymentStatus }),
      },
    });
  }, "updateOrderStatus");
};

export const updateOrderCustomerDetails = async (
  id: string,
  data: UpdateOrderCustomerDetailsInput,
): Promise<Sale> => {
  return await runTransactionWithRetry(async (tx) => {
    const existingOrder = await tx.sale.findUnique({ where: { id } });
    if (!existingOrder) {
      throw Object.assign(new Error("Order not found"), { statusCode: 404 });
    }

    return await tx.sale.update({
      where: { id },
      data: {
        shippingAddress: data.shippingAddress,
        city: data.city || null,
        postalCode: data.postalCode || null,
      },
    });
  }, "updateOrderCustomerDetails");
};

export const getOrderAnalytics = async (
  startDate?: Date,
  endDate?: Date,
): Promise<OrderAnalytics> => {
  const orders = await prisma.sale.findMany({
    where: {
      shippingAddress: { not: null },
      ...(startDate || endDate
        ? {
            date: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {}),
            },
          }
        : {}),
    },
    orderBy: { date: "desc" },
  });

  const deliveredOrders = orders.filter((order) => {
    const status = (order.courierStatus ?? "").trim().toUpperCase();
    return status === "DELIVERED";
  }).length;

  const revenueEligibleOrders = orders.filter(isConfirmedOnlineOrder);
  const chequeRecords = await (prisma as any).chequeRecord.findMany({
    select: {
      id: true,
      fileName: true,
      chequeNumber: true,
      paymentDate: true,
      paymentDateValue: true,
      htmlContent: true,
      netPayableAmount: true,
    },
    orderBy: {
      paymentDateValue: "desc",
    },
  });

  const chequeRevenue = (chequeRecords as Array<{
    id: string;
    fileName: string;
    chequeNumber: string | null;
    paymentDate: string | null;
    paymentDateValue: Date | null;
    htmlContent: string;
    netPayableAmount: number | null;
  }>)
    .map((record) => {
      const amountFromHtml = extractNetPayableAmountFromHtml(record.htmlContent);
      const amount =
        typeof amountFromHtml === "number" && Number.isFinite(amountFromHtml)
          ? amountFromHtml
          :
        typeof record.netPayableAmount === "number" && Number.isFinite(record.netPayableAmount)
          ? record.netPayableAmount
          : null;
      if (amount === null) {
        return null;
      }

      const chequeDateValue = record.paymentDateValue ?? parseChequePaymentDate(record.paymentDate);
      if (!chequeDateValue) {
        return null;
      }

      if (startDate && chequeDateValue < startDate) {
        return null;
      }
      if (endDate && chequeDateValue > endDate) {
        return null;
      }

      return {
        id: record.id,
        chequeRef: record.chequeNumber || record.fileName,
        chequeDate: record.paymentDate ?? chequeDateValue.toISOString(),
        amount,
      };
    })
    .filter((entry): entry is { id: string; chequeRef: string; chequeDate: string | null; amount: number } => !!entry);

  const totalRevenue = revenueEligibleOrders.reduce((sum, order) => sum + order.total, 0);

  return {
    totalOrders: orders.length,
    deliveredOrders,
    revenueEligibleOrders: revenueEligibleOrders.length,
    totalRevenue,
    chequeRevenue,
    orders,
  };
};

export const updateSaleTracking = async (
  id: string,
  trackingNumber: string,
  courierStatus: string,
  bookingId?: string,
  courierProvider?: string,
): Promise<Sale> => {
  return await prisma.sale.update({
    where: { id },
    data: {
      trackingNumber,
      courierStatus,
      bookingId,
      ...(courierProvider ? { courierProvider } : {}),
    },
  });
};

export const getLatestCustomerSale = async (customerEmail: string): Promise<Sale | null> => {
  return await prisma.sale.findFirst({
    where: { customerEmail },
    orderBy: { date: "desc" },
  });
};

export const getSalesAnalytics = async (
  startDate: Date,
  endDate: Date,
): Promise<SalesAnalytics> => {
  const sales = await prisma.sale.findMany({
    where: {
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
  });

  const totalRevenue = sales.reduce((acc, sale) => acc + sale.total, 0);
  const totalSales = sales.length;

  return { totalSales, totalRevenue, sales };
};
