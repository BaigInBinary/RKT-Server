import express from 'express';
import * as categoryController from '../controllers/categoryController';

const router = express.Router();

router.get('/', categoryController.getCategories);
router.post('/', categoryController.createCategory);
router.delete('/:id', categoryController.deleteCategory);

export default router;
