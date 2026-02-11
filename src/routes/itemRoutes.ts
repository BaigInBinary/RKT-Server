import express from 'express';
import * as itemController from '../controllers/itemController';

const router = express.Router();

router.get('/', itemController.getItems);
router.get('/alerts', itemController.getStockAlerts);
router.get('/:id', itemController.getItem);
router.post('/', itemController.createItem);
router.put('/:id', itemController.updateItem);
router.delete('/:id', itemController.deleteItem);

export default router;
