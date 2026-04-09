import { Router } from "express";
import * as leopardsConfigController from "../controllers/leopardsConfigController";
import { authenticate, authorizeAccountTypes, authorizeRoles } from "../middlewares/authMiddleware";

const router: Router = Router();

// Secure admin routes
router.use(authenticate, authorizeAccountTypes("ADMIN_PORTAL"), authorizeRoles("SUPER_ADMIN", "ADMIN"));

router.get("/", leopardsConfigController.getConfig);
router.post("/", leopardsConfigController.updateConfig);

export default router;
