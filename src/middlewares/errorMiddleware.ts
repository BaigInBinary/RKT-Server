import { Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import multer from "multer";

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
    const targetMeta = (err.meta as { target?: unknown } | undefined)?.target;
    const targetField = Array.isArray(targetMeta)
      ? targetMeta.join(", ")
      : typeof targetMeta === "string"
        ? targetMeta
        : undefined;

    switch (err.code) {
      case "P2002":
        return res.status(409).json({
          success: false,
          message: "A record with this value already exists",
          field: targetField,
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
    const compactMessage = err.message
      .replace(/\s+/g, " ")
      .trim();
    const enumMatch = compactMessage.match(/Invalid enum value.*Expected ([^,]+), provided ([^.]+)/i);
    const userFriendlyMessage = enumMatch
      ? `Invalid value provided. Expected one of: ${enumMatch[1]}. Received: ${enumMatch[2]}.`
      : compactMessage.includes("Argument")
        ? compactMessage
        : "Invalid data provided";

    return res.status(400).json({
      success: false,
      message: userFriendlyMessage,
    });
  }

  const errorName = (err as { name?: string }).name;
  const errorType = (err as { type?: string }).type;
  const errorMessage = (err.message || "").toLowerCase();

  if (
    errorName === "PayloadTooLargeError" ||
    errorType === "entity.too.large" ||
    errorMessage.includes("request entity too large") ||
    errorMessage.includes("payload too large") ||
    errorMessage.includes("bsonobj size") ||
    errorMessage.includes("bson size")
  ) {
    return res.status(413).json({
      success: false,
      message:
        "This item is too large to save as one record. Please reduce the number of variants or split the product into smaller items.",
    });
  }

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        success: false,
        message: "Image size must be 5MB or less",
      });
    }

    return res.status(400).json({
      success: false,
      message: err.message,
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
