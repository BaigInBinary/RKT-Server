import { Router, Request, Response } from "express";
import * as saleService from "../services/saleService";
import { getCourierName, trackCourierShipment } from "../services/courierService";

const router: Router = Router();

// GET /api/delivery/track/:orderId
router.get("/track/:orderId", async (req: Request, res: Response) => {
    try {
        const orderId = req.params.orderId as string;
        
        // 1. Fetch order from DB (try by ID, then by txnRefNo, then by CN/tracking number)
        let order = await saleService.getSaleById(orderId);
        
        if (!order) {
            order = await saleService.getSaleByTxnRefNo(orderId);
        }

        if (!order) {
            order = await saleService.getSaleByTrackingNumber(orderId);
        }

        if (!order) {
            return res.status(404).json({ error: "Order not found" });
        }

        // 2. If it has a courier tracking number, fetch the status. A courier
        // API outage must not hide the order itself from the customer.
        let courierDetails = null;
        if (order.trackingNumber) {
            try {
                courierDetails = await trackCourierShipment(order.trackingNumber, (order as any).courierProvider);
            } catch (trackingError: any) {
                console.error(`Courier tracking failed for ${order.trackingNumber}:`, trackingError?.message || trackingError);
            }
        }
        const courierProvider = (order as any).courierProvider || null;

        return res.json({
            orderId: order.id,
            status: order.courierStatus, // Internal status (e.g. Pending, Booked)
            paymentStatus: order.paymentStatus,
            trackingNumber: order.trackingNumber,
            courierProvider,
            courierName: getCourierName(courierProvider),
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
