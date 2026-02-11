"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const errorMiddleware_1 = require("./middlewares/errorMiddleware");
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const itemRoutes_1 = __importDefault(require("./routes/itemRoutes"));
const categoryRoutes_1 = __importDefault(require("./routes/categoryRoutes"));
const saleRoutes_1 = __importDefault(require("./routes/saleRoutes"));
dotenv_1.default.config();
const app = (0, express_1.default)();
// Middlewares
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// Health Check
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Server is running' });
});
// Routes
app.use('/api/auth', authRoutes_1.default);
app.use('/api/items', itemRoutes_1.default);
app.use('/api/categories', categoryRoutes_1.default);
app.use('/api/sales', saleRoutes_1.default);
// Error Handler
app.use(errorMiddleware_1.errorHandler);
exports.default = app;
//# sourceMappingURL=app.js.map