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
router.post("/book-bulk-shipments", mnpController.bookBulkShipments);
router.post("/void-consignment", mnpController.voidConsignment);
router.get("/proof-of-delivery/:trackingNumber", mnpController.getProofOfDelivery);
router.get("/advices", mnpController.listShipperAdvices);
router.post("/advices/respond", mnpController.respondToShipperAdvice);
router.get("/advices/:cn/details", mnpController.getAdviceTicketDetails);
router.get("/verify-connection", mnpController.verifyConnection);

export default router;
