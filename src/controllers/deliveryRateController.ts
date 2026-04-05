import { Request, Response, NextFunction } from "express";
import * as deliveryRateService from "../services/deliveryRateService";

export const getConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await deliveryRateService.getActiveConfig();
    if (!config) {
      return res.status(404).json({ message: "No delivery rate config found" });
    }
    res.status(200).json(config);
  } catch (error) {
    next(error);
  }
};

export const upsertConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ratePerKg, minimumCharge, freeAboveOrderValue, freeBelowWeightLimit, isActive } = req.body;

    if (ratePerKg === undefined || ratePerKg === null) {
      return res.status(400).json({ message: "ratePerKg is required" });
    }
    if (minimumCharge === undefined || minimumCharge === null) {
      return res.status(400).json({ message: "minimumCharge is required" });
    }

    const config = await deliveryRateService.upsertConfig({
      ratePerKg: Number(ratePerKg),
      minimumCharge: Number(minimumCharge),
      freeAboveOrderValue:
        freeAboveOrderValue !== undefined && freeAboveOrderValue !== null && freeAboveOrderValue !== ""
          ? Number(freeAboveOrderValue)
          : null,
      freeBelowWeightLimit:
        freeBelowWeightLimit !== undefined && freeBelowWeightLimit !== null && freeBelowWeightLimit !== ""
          ? Number(freeBelowWeightLimit)
          : null,
      isActive: isActive !== undefined ? Boolean(isActive) : true,
    });

    res.status(200).json(config);
  } catch (error) {
    next(error);
  }
};

export const calculateCharge = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const weightInGrams = Number(req.body.weightInGrams);
    const orderTotal =
      req.body.orderTotal !== undefined && req.body.orderTotal !== null
        ? Number(req.body.orderTotal)
        : undefined;

    if (!Number.isFinite(weightInGrams) || weightInGrams < 0) {
      return res.status(400).json({ message: "weightInGrams must be a non-negative number" });
    }

    const result = await deliveryRateService.calculateDeliveryCharge(weightInGrams, orderTotal);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
