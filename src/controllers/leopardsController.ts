import { Request, Response, NextFunction } from 'express';
import { getAllLeopardsCities, getLeopardsTariff, getLeopardsShipmentHistory } from '../services/leopardsService';

export const getCities = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cities = await getAllLeopardsCities();
    res.status(200).json(cities);
  } catch (error) {
    next(error);
  }
};

export const calculateShipping = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cityId, weightGrams, subtotal } = req.body;
    
    if (!cityId || !weightGrams) {
      return res.status(400).json({ message: "City ID and Weight are required" });
    }

    const result = await getLeopardsTariff(parseInt(cityId), parseFloat(weightGrams), parseFloat(subtotal || 0));
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getShipmentHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate } = req.query;
    const history = await getLeopardsShipmentHistory(startDate as string, endDate as string);
    res.status(200).json(history);
  } catch (error) {
    next(error);
  }
};
