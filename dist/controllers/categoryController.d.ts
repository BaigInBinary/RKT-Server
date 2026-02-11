import { Request, Response, NextFunction } from 'express';
export declare const getCategories: (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare const createCategory: (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare const deleteCategory: (req: Request, res: Response, next: NextFunction) => Promise<void>;
