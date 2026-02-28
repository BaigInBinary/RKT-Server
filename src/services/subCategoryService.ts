import prisma from '../config/prisma';
import { Prisma, SubCategory } from '@prisma/client';

export type CreateSubCategoryInput = Prisma.SubCategoryCreateInput;
export type UpdateSubCategoryInput = Prisma.SubCategoryUpdateInput;

export const getAllSubCategories = async (): Promise<SubCategory[]> => {
  return await prisma.subCategory.findMany({
    orderBy: { name: 'asc' },
  });
};

export const getSubCategoryById = async (
  id: string,
): Promise<SubCategory | null> => {
  return await prisma.subCategory.findUnique({
    where: { id },
  });
};

export const getSubCategoriesByCategoryId = async (
  categoryId: string,
): Promise<SubCategory[]> => {
  return await prisma.subCategory.findMany({
    where: { categoryId },
    orderBy: { name: 'asc' },
  });
};

export const getSubCategoryByNameAndCategoryId = async (
  name: string,
  categoryId: string,
): Promise<SubCategory | null> => {
  return await prisma.subCategory.findFirst({
    where: {
      name,
      categoryId,
    },
  });
};

export const createSubCategory = async (
  data: CreateSubCategoryInput,
): Promise<SubCategory> => {
  return await prisma.subCategory.create({
    data,
  });
};

export const updateSubCategory = async (
  id: string,
  data: UpdateSubCategoryInput,
): Promise<SubCategory> => {
  return await prisma.subCategory.update({
    where: { id },
    data,
  });
};

export const deleteSubCategory = async (id: string): Promise<SubCategory> => {
  return await prisma.subCategory.delete({
    where: { id },
  });
};
