import { Router, Request, Response } from "express";
import {
  calculateCourierShipping,
  getActiveCourierProvider,
  getCourierCities,
  getCourierName,
  normalizeCourierProvider,
} from "../services/courierService";

const router: Router = Router();

router.get("/active", (_req: Request, res: Response) => {
  const provider = getActiveCourierProvider();
  res.json({
    provider,
    courierName: getCourierName(provider),
  });
});

router.get("/cities", async (req: Request, res: Response) => {
  try {
    const provider = req.query.provider
      ? normalizeCourierProvider(req.query.provider as string)
      : getActiveCourierProvider();
    const cities = await getCourierCities(provider);
    res.json(cities);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/calculate-shipping", async (req: Request, res: Response) => {
  try {
    const provider = req.body.provider
      ? normalizeCourierProvider(req.body.provider)
      : getActiveCourierProvider();
    const result = await calculateCourierShipping(req.body, provider);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
