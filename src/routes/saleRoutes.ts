import express, { type Router } from 'express';
import * as saleController from '../controllers/saleController';
import { authenticate, authorizeAccountTypes, authorizeRoles } from "../middlewares/authMiddleware";

const router: Router = express.Router();

router.post(
  '/',
  authenticate,
  saleController.createSale,
);

router.get(
  '/customer/latest',
  authenticate,
  saleController.getLatestCustomerSale,
);

router.use(authenticate, authorizeAccountTypes("ADMIN_PORTAL"));

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
router.get(
  '/orders',
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"),
  saleController.getOrders,
);
router.patch(
  '/orders/:id/status',
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER"),
  saleController.updateOrderStatus,
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
