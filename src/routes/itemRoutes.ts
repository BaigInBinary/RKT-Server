import express, { type Router } from 'express';
import * as itemController from '../controllers/itemController';
import { imageUpload } from "../middlewares/uploadMiddleware";
import { authenticate, authorizeRoles } from "../middlewares/authMiddleware";

const router: Router = express.Router();

router.get("/catalog", itemController.getCatalogItems);
router.get("/catalog/:id", itemController.getCatalogItem);
router.get("/top-selling", itemController.getTopSellingItems);

router.use(authenticate);

router.get(
  '/',
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"),
  itemController.getItems,
);
router.get(
  "/new-arrival",
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"),
  itemController.getNewArrivals,
);
router.get(
  '/alerts',
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER"),
  itemController.getStockAlerts,
);
router.post(
  "/upload-image",
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER"),
  imageUpload.single("image"),
  itemController.uploadItemImage,
);
router.get(
  '/:id',
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"),
  itemController.getItem,
);
router.post(
  '/',
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER"),
  itemController.createItem,
);
router.put(
  '/:id',
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER"),
  itemController.updateItem,
);
router.delete(
  '/:id',
  authorizeRoles("SUPER_ADMIN", "ADMIN"),
  itemController.deleteItem,
);

export default router;
