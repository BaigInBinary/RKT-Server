import { Category } from "@prisma/client";
export declare const getAllCategories: () => Promise<Category[]>;
export declare const createCategory: (name: string) => Promise<Category>;
export declare const deleteCategory: (id: string) => Promise<Category>;
