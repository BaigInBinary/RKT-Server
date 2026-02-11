import { Item, Prisma } from "@prisma/client";
export type CreateItemInput = Prisma.ItemCreateInput;
export type UpdateItemInput = Prisma.ItemUpdateInput;
export declare const getAllItems: () => Promise<Item[]>;
export declare const getItemById: (id: string) => Promise<Item | null>;
export declare const createItem: (data: CreateItemInput) => Promise<Item>;
export declare const updateItem: (id: string, data: UpdateItemInput) => Promise<Item>;
export declare const deleteItem: (id: string) => Promise<Item>;
export declare const getStockAlerts: () => Promise<Item[]>;
