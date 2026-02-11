import { Request, Response, NextFunction } from "express";
export interface AppError extends Error {
    statusCode?: number;
}
export declare const errorHandler: (err: AppError, req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
