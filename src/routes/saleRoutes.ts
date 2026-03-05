import express, { type Router } from 'express';
import * as saleController from '../controllers/saleController';

const router: Router = express.Router();

router.get('/', saleController.getSales);
router.get('/analytics', saleController.getAnalytics);
router.post('/', saleController.createSale);
router.put('/:id', saleController.updateSale);
router.delete('/:id', saleController.deleteSale);

export default router;
