import prisma from "../config/prisma";
import { Item, Prisma } from "@prisma/client";

export type CreateItemInput = Prisma.ItemCreateInput;
export type UpdateItemInput = Prisma.ItemUpdateInput;

export const getAllItems = async (): Promise<Item[]> => {
  return await prisma.item.findMany({
    orderBy: { createdAt: "desc" },
  });
};

export const getItemById = async (id: string): Promise<Item | null> => {
  return await prisma.item.findUnique({
    where: { id },
  });
};

export const createItem = async (data: CreateItemInput): Promise<Item> => {
  return await prisma.item.create({
    data,
  });
};

export const updateItem = async (
  id: string,
  data: UpdateItemInput,
): Promise<Item> => {
  return await prisma.item.update({
    where: { id },
    data,
  });
};

export const deleteItem = async (id: string): Promise<Item> => {
  return await prisma.item.delete({
    where: { id },
  });
};

export const getStockAlerts = async (): Promise<Item[]> => {
  const items = await prisma.item.findMany();
  return items.filter((item) => item.quantity <= item.minStock);
};
