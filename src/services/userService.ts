import prisma from "../config/prisma";
import { User, Prisma } from "@prisma/client";

export type CreateUserInput = Prisma.UserCreateInput;

export const findUserByEmail = async (email: string): Promise<User | null> => {
  return await prisma.user.findUnique({
    where: { email },
  });
};

export const createUser = async (data: CreateUserInput): Promise<User> => {
  return await prisma.user.create({
    data,
  });
};

export const getUserById = async (id: string): Promise<User | null> => {
  return await prisma.user.findUnique({
    where: { id },
  });
};
