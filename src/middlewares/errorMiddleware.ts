import { Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";

export interface AppError extends Error {
  statusCode?: number;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  console.error("Error:", err.message);
  if (process.env.NODE_ENV === "development") {
    console.error(err.stack);
  }

  // Handle Prisma errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002":
        return res.status(409).json({
          success: false,
          message: "A record with this value already exists",
          field: (err.meta?.target as string[])?.join(", "),
        });
      case "P2025":
        return res.status(404).json({
          success: false,
          message: "Record not found",
        });
      default:
        return res.status(400).json({
          success: false,
          message: `Database error: ${err.message}`,
        });
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    return res.status(400).json({
      success: false,
      message: "Invalid data provided",
    });
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  res.status(statusCode).json({
    success: false,
    message,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
};
