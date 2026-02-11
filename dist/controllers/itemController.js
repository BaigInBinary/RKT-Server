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
exports.getStockAlerts = exports.deleteItem = exports.updateItem = exports.createItem = exports.getItem = exports.getItems = void 0;
const itemService = __importStar(require("../services/itemService"));
const getItems = async (req, res, next) => {
    try {
        const items = await itemService.getAllItems();
        res.status(200).json(items);
    }
    catch (error) {
        next(error);
    }
};
exports.getItems = getItems;
const getItem = async (req, res, next) => {
    try {
        const item = await itemService.getItemById(req.params.id);
        if (!item) {
            return res.status(404).json({ message: 'Item not found' });
        }
        res.status(200).json(item);
    }
    catch (error) {
        next(error);
    }
};
exports.getItem = getItem;
const createItem = async (req, res, next) => {
    try {
        const item = await itemService.createItem(req.body);
        res.status(201).json(item);
    }
    catch (error) {
        next(error);
    }
};
exports.createItem = createItem;
const updateItem = async (req, res, next) => {
    try {
        const item = await itemService.updateItem(req.params.id, req.body);
        res.status(200).json(item);
    }
    catch (error) {
        next(error);
    }
};
exports.updateItem = updateItem;
const deleteItem = async (req, res, next) => {
    try {
        await itemService.deleteItem(req.params.id);
        res.status(204).send();
    }
    catch (error) {
        next(error);
    }
};
exports.deleteItem = deleteItem;
const getStockAlerts = async (req, res, next) => {
    try {
        const alerts = await itemService.getStockAlerts();
        res.status(200).json(alerts);
    }
    catch (error) {
        next(error);
    }
};
exports.getStockAlerts = getStockAlerts;
//# sourceMappingURL=itemController.js.map