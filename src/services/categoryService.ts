import prisma from "../config/prisma";
import { Category } from "@prisma/client";

export const getAllCategories = async (): Promise<Category[]> => {
  return await prisma.category.findMany({
    orderBy: { name: "asc" },
  });
};

export const createCategory = async (name: string): Promise<Category> => {
  return await prisma.category.create({
    data: { name },
  });
};

export const deleteCategory = async (id: string): Promise<Category> => {
  return await prisma.category.delete({
    where: { id },
  });
};
