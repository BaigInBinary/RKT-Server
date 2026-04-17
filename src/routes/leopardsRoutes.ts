import { Router } from 'express';
import * as leopardsController from '../controllers/leopardsController';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router: Router = Router();

// Configure multer for temporary file storage
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

router.get('/cities', leopardsController.getCities);
router.get('/shipments', leopardsController.getShipmentHistory);
router.post('/sync-shipment', leopardsController.syncShipment);
router.get('/payment-details', leopardsController.getPaymentDetails);
router.post('/shipment-details-by-order', leopardsController.getShipmentDetailsByOrder);
router.post('/calculate-shipping', leopardsController.calculateShipping);
router.post('/book-shipment', leopardsController.bookShipment);
router.post('/extract-excel', upload.single('file'), leopardsController.extractExcel);
router.post('/cheques/save', leopardsController.saveChequeRecord);
router.post('/cheques/sync-to-shipments', leopardsController.syncChequeToShipments);
router.get('/cheques', leopardsController.getChequeRecords);
router.get('/cheques/:id', leopardsController.getChequeRecordById);
router.delete('/cheques/:id', leopardsController.deleteChequeRecord);

export default router;
