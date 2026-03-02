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
  date?: Date;
}

export interface UpdateSaleInput {
  items: SaleItemInput[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  customerName?: string;
  date?: Date;
}

export interface SalesAnalytics {
  totalSales: number;
  totalRevenue: number;
  sales: Sale[];
}

export const getAllSales = async (): Promise<Sale[]> => {
  return await prisma.sale.findMany({
    orderBy: { date: "desc" },
  });
};

export const createSale = async (data: CreateSaleInput): Promise<Sale> => {
  // Use a transaction to ensure both sale creation and stock update succeed
  return await prisma.$transaction(async (tx) => {
    // 1. Create the sale
    const sale = await tx.sale.create({
      data: {
        items: data.items,
        subtotal: data.subtotal,
        tax: data.tax,
        discount: data.discount,
        total: data.total,
        customerName: data.customerName,
        date: data.date || new Date(),
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

    return await tx.sale.update({
      where: { id },
      data: {
        items: data.items,
        subtotal: data.subtotal,
        tax: data.tax,
        discount: data.discount,
        total: data.total,
        customerName: data.customerName,
        date: data.date || existingSale.date,
      },
    });
  });
};

export const deleteSale = async (id: string): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const existingSale = await tx.sale.findUnique({ where: { id } });
    if (!existingSale) {
      throw new Error("Sale not found");
    }

    const previousItems = existingSale.items as unknown as SaleItemInput[];
    for (const item of previousItems) {
      await tx.item.update({
        where: { id: item.itemId },
        data: {
          quantity: {
            increment: item.quantity,
          },
        },
      });
    }

    await tx.sale.delete({ where: { id } });
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
