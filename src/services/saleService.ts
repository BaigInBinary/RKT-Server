import prisma from "../config/prisma";
import { Sale } from "@prisma/client";

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

type ItemQuantityDelta = Map<string, number>;

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

    // 1. Create the sale
    const sale = await tx.sale.create({
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
        txnRefNo: data.txnRefNo,
        date: saleDate,
      },
    });

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
        txnRefNo: data.txnRefNo,
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

// Update courier / payment status without touching stock or analytics.
export const updateOrderStatus = async (
  id: string,
  data: UpdateOrderStatusInput,
): Promise<Sale> => {
  return await prisma.sale.update({
    where: { id },
    data: {
      ...(data.courierStatus !== undefined && { courierStatus: data.courierStatus }),
      ...(data.paymentStatus !== undefined && { paymentStatus: data.paymentStatus }),
    },
  });
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
