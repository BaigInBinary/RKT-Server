import { Request, Response, NextFunction } from 'express';
import * as saleService from '../services/saleService';

export const getSales = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sales = await saleService.getAllSales();
    res.status(200).json(sales);
  } catch (error) {
    next(error);
  }
};

import { bookLeopardsShipment } from '../services/leopardsService';

export const createSale = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sale = await saleService.createSale(req.body);
    


    res.status(201).json(sale);
  } catch (error) {
    next(error);
  }
};

export const getLatestCustomerSale = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.authUser;
    if (!user || user.accountType !== "LOCAL_USER") {
      return res.status(403).json({ error: "Access denied" });
    }

    const sale = await saleService.getLatestCustomerSale(user.email);
    if (!sale) {
      return res.status(404).json({ error: "No orders found" });
    }

    res.status(200).json(sale);
  } catch (error) {
    next(error);
  }
};

export const getAnalytics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate } = req.query;
    const analytics = await saleService.getSalesAnalytics(
      new Date(startDate as string),
      new Date(endDate as string)
    );
    res.status(200).json(analytics);
  } catch (error) {
    next(error);
  }
};

export const updateSale = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const saleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const sale = await saleService.updateSale(saleId, req.body);
    res.status(200).json(sale);
  } catch (error) {
    next(error);
  }
};

export const deleteSale = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const saleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await saleService.deleteSale(saleId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

export const getOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orders = await saleService.getAllOrders();
    res.status(200).json(orders);
  } catch (error) {
    next(error);
  }
};

export const getOrderAnalytics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate } = req.query;

    const parsedStartDate =
      typeof startDate === "string" && !Number.isNaN(new Date(startDate).getTime())
        ? new Date(startDate)
        : undefined;
    const parsedEndDate =
      typeof endDate === "string" && !Number.isNaN(new Date(endDate).getTime())
        ? new Date(endDate)
        : undefined;

    const analytics = await saleService.getOrderAnalytics(parsedStartDate, parsedEndDate);
    res.status(200).json(analytics);
  } catch (error) {
    next(error);
  }
};

export const updateOrderStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { courierStatus: rawCourierStatus, paymentStatus: rawPaymentStatus } = req.body as {
      courierStatus?: string;
      paymentStatus?: string;
    };

    const courierStatus = rawCourierStatus === "Canceled" ? "Cancelled" : rawCourierStatus;
    const paymentStatus = typeof rawPaymentStatus === "string"
      ? rawPaymentStatus.toLowerCase()
      : rawPaymentStatus;

    const VALID_COURIER_STATUSES = ["Pending", "Booked", "In Transit", "Out for Delivery", "Delivered", "Returned", "Cancelled", "Canceled"];
    const VALID_PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"];

    if (courierStatus && !VALID_COURIER_STATUSES.includes(courierStatus)) {
      return res.status(400).json({ message: `Invalid courierStatus. Must be one of: ${VALID_COURIER_STATUSES.join(", ")}` });
    }
    if (paymentStatus && !VALID_PAYMENT_STATUSES.includes(paymentStatus)) {
      return res.status(400).json({ message: `Invalid paymentStatus. Must be one of: ${VALID_PAYMENT_STATUSES.join(", ")}` });
    }

    if (courierStatus === "Booked") {
      const existingOrder = await saleService.getSaleById(orderId);
      if (!existingOrder) return res.status(404).json({ message: "Order not found" });

      if (!existingOrder.trackingNumber) {
        if (!existingOrder.customerName || !existingOrder.customerPhone || !existingOrder.shippingAddress || !existingOrder.city) {
          return res.status(400).json({ message: "Order is missing customer details (Name, Phone, Address, City) required to book a Leopards shipment." });
        }

        try {
          const weight = existingOrder.items.reduce((sum, item: any) => sum + (item.quantity * 500), 0) || 500;
          
          const bookingResponse = await bookLeopardsShipment({
            orderId: existingOrder.id,
            customerName: existingOrder.customerName,
            customerPhone: existingOrder.customerPhone,
            customerAddress: existingOrder.shippingAddress,
            city: existingOrder.city,
            amount: existingOrder.total,
            weight
          });
          
          if (!bookingResponse || !bookingResponse.track_number) {
            return res.status(400).json({ message: "Leopards API failed to return a tracking number. Check configuration." });
          }

          // Directly assign it via updateSaleTracking without waiting for generic update below
          await saleService.updateSaleTracking(
            existingOrder.id, 
            bookingResponse.track_number, 
            "Booked",
            bookingResponse.order_id 
          );
          
          // Return immediately with updated order
          const updated = await saleService.getSaleById(orderId);
          return res.status(200).json(updated);
        } catch (error: any) {
          console.error("Manual booking failed:", error);
          return res.status(400).json({ message: `Leopards Booking Failed: ${error.message || "Unknown error"}` });
        }
      }
    }

    const order = await saleService.updateOrderStatus(orderId, { courierStatus, paymentStatus });
    res.status(200).json(order);
  } catch (error) {
    next(error);
  }
};
