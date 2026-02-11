import { Request, Response, NextFunction } from 'express';
export declare const getSales: (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare const createSale: (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare const getAnalytics: (req: Request, res: Response, next: NextFunction) => Promise<void>;
