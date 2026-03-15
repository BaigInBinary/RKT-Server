import express, { type Router } from "express";
import * as collectionController from "../controllers/collectionController";
import { authenticate, authorizeAccountTypes, authorizeRoles } from "../middlewares/authMiddleware";

const router: Router = express.Router();

router.get("/", collectionController.listPublicCollections);
router.get("/:idOrSlug/items", collectionController.getPublicCollectionItems);
router.get("/:idOrSlug", collectionController.getPublicCollection);

router.use(authenticate, authorizeAccountTypes("ADMIN_PORTAL"));

router.get(
  "/admin/all",
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER"),
  collectionController.listAdminCollections,
);
router.post(
  "/",
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER"),
  collectionController.createCollection,
);
router.put(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "ADMIN", "MANAGER"),
  collectionController.updateCollection,
);
router.delete(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "ADMIN"),
  collectionController.deleteCollection,
);

export default router;
