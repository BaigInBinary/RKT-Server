import { NextFunction, Request, Response } from "express";
import { type UserAccountType, type UserRole, verifyAuthToken } from "../utils/security";

const extractBearerToken = (authHeader?: string): string | null => {
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
};

export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const token = extractBearerToken(req.header("Authorization"));
  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  const payload = verifyAuthToken(token);
  if (!payload) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }

  if (payload.status !== "ACTIVE") {
    return res
      .status(403)
      .json({ message: "Account is not active. Contact super admin." });
  }

  req.authUser = payload;
  next();
};

export const authorizeRoles = (...allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (!allowedRoles.includes(req.authUser.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    next();
  };
};

export const authorizeAccountTypes = (...allowedAccountTypes: UserAccountType[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (!allowedAccountTypes.includes(req.authUser.accountType)) {
      return res.status(403).json({ message: "Access denied for this account type" });
    }

    next();
  };
};
