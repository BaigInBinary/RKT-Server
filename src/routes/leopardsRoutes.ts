import { Router } from 'express';
import * as leopardsController from '../controllers/leopardsController';

const router: Router = Router();

router.get('/cities', leopardsController.getCities);
router.get('/shipments', leopardsController.getShipmentHistory);
router.get('/payment-details', leopardsController.getPaymentDetails);
router.post('/shipment-details-by-order', leopardsController.getShipmentDetailsByOrder);
router.post('/calculate-shipping', leopardsController.calculateShipping);

export default router;
