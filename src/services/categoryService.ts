import prisma from "../config/prisma";
import { Category, Prisma } from "@prisma/client";

export type CreateCategoryInput = Prisma.CategoryCreateInput;
export type UpdateCategoryInput = Prisma.CategoryUpdateInput;

export const getAllCategories = async (): Promise<Category[]> => {
  return await prisma.category.findMany({
    orderBy: { name: "asc" },
  });
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
