import { Router, Request, Response } from "express";
import * as saleService from "../services/saleService";
import { trackLeopardsShipment } from "../services/leopardsService";

const router: Router = Router();

// GET /api/delivery/track/:orderId
router.get("/track/:orderId", async (req: Request, res: Response) => {
    try {
        const orderId = req.params.orderId as string;
        
        // 1. Fetch order from DB (try by ID then by txnRefNo)
        let order = await saleService.getSaleById(orderId);
        
        if (!order) {
            order = await saleService.getSaleByTxnRefNo(orderId);
        }

        if (!order) {
            return res.status(404).json({ error: "Order not found" });
        }

        // 2. If it has a Leopards tracking number, fetch the status
        let courierDetails = null;
        if (order.trackingNumber) {
            courierDetails = await trackLeopardsShipment(order.trackingNumber);
        }

        return res.json({
            orderId: order.id,
            status: order.courierStatus, // Internal status (e.g. Pending, Booked)
            paymentStatus: order.paymentStatus,
            trackingNumber: order.trackingNumber,
            courierDetails,
            items: order.items,
            total: order.total,
            date: order.date
        });

    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;
