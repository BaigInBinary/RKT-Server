import express, { type Router } from "express";
import * as mediaController from "../controllers/mediaController";
import { authenticate, authorizeAccountTypes, authorizeRoles } from "../middlewares/authMiddleware";

const router: Router = express.Router();

router.use(authenticate, authorizeAccountTypes("ADMIN_PORTAL"));
router.get(
  "/images",
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER"),
  mediaController.getMediaImages,
);

export default router;
