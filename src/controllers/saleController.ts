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
    
    // Automatically book shipment if shipping details are present
    if (sale.customerName && sale.customerPhone && sale.shippingAddress && sale.city) {
      try {
        const weight = sale.items.reduce((sum, item) => sum + (item.quantity * 500), 0) || 500;
        
        const bookingResponse = await bookLeopardsShipment({
          orderId: sale.id,
          customerName: sale.customerName,
          customerPhone: sale.customerPhone,
          customerAddress: sale.shippingAddress,
          city: sale.city,
          amount: sale.total,
          weight
        });
        
        if (bookingResponse && bookingResponse.track_number) {
          await saleService.updateSaleTracking(
            sale.id, 
            bookingResponse.track_number, 
            "Booked",
            bookingResponse.order_id // Assuming the response might have an internal ID, or just store track_number
          );
          sale.trackingNumber = bookingResponse.track_number;
          sale.courierStatus = "Booked";
        }
      } catch (error) {
        console.error("Failed to automatically book Leopards shipment:", error);
      }
    }

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

export const updateOrderStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { courierStatus, paymentStatus } = req.body as {
      courierStatus?: string;
      paymentStatus?: string;
    };

    const VALID_COURIER_STATUSES = ["Pending", "Booked", "In Transit", "Out for Delivery", "Delivered", "Returned", "Cancelled"];
    const VALID_PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"];

    if (courierStatus && !VALID_COURIER_STATUSES.includes(courierStatus)) {
      return res.status(400).json({ message: `Invalid courierStatus. Must be one of: ${VALID_COURIER_STATUSES.join(", ")}` });
    }
    if (paymentStatus && !VALID_PAYMENT_STATUSES.includes(paymentStatus)) {
      return res.status(400).json({ message: `Invalid paymentStatus. Must be one of: ${VALID_PAYMENT_STATUSES.join(", ")}` });
    }

    const order = await saleService.updateOrderStatus(orderId, { courierStatus, paymentStatus });
    res.status(200).json(order);
  } catch (error) {
    next(error);
  }
};
