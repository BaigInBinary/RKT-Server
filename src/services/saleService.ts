import prisma from "../config/prisma";
import { Sale, Prisma } from "@prisma/client";

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
