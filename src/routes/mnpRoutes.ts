import { Router } from "express";
import * as mnpController from "../controllers/mnpController";

const router: Router = Router();

router.get("/cities", mnpController.getCities);
router.get("/track/:trackingNumber", mnpController.trackShipment);
router.get("/shipments", mnpController.getShipmentHistory);
router.post("/sync-shipment", mnpController.syncShipment);
router.get("/payment-details", mnpController.getPaymentDetails);
router.get("/payment-report", mnpController.getPaymentReport);
router.post("/shipment-details-by-order", mnpController.getShipmentDetailsByOrder);
router.post("/calculate-shipping", mnpController.calculateShipping);
router.post("/book-shipment", mnpController.bookShipment);
router.post("/void-consignment", mnpController.voidConsignment);

export default router;
