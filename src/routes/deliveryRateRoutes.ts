import express, { type Router } from "express";
import * as deliveryRateController from "../controllers/deliveryRateController";
import { authenticate, authorizeAccountTypes, authorizeRoles } from "../middlewares/authMiddleware";

const router: Router = express.Router();

// Public routes
router.get("/", deliveryRateController.getConfig);
router.post("/calculate", deliveryRateController.calculateCharge);

// Admin-only routes
router.use(authenticate, authorizeAccountTypes("ADMIN_PORTAL"));
router.put(
  "/",
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER"),
  deliveryRateController.upsertConfig,
);

export default router;
