import prisma from "../config/prisma";
import { DeliveryRateConfig } from "@prisma/client";

export interface DeliveryRateConfigInput {
  ratePerKg: number;
  minimumCharge: number;
  freeAboveOrderValue?: number | null;
  isActive?: boolean;
}

export interface DeliveryChargeResult {
  weightInGrams: number;
  deliveryCharge: number;
  isFree: boolean;
  config: {
    ratePerKg: number;
    minimumCharge: number;
    freeAboveOrderValue: number | null;
  };
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export const getActiveConfig = async (): Promise<DeliveryRateConfig | null> => {
  return await prisma.deliveryRateConfig.findFirst({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
  });
};

export const getAllConfigs = async (): Promise<DeliveryRateConfig[]> => {
  return await prisma.deliveryRateConfig.findMany({
    orderBy: { updatedAt: "desc" },
  });
};

export const upsertConfig = async (
  data: DeliveryRateConfigInput,
): Promise<DeliveryRateConfig> => {
  // We use a single active config — find existing and update, or create new
  const existing = await prisma.deliveryRateConfig.findFirst({
    orderBy: { updatedAt: "desc" },
  });

  if (existing) {
    return await prisma.deliveryRateConfig.update({
      where: { id: existing.id },
      data: {
        ratePerKg: data.ratePerKg,
        minimumCharge: data.minimumCharge,
        freeAboveOrderValue: data.freeAboveOrderValue ?? null,
        isActive: data.isActive ?? true,
      },
    });
  }

  return await prisma.deliveryRateConfig.create({
    data: {
      ratePerKg: data.ratePerKg,
      minimumCharge: data.minimumCharge,
      freeAboveOrderValue: data.freeAboveOrderValue ?? null,
      isActive: data.isActive ?? true,
    },
  });
};

export const calculateDeliveryCharge = async (
  weightInGrams: number,
  orderTotal?: number,
): Promise<DeliveryChargeResult> => {
  const config = await getActiveConfig();

  if (!config) {
    return {
      weightInGrams,
      deliveryCharge: 0,
      isFree: false,
      config: { ratePerKg: 0, minimumCharge: 0, freeAboveOrderValue: null },
    };
  }

  // Check free delivery threshold
  if (
    config.freeAboveOrderValue !== null &&
    config.freeAboveOrderValue !== undefined &&
    orderTotal !== undefined &&
    orderTotal >= config.freeAboveOrderValue
  ) {
    return {
      weightInGrams,
      deliveryCharge: 0,
      isFree: true,
      config: {
        ratePerKg: config.ratePerKg,
        minimumCharge: config.minimumCharge,
        freeAboveOrderValue: config.freeAboveOrderValue,
      },
    };
  }

  const weightBased = round2((weightInGrams / 1000) * config.ratePerKg);
  const deliveryCharge = round2(Math.max(config.minimumCharge, weightBased));

  return {
    weightInGrams,
    deliveryCharge,
    isFree: false,
    config: {
      ratePerKg: config.ratePerKg,
      minimumCharge: config.minimumCharge,
      freeAboveOrderValue: config.freeAboveOrderValue ?? null,
    },
  };
};
