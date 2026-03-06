import prisma from "../config/prisma";
import { Category, Prisma } from "@prisma/client";

export type CreateCategoryInput = Prisma.CategoryCreateInput;
export type UpdateCategoryInput = Prisma.CategoryUpdateInput;

export const getAllCategories = async (): Promise<Category[]> => {
  return await prisma.category.findMany({
    orderBy: { name: "asc" },
  });
};

export interface PublicCategoryItem {
  name: string;
  itemCount: number;
}

export const getPublicCategoriesWithItems = async (): Promise<PublicCategoryItem[]> => {
  const grouped = await prisma.item.groupBy({
    by: ["category"],
    _count: {
      _all: true,
    },
    orderBy: {
      category: "asc",
    },
  });

  return grouped
    .map((entry) => ({
      name: entry.category?.trim(),
      itemCount: entry._count._all,
    }))
    .filter((entry): entry is PublicCategoryItem => Boolean(entry.name) && entry.itemCount > 0);
};

export const getCategoryById = async (id: string): Promise<Category | null> => {
  return await prisma.category.findUnique({
    where: { id },
  });
};

export const createCategory = async (
  data: CreateCategoryInput,
): Promise<Category> => {
  return await prisma.category.create({
    data,
  });
};

export const updateCategory = async (
  id: string,
  data: UpdateCategoryInput,
): Promise<Category> => {
  return await prisma.category.update({
    where: { id },
    data,
  });
};

export const deleteCategory = async (id: string): Promise<Category> => {
  return await prisma.category.delete({
    where: { id },
  });
};
