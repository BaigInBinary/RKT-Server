import { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const defaultConfig = () => ({
  username: process.env.MNP_USERNAME || "",
  password: process.env.MNP_PASSWORD || "",
  accountNo: process.env.MNP_ACCOUNT_NO || "",
  locationId: process.env.MNP_LOCATION_ID || "",
  returnLocation: process.env.MNP_RETURN_LOCATION || "",
  subAccountId: process.env.MNP_SUB_ACCOUNT_ID ? Number(process.env.MNP_SUB_ACCOUNT_ID) : null,
  insertType: process.env.MNP_INSERT_TYPE ? Number(process.env.MNP_INSERT_TYPE) : 19,
  service: process.env.MNP_SERVICE || "Overnight",
  fragile: process.env.MNP_FRAGILE || "NO",
  baseUrl: process.env.MNP_API_URL || "https://mnpcourier.com/mycodapi/api/",
  trackingUrl: process.env.MNP_TRACKING_URL || "https://tracking.mulphilog.com.pk/api/",
  isSandbox: (process.env.MNP_API_URL || "").toLowerCase().includes("staging"),
});

export const getConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    let config = await (prisma as any).mnpConfig.findFirst();

    if (!config) {
      config = await (prisma as any).mnpConfig.create({
        data: defaultConfig(),
      });
    }

    res.status(200).json(config);
  } catch (error) {
    next(error);
  }
};

export const updateConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      username,
      password,
      accountNo,
      locationId,
      returnLocation,
      subAccountId,
      insertType,
      service,
      fragile,
      baseUrl,
      trackingUrl,
      isSandbox,
    } = req.body;

    const parsedSubAccountId =
      subAccountId === "" || subAccountId === null || subAccountId === undefined
        ? null
        : Number(subAccountId);
    const parsedInsertType =
      insertType === "" || insertType === null || insertType === undefined
        ? 19
        : Number(insertType);

    if (parsedSubAccountId !== null && (!Number.isInteger(parsedSubAccountId) || parsedSubAccountId <= 0)) {
      return res.status(400).json({
        message: "Sub Account ID must be a positive numeric value provided by M&P. It is not the same as Account No.",
      });
    }

    if (!Number.isInteger(parsedInsertType) || parsedInsertType <= 0) {
      return res.status(400).json({ message: "Insert Type must be a positive numeric value." });
    }

    if (typeof returnLocation === "string" && returnLocation.trim() && !/^\d+$/.test(returnLocation.trim())) {
      return res.status(400).json({
        message: "Return Location must be the numeric return location ID provided by M&P, not the shop address.",
      });
    }

    const data = {
      username,
      password,
      accountNo,
      locationId,
      returnLocation,
      subAccountId: parsedSubAccountId,
      insertType: parsedInsertType,
      service,
      fragile,
      baseUrl,
      trackingUrl,
      isSandbox,
    };

    let config = await (prisma as any).mnpConfig.findFirst();

    if (config) {
      config = await (prisma as any).mnpConfig.update({
        where: { id: config.id },
        data,
      });
    } else {
      config = await (prisma as any).mnpConfig.create({ data });
    }

    res.status(200).json(config);
  } catch (error) {
    next(error);
  }
};
