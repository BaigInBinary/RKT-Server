import express, { type Router } from "express";
import * as siteContentController from "../controllers/siteContentController";
import { authenticate, authorizeRoles } from "../middlewares/authMiddleware";

const router: Router = express.Router();

router.get("/:slug", siteContentController.getSitePageBySlug);

router.use(authenticate);

router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER"),
  siteContentController.getAllSitePages,
);
router.put(
  "/:slug",
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER"),
  siteContentController.upsertSitePageBySlug,
);

export default router;
