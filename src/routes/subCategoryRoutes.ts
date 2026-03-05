import express, { type Router } from 'express';
import * as subCategoryController from '../controllers/subCategoryController';
import { authenticate, authorizeRoles } from "../middlewares/authMiddleware";

const router: Router = express.Router();

router.use(authenticate);

router.get(
  '/',
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"),
  subCategoryController.getSubCategories,
);
router.get(
  '/:id',
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"),
  subCategoryController.getSubCategory,
);
router.post(
  '/',
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER"),
  subCategoryController.createSubCategory,
);
router.put(
  '/:id',
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER"),
  subCategoryController.updateSubCategory,
);
router.delete(
  '/:id',
  authorizeRoles("SUPER_ADMIN", "ADMIN"),
  subCategoryController.deleteSubCategory,
);

export default router;
