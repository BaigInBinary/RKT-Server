import express, { type Router } from 'express';
import * as authController from '../controllers/authController';
import { authenticate, authorizeAccountTypes, authorizeRoles } from "../middlewares/authMiddleware";

const router: Router = express.Router();

router.post('/admin/register', authController.register);
router.post('/admin/login', authController.login);
router.post('/customer/register', authController.registerCustomer);
router.post('/customer/login', authController.loginCustomer);

// Backward-compatible aliases for the admin portal flow.
router.post('/register', authController.register);
router.post('/login', authController.login);
router.get("/me", authenticate, authController.me);
router.get(
  "/users",
  authenticate,
  authorizeAccountTypes("ADMIN_PORTAL"),
  authorizeRoles("SUPER_ADMIN"),
  authController.listUsers,
);
router.patch(
  "/users/:id/access",
  authenticate,
  authorizeAccountTypes("ADMIN_PORTAL"),
  authorizeRoles("SUPER_ADMIN"),
  authController.updateUserAccess,
);

export default router;
