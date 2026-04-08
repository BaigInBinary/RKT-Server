import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    let config = await prisma.leopardsConfig.findFirst();
    
    // If no config exists, create one with .env defaults as a starting point
    if (!config) {
      config = await prisma.leopardsConfig.create({
        data: {
          apiKey: process.env.LEOPARDS_API_KEY || "",
          apiPassword: process.env.LEOPARDS_API_PASSWORD || "",
          originCity: "4",
          shipmentType: "1",
          baseUrl: process.env.LEOPARDS_API_URL || "https://merchantapi.leopardscourier.com/api/",
          isSandbox: (process.env.LEOPARDS_API_URL || "").includes("staging")
        }
      });
    }

    res.status(200).json(config);
  } catch (error) {
    next(error);
  }
};

export const updateConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { apiKey, apiPassword, originCity, shipmentType, baseUrl, isSandbox } = req.body;
    
    let config = await prisma.leopardsConfig.findFirst();

    if (config) {
      config = await prisma.leopardsConfig.update({
        where: { id: config.id },
        data: { apiKey, apiPassword, originCity, shipmentType, baseUrl, isSandbox }
      });
    } else {
      config = await prisma.leopardsConfig.create({
        data: { apiKey, apiPassword, originCity, shipmentType, baseUrl, isSandbox }
      });
    }

    res.status(200).json(config);
  } catch (error) {
    next(error);
  }
};
