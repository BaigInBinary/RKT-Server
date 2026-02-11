import { Request, Response, NextFunction } from 'express';
export declare const getItems: (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare const getItem: (req: Request, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const createItem: (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare const updateItem: (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare const deleteItem: (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare const getStockAlerts: (req: Request, res: Response, next: NextFunction) => Promise<void>;
