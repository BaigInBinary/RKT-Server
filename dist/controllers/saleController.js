"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAnalytics = exports.createSale = exports.getSales = void 0;
const saleService = __importStar(require("../services/saleService"));
const getSales = async (req, res, next) => {
    try {
        const sales = await saleService.getAllSales();
        res.status(200).json(sales);
    }
    catch (error) {
        next(error);
    }
};
exports.getSales = getSales;
const createSale = async (req, res, next) => {
    try {
        const sale = await saleService.createSale(req.body);
        res.status(201).json(sale);
    }
    catch (error) {
        next(error);
    }
};
exports.createSale = createSale;
const getAnalytics = async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;
        const analytics = await saleService.getSalesAnalytics(new Date(startDate), new Date(endDate));
        res.status(200).json(analytics);
    }
    catch (error) {
        next(error);
    }
};
exports.getAnalytics = getAnalytics;
//# sourceMappingURL=saleController.js.map