import express from 'express';
import * as saleController from '../controllers/saleController';

const router = express.Router();

router.get('/', saleController.getSales);
router.get('/analytics', saleController.getAnalytics);
router.post('/', saleController.createSale);

export default router;
