import express, { type Router } from "express";
import * as favoriteController from "../controllers/favoriteController";
import { authenticate } from "../middlewares/authMiddleware";

const router: Router = express.Router();

router.use(authenticate);

router.get("/", favoriteController.getFavorites);
router.post("/", favoriteController.addFavorite);
router.delete("/:itemId", favoriteController.removeFavorite);

export default router;
