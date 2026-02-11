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
export interface SalesAnalytics {
    totalSales: number;
    totalRevenue: number;
    sales: Sale[];
}
export declare const getAllSales: () => Promise<Sale[]>;
export declare const createSale: (data: CreateSaleInput) => Promise<Sale>;
export declare const getSalesAnalytics: (startDate: Date, endDate: Date) => Promise<SalesAnalytics>;
