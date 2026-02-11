"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStockAlerts = exports.deleteItem = exports.updateItem = exports.createItem = exports.getItemById = exports.getAllItems = void 0;
const prisma_1 = __importDefault(require("../config/prisma"));
const getAllItems = async () => {
    return await prisma_1.default.item.findMany({
        orderBy: { createdAt: "desc" },
    });
};
exports.getAllItems = getAllItems;
const getItemById = async (id) => {
    return await prisma_1.default.item.findUnique({
        where: { id },
    });
};
exports.getItemById = getItemById;
const createItem = async (data) => {
    return await prisma_1.default.item.create({
        data,
    });
};
exports.createItem = createItem;
const updateItem = async (id, data) => {
    return await prisma_1.default.item.update({
        where: { id },
        data,
    });
};
exports.updateItem = updateItem;
const deleteItem = async (id) => {
    return await prisma_1.default.item.delete({
        where: { id },
    });
};
exports.deleteItem = deleteItem;
const getStockAlerts = async () => {
    const items = await prisma_1.default.item.findMany();
    return items.filter((item) => item.quantity <= item.minStock);
};
exports.getStockAlerts = getStockAlerts;
//# sourceMappingURL=itemService.js.map