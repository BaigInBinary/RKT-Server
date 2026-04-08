import { Request, Response, NextFunction } from 'express';
import { getAllLeopardsCities } from '../services/leopardsService';

export const getCities = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cities = await getAllLeopardsCities();
    res.status(200).json(cities);
  } catch (error) {
    next(error);
  }
};
