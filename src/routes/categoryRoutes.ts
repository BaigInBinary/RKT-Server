import express, { type Router } from 'express';
import * as categoryController from '../controllers/categoryController';
import { authenticate, authorizeRoles } from "../middlewares/authMiddleware";

const router: Router = express.Router();

router.get('/public', categoryController.getPublicCategories);

router.use(authenticate);

router.get(
  '/',
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"),
  categoryController.getCategories,
);
router.get(
  '/:id',
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"),
  categoryController.getCategory,
);
router.post(
  '/',
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER"),
  categoryController.createCategory,
);
router.put(
  '/:id',
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER"),
  categoryController.updateCategory,
);
router.delete(
  '/:id',
  authorizeRoles("SUPER_ADMIN", "ADMIN"),
  categoryController.deleteCategory,
);

export default router;
