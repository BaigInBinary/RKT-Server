import { Request, Response, NextFunction } from 'express';
import * as categoryService from '../services/categoryService';

export const getCategories = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = await categoryService.getAllCategories();
    res.status(200).json(categories);
  } catch (error) {
    next(error);
  }
};

export const createCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const category = await categoryService.createCategory(req.body.name);
    res.status(201).json(category);
  } catch (error) {
    next(error);
  }
};

export const deleteCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await categoryService.deleteCategory(req.params.id as string);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
