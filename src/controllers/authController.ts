import { Request, Response, NextFunction } from 'express';
import * as userService from '../services/userService';
import {
  hashPassword,
  type UserAccountType,
  signAuthToken,
  type UserRole,
  type UserStatus,
  verifyPassword,
} from "../utils/security";

const VALID_ROLES: UserRole[] = ["SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"];
const VALID_STATUSES: UserStatus[] = ["PENDING", "ACTIVE", "SUSPENDED"];
const ADMIN_ACCOUNT_TYPE: UserAccountType = "ADMIN_PORTAL";
const CUSTOMER_ACCOUNT_TYPE: UserAccountType = "LOCAL_USER";

const normalizeRole = (value: unknown): UserRole | null => {
  if (typeof value !== "string") {
    return null;
  }
  const upper = value.toUpperCase() as UserRole;
  return VALID_ROLES.includes(upper) ? upper : null;
};

const normalizeStatus = (value: unknown): UserStatus | null => {
  if (typeof value !== "string") {
    return null;
  }
  const upper = value.toUpperCase() as UserStatus;
  return VALID_STATUSES.includes(upper) ? upper : null;
};

const toAuthUser = (user: any) => ({
  id: user.id as string,
  email: user.email as string,
  name: (user.name ?? "") as string,
  accountType: (user.accountType ?? ADMIN_ACCOUNT_TYPE) as UserAccountType,
  role: (user.role ?? "CASHIER") as UserRole,
  status: (user.status ?? "PENDING") as UserStatus,
  permissions: Array.isArray(user.permissions) ? (user.permissions as string[]) : [],
});

const registerWithAccountType = async (
  req: Request,
  res: Response,
  next: NextFunction,
  accountType: UserAccountType,
) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res
        .status(400)
        .json({ message: "Name, email, and password are required" });
    }

    const existingUser = await userService.findUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const role: UserRole = "CASHIER";
    const status: UserStatus =
      accountType === ADMIN_ACCOUNT_TYPE ? "PENDING" : "ACTIVE";
    const permissions: string[] = [];

    const user = await userService.createUser({
      email,
      password: hashPassword(password),
      name,
      accountType,
      role,
      status,
      permissions,
    });

    return res.status(201).json({
      message:
        accountType === ADMIN_ACCOUNT_TYPE
          ? "Account created and pending super admin approval"
          : "Account created successfully",
      user: toAuthUser(user),
    });
  } catch (error) {
    next(error);
  }
};

const loginWithAccountType = async (
  req: Request,
  res: Response,
  next: NextFunction,
  accountType: UserAccountType,
) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await userService.findUserByEmail(email);
    if (!user || !verifyPassword(password, user.password as string)) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const userAccountType = (user.accountType ?? ADMIN_ACCOUNT_TYPE) as UserAccountType;
    if (userAccountType !== accountType) {
      const portalMessage =
        accountType === ADMIN_ACCOUNT_TYPE
          ? "Use the customer login for local accounts"
          : "Use the admin portal login for staff accounts";
      return res.status(403).json({ message: portalMessage });
    }

    if ((user.status as UserStatus) !== "ACTIVE") {
      return res.status(403).json({
        message: "Account is pending approval by super admin",
      });
    }

    const authUser = toAuthUser(user);
    const token = signAuthToken({
      sub: authUser.id,
      email: authUser.email,
      accountType: authUser.accountType,
      role: authUser.role,
      status: authUser.status,
      permissions: authUser.permissions,
    });

    return res.status(200).json({
      token,
      user: authUser,
    });
  } catch (error) {
    next(error);
  }
};

export const register = async (req: Request, res: Response, next: NextFunction) =>
  registerWithAccountType(req, res, next, ADMIN_ACCOUNT_TYPE);

export const login = async (req: Request, res: Response, next: NextFunction) =>
  loginWithAccountType(req, res, next, ADMIN_ACCOUNT_TYPE);

export const registerCustomer = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => registerWithAccountType(req, res, next, CUSTOMER_ACCOUNT_TYPE);

export const loginCustomer = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => loginWithAccountType(req, res, next, CUSTOMER_ACCOUNT_TYPE);

export const me = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.authUser) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const user = await userService.getSafeUserById(req.authUser.sub);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
};

export const listUsers = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const users = await userService.listSafeUsers();
    return res.status(200).json(users);
  } catch (error) {
    next(error);
  }
};

export const updateUserAccess = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { role, status, permissions } = req.body as {
      role?: string;
      status?: string;
      permissions?: string[];
    };

    const parsedRole = role ? normalizeRole(role) : null;
    if (role && !parsedRole) {
      return res.status(400).json({ message: "Invalid role value" });
    }

    const parsedStatus = status ? normalizeStatus(status) : null;
    if (status && !parsedStatus) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    if (
      permissions !== undefined &&
      (!Array.isArray(permissions) ||
        permissions.some((permission) => typeof permission !== "string"))
    ) {
      return res.status(400).json({ message: "permissions must be a string array" });
    }

    const updatedUser = await userService.updateUserAccess(req.params.id as string, {
      role: parsedRole ?? undefined,
      status: parsedStatus ?? undefined,
      permissions,
    });

    return res.status(200).json(updatedUser);
  } catch (error) {
    next(error);
  }
};
