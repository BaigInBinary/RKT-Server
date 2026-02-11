import { User, Prisma } from '@prisma/client';
export type CreateUserInput = Prisma.UserCreateInput;
export declare const findUserByEmail: (email: string) => Promise<User | null>;
export declare const createUser: (data: CreateUserInput) => Promise<User>;
export declare const getUserById: (id: string) => Promise<User | null>;
