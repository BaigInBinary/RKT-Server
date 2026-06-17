import { Router } from "express";
import * as mnpConfigController from "../controllers/mnpConfigController";
import { authenticate, authorizeAccountTypes, authorizeRoles } from "../middlewares/authMiddleware";

const router: Router = Router();

router.use(authenticate, authorizeAccountTypes("ADMIN_PORTAL"), authorizeRoles("SUPER_ADMIN", "ADMIN"));

router.get("/", mnpConfigController.getConfig);
router.post("/", mnpConfigController.updateConfig);

export default router;
