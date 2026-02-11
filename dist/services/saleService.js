"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSalesAnalytics = exports.createSale = exports.getAllSales = void 0;
const prisma_1 = __importDefault(require("../config/prisma"));
const getAllSales = async () => {
    return await prisma_1.default.sale.findMany({
        orderBy: { date: "desc" },
    });
};
exports.getAllSales = getAllSales;
const createSale = async (data) => {
    // Use a transaction to ensure both sale creation and stock update succeed
    return await prisma_1.default.$transaction(async (tx) => {
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
exports.createSale = createSale;
const getSalesAnalytics = async (startDate, endDate) => {
    const sales = await prisma_1.default.sale.findMany({
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
exports.getSalesAnalytics = getSalesAnalytics;
//# sourceMappingURL=saleService.js.map