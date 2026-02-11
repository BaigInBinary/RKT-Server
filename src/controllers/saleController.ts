import { Request, Response, NextFunction } from 'express';
import * as saleService from '../services/saleService';

export const getSales = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sales = await saleService.getAllSales();
    res.status(200).json(sales);
  } catch (error) {
    next(error);
  }
};

export const createSale = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sale = await saleService.createSale(req.body);
    res.status(201).json(sale);
  } catch (error) {
    next(error);
  }
};

export const getAnalytics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate } = req.query;
    const analytics = await saleService.getSalesAnalytics(
      new Date(startDate as string),
      new Date(endDate as string)
    );
    res.status(200).json(analytics);
  } catch (error) {
    next(error);
  }
};
