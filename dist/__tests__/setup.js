"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../config/prisma"));
beforeAll(async () => {
    // Connect to the database
    await prisma_1.default.$connect();
});
afterAll(async () => {
    // Disconnect from the database
    await prisma_1.default.$disconnect();
});
//# sourceMappingURL=setup.js.map