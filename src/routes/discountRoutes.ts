import express, { type Router } from "express";
import * as discountController from "../controllers/discountController";
import { authenticate, authorizeRoles } from "../middlewares/authMiddleware";

const router: Router = express.Router();

router.use(authenticate);

router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"),
  discountController.getDiscounts,
);
router.post(
  "/calculate",
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"),
  discountController.calculateDiscounts,
);
router.get(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"),
  discountController.getDiscount,
);
router.post(
  "/",
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER"),
  discountController.createDiscount,
);
router.put(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER"),
  discountController.updateDiscount,
);
router.delete(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "ADMIN"),
  discountController.deleteDiscount,
);

export default router;
