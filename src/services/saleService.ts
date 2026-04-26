import prisma from "../config/prisma";
import { Prisma, Sale } from "@prisma/client";

export interface SaleItemInput {
  itemId: string;
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
const MAX_TXN_REF_RETRIES = 5;
const RESTOCK_COURIER_STATUSES = new Set(["returned", "cancelled", "canceled"]);

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

const isOnlineRevenueEligible = (order: Pick<Sale, "paymentMethod" | "paymentStatus" | "courierStatus">): boolean => {
  const paymentMethod = (order.paymentMethod ?? "").trim().toUpperCase();
  const paymentStatus = (order.paymentStatus ?? "").trim().toUpperCase();
  const courierStatus = (order.courierStatus ?? "").trim().toUpperCase();
  const isReturnedOrCancelled =
    courierStatus === "RETURNED" || courierStatus === "CANCELLED" || courierStatus === "CANCELED";
  return paymentMethod === "PREPAID" && paymentStatus === "PAID" && !isReturnedOrCancelled;
};

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
  return await prisma.$transaction(async (tx) => {
    const saleDate = data.date || new Date();
    const quantityMap = buildQuantityMap(data.items);
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

    await applyHourlyAndSoldCountDeltas(tx, saleDate, quantityMap);

    return sale;
  });
};

export const updateSale = async (
  id: string,
  data: UpdateSaleInput,
): Promise<Sale> => {
  return await prisma.$transaction(async (tx) => {
    const existingSale = await tx.sale.findUnique({ where: { id } });
    if (!existingSale) {
      throw new Error("Sale not found");
    }

    const previousItems = existingSale.items as unknown as SaleItemInput[];
    const nextSaleDate = data.date || existingSale.date;
    const normalizedTxnRefNo = normalizeTxnRefNo(data.txnRefNo);

    const previousByItemId = new Map<string, number>();
    const nextByItemId = new Map<string, number>();

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
        deliveryCharge: data.deliveryCharge,
        txnRefNo: normalizedTxnRefNo,
        date: nextSaleDate,
      },
    });
  });
};

export const deleteSale = async (id: string): Promise<void> => {
  await prisma.$transaction(async (tx) => {
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
      for (const item of previousItems) {
        if (!existingItemIds.has(item.itemId)) {
          continue;
        }
        soldDelta.set(item.itemId, (soldDelta.get(item.itemId) || 0) - item.quantity);
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
    }

    await tx.sale.delete({ where: { id } });
  });
};

export const getSaleByTxnRefNo = async (txnRefNo: string): Promise<Sale | null> => {
  return await prisma.sale.findUnique({
    where: { txnRefNo },
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

// Update courier / payment status. When moved to Returned/Cancelled/Canceled,
// this also restores item stock and sold/hourly counters once.
export const updateOrderStatus = async (
  id: string,
  data: UpdateOrderStatusInput,
): Promise<Sale> => {
  return await prisma.$transaction(async (tx) => {
    const existingOrder = await tx.sale.findUnique({ where: { id } });
    if (!existingOrder) {
      throw Object.assign(new Error("Order not found"), { statusCode: 404 });
    }

    const nextCourierStatus = data.courierStatus !== undefined
      ? normalizeCourierStatus(data.courierStatus) ?? existingOrder.courierStatus ?? undefined
      : existingOrder.courierStatus ?? undefined;

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
      for (const item of previousItems) {
        if (!existingItemIds.has(item.itemId)) {
          continue;
        }
        soldDelta.set(item.itemId, (soldDelta.get(item.itemId) || 0) - item.quantity);
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
    }

    return await tx.sale.update({
      where: { id },
      data: {
        ...(data.courierStatus !== undefined && { courierStatus: nextCourierStatus }),
        ...(data.paymentStatus !== undefined && { paymentStatus: data.paymentStatus }),
      },
    });
  });
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

  const revenueEligibleOrders = orders.filter(isOnlineRevenueEligible);
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

  const totalRevenue = chequeRevenue.reduce((sum, entry) => sum + entry.amount, 0);

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
  bookingId?: string
): Promise<Sale> => {
  return await prisma.sale.update({
    where: { id },
    data: {
      trackingNumber,
      courierStatus,
      bookingId,
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
