import express, { type Router } from 'express';
import * as itemController from '../controllers/itemController';
import { imageUpload } from "../middlewares/uploadMiddleware";

const router: Router = express.Router();

router.get('/', itemController.getItems);
router.get('/alerts', itemController.getStockAlerts);
router.post(
  "/upload-image",
  imageUpload.single("image"),
  itemController.uploadItemImage,
);
router.get('/:id', itemController.getItem);
router.post('/', itemController.createItem);
router.put('/:id', itemController.updateItem);
router.delete('/:id', itemController.deleteItem);

export default router;
