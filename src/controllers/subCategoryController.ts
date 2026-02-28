import { NextFunction, Request, Response } from 'express';
import * as categoryService from '../services/categoryService';
import * as subCategoryService from '../services/subCategoryService';

export const getSubCategories = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const categoryId = req.query.categoryId as string | undefined;

    if (categoryId) {
      const subCategories =
        await subCategoryService.getSubCategoriesByCategoryId(categoryId);
      return res.status(200).json(subCategories);
    }

    const subCategories = await subCategoryService.getAllSubCategories();
    res.status(200).json(subCategories);
  } catch (error) {
    next(error);
  }
};

export const getSubCategory = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const subCategory = await subCategoryService.getSubCategoryById(
      req.params.id as string,
    );
    if (!subCategory) {
      return res.status(404).json({ message: 'Sub-category not found' });
    }
    res.status(200).json(subCategory);
  } catch (error) {
    next(error);
  }
};

export const createSubCategory = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { name, categoryId } = req.body as {
      name?: string;
      categoryId?: string;
    };

    if (!name || !categoryId) {
      return res.status(400).json({
        message: 'Both name and categoryId are required',
      });
    }

    const category = await categoryService.getCategoryById(categoryId);
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const existingSubCategory =
      await subCategoryService.getSubCategoryByNameAndCategoryId(
        name,
        categoryId,
      );
    if (existingSubCategory) {
      return res.status(409).json({
        message: 'Sub-category already exists in this category',
      });
    }

    const subCategory = await subCategoryService.createSubCategory({
      name,
      category: {
        connect: { id: categoryId },
      },
    });

    res.status(201).json(subCategory);
  } catch (error) {
    next(error);
  }
};

export const updateSubCategory = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { name, categoryId } = req.body as {
      name?: string;
      categoryId?: string;
    };

    const existingSubCategory = await subCategoryService.getSubCategoryById(
      req.params.id as string,
    );
    if (!existingSubCategory) {
      return res.status(404).json({ message: 'Sub-category not found' });
    }

    const targetCategoryId = categoryId ?? existingSubCategory.categoryId;
    const targetName = name ?? existingSubCategory.name;

    const data: subCategoryService.UpdateSubCategoryInput = {};

    if (name) {
      data.name = name;
    }

    if (categoryId) {
      const category = await categoryService.getCategoryById(categoryId);
      if (!category) {
        return res.status(404).json({ message: 'Category not found' });
      }
      data.category = {
        connect: { id: categoryId },
      };
    }

    const duplicateSubCategory =
      await subCategoryService.getSubCategoryByNameAndCategoryId(
        targetName,
        targetCategoryId,
      );
    if (duplicateSubCategory && duplicateSubCategory.id !== req.params.id) {
      return res.status(409).json({
        message: 'Sub-category already exists in this category',
      });
    }

    const subCategory = await subCategoryService.updateSubCategory(
      req.params.id as string,
      data,
    );
    res.status(200).json(subCategory);
  } catch (error) {
    next(error);
  }
};

export const deleteSubCategory = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    await subCategoryService.deleteSubCategory(req.params.id as string);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
