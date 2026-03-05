import express, { type Router } from 'express';
import * as saleController from '../controllers/saleController';
import { authenticate, authorizeRoles } from "../middlewares/authMiddleware";

const router: Router = express.Router();

router.use(authenticate);

router.get(
  '/',
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"),
  saleController.getSales,
);
router.get(
  '/analytics',
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER"),
  saleController.getAnalytics,
);
router.post(
  '/',
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"),
  saleController.createSale,
);
router.put(
  '/:id',
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER"),
  saleController.updateSale,
);
router.delete(
  '/:id',
  authorizeRoles("SUPER_ADMIN", "ADMIN"),
  saleController.deleteSale,
);

export default router;
