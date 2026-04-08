import { Router } from 'express';
import * as leopardsController from '../controllers/leopardsController';

const router = Router();

router.get('/cities', leopardsController.getCities);
router.post('/calculate-shipping', leopardsController.calculateShipping);

export default router;
