import { Router } from 'express';
import * as leopardsController from '../controllers/leopardsController';

const router = Router();

router.get('/cities', leopardsController.getCities);
router.get('/shipments', leopardsController.getShipmentHistory);
router.get('/activity', leopardsController.getLeopardsActivityLog);
router.post('/calculate-shipping', leopardsController.calculateShipping);

export default router;
