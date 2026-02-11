"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserById = exports.createUser = exports.findUserByEmail = void 0;
const prisma_1 = __importDefault(require("../config/prisma"));
const findUserByEmail = async (email) => {
    return await prisma_1.default.user.findUnique({
        where: { email },
    });
};
exports.findUserByEmail = findUserByEmail;
const createUser = async (data) => {
    return await prisma_1.default.user.create({
        data,
    });
};
exports.createUser = createUser;
const getUserById = async (id) => {
    return await prisma_1.default.user.findUnique({
        where: { id },
    });
};
exports.getUserById = getUserById;
//# sourceMappingURL=userService.js.map