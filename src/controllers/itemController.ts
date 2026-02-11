import { Request, Response, NextFunction } from 'express';
import * as itemService from '../services/itemService';

export const getItems = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await itemService.getAllItems();
    res.status(200).json(items);
  } catch (error) {
    next(error);
  }
};

export const getItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await itemService.getItemById(req.params.id as string);
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }
    res.status(200).json(item);
  } catch (error) {
    next(error);
  }
};

export const createItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await itemService.createItem(req.body);
    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
};

export const updateItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await itemService.updateItem(req.params.id as string, req.body);
    res.status(200).json(item);
  } catch (error) {
    next(error);
  }
};

export const deleteItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await itemService.deleteItem(req.params.id as string);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

export const getStockAlerts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const alerts = await itemService.getStockAlerts();
    res.status(200).json(alerts);
  } catch (error) {
    next(error);
  }
};
