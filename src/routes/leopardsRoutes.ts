import { Router } from 'express';
import * as leopardsController from '../controllers/leopardsController';

const router = Router();

router.get('/cities', leopardsController.getCities);

export default router;
