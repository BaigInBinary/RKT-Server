"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteCategory = exports.createCategory = exports.getAllCategories = void 0;
const prisma_1 = __importDefault(require("../config/prisma"));
const getAllCategories = async () => {
    return await prisma_1.default.category.findMany({
        orderBy: { name: "asc" },
    });
};
exports.getAllCategories = getAllCategories;
const createCategory = async (name) => {
    return await prisma_1.default.category.create({
        data: { name },
    });
};
exports.createCategory = createCategory;
const deleteCategory = async (id) => {
    return await prisma_1.default.category.delete({
        where: { id },
    });
};
exports.deleteCategory = deleteCategory;
//# sourceMappingURL=categoryService.js.map