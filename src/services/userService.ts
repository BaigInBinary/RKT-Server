import prisma from "../config/prisma";
import { type UserAccountType, type UserRole, type UserStatus } from "../utils/security";

export interface SafeUser {
  id: string;
  email: string;
  name: string | null;
  accountType: UserAccountType;
  role: UserRole;
  status: UserStatus;
  permissions: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string;
  accountType?: UserAccountType;
  role?: UserRole;
  status?: UserStatus;
  permissions?: string[];
}

export interface UpdateUserAccessInput {
  role?: UserRole;
  status?: UserStatus;
  permissions?: string[];
}

export interface UpdateUserInput extends UpdateUserAccessInput {
  accountType?: UserAccountType;
  password?: string;
  name?: string;
}

const toSafeUser = (user: any): SafeUser => {
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    accountType: (user.accountType ?? "ADMIN_PORTAL") as UserAccountType,
    role: (user.role ?? "CASHIER") as UserRole,
    status: (user.status ?? "PENDING") as UserStatus,
    permissions: Array.isArray(user.permissions) ? user.permissions : [],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

export const findUserByEmail = async (email: string): Promise<any | null> => {
  return prisma.user.findUnique({
    where: { email },
  } as any);
};

export const createUser = async (data: CreateUserInput): Promise<any> => {
  return prisma.user.create({
    data,
  } as any);
};

export const getUserById = async (id: string): Promise<any | null> => {
  return prisma.user.findUnique({
    where: { id },
  } as any);
};

export const listSafeUsers = async (): Promise<SafeUser[]> => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
  } as any);

  return users.map(toSafeUser);
};

export const getSafeUserById = async (id: string): Promise<SafeUser | null> => {
  const user = await prisma.user.findUnique({
    where: { id },
  } as any);

  return user ? toSafeUser(user) : null;
};

export const updateUserAccess = async (
  id: string,
  data: UpdateUserAccessInput,
): Promise<SafeUser> => {
  const user = await prisma.user.update({
    where: { id },
    data,
  } as any);

  return toSafeUser(user);
};

export const updateUserById = async (
  id: string,
  data: UpdateUserInput,
): Promise<any> => {
  return prisma.user.update({
    where: { id },
    data,
  } as any);
};
