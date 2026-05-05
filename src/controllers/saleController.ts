import { Request, Response, NextFunction } from 'express';
import * as saleService from '../services/saleService';
import { sendOrderBookedEmail, sendOrderCancelledEmail } from "../services/orderNotificationService";
import { uploadImageBuffer } from "../config/cloudinary";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const validateSaleItems = (items: unknown): string | null => {
  if (!Array.isArray(items)) {
    return "`items` must be an array.";
  }

  if (items.length === 0) {
    return "`items` must contain at least one item.";
  }

  for (let index = 0; index < items.length; index += 1) {
    const entry = items[index];
    if (!entry || typeof entry !== "object") {
      return `items[${index}] must be an object.`;
    }

    const item = entry as Record<string, unknown>;
    const itemId = typeof item.itemId === "string" ? item.itemId.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";

    if (!itemId) {
      return `items[${index}].itemId is required.`;
    }

    if (!name) {
      return `items[${index}].name is required.`;
    }

    if (!isFiniteNumber(item.price) || item.price < 0) {
      return `items[${index}].price must be a valid number >= 0.`;
    }

    if (!isFiniteNumber(item.quantity) || item.quantity <= 0) {
      return `items[${index}].quantity must be a valid number > 0.`;
    }

    if (!isFiniteNumber(item.total) || item.total < 0) {
      return `items[${index}].total must be a valid number >= 0.`;
    }
  }

  return null;
};

const validateSalePayload = (payload: unknown): string | null => {
  if (!payload || typeof payload !== "object") {
    return "Invalid request body.";
  }

  const body = payload as Record<string, unknown>;
  const itemsError = validateSaleItems(body.items);
  if (itemsError) {
    return itemsError;
  }

  const numberFields = ["subtotal", "tax", "discount", "total"] as const;
  for (const field of numberFields) {
    if (!isFiniteNumber(body[field])) {
      return `\`${field}\` must be a valid number.`;
    }
  }

  const paymentMethod =
    typeof body.paymentMethod === "string" ? body.paymentMethod.trim().toUpperCase() : "";
  if (paymentMethod === "BANK_DEPOSIT") {
    const bankReceiptUrl =
      typeof body.bankReceiptUrl === "string" ? body.bankReceiptUrl.trim() : "";
    if (!bankReceiptUrl) {
      return "`bankReceiptUrl` is required for bank deposit orders.";
    }
  }

  return null;
};

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
    const validationError = validateSalePayload(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

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
    const validationError = validateSalePayload(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

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

export const uploadSaleReceipt = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Receipt image is required" });
    }

    const uploadedImage = await uploadImageBuffer(req.file.buffer, "bank-receipts");
    return res.status(200).json({
      receiptUrl: uploadedImage.secure_url,
      publicId: uploadedImage.public_id,
    });
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

    const shouldAttemptBookedNotification = courierStatus === "Booked";
    const shouldAttemptCancelledNotification = courierStatus === "Cancelled";
    let existingOrderBeforeStatusUpdate: Awaited<ReturnType<typeof saleService.getSaleById>> | null = null;

    if (shouldAttemptBookedNotification || shouldAttemptCancelledNotification) {
      const existingOrder = await saleService.getSaleById(orderId);
      if (!existingOrder) return res.status(404).json({ message: "Order not found" });
      existingOrderBeforeStatusUpdate = existingOrder;
    }

    if (courierStatus === "Booked" && existingOrderBeforeStatusUpdate) {
      const existingOrder = existingOrderBeforeStatusUpdate;

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

          if ((existingOrder.paymentMethod ?? "").trim().toUpperCase() === "BANK_DEPOSIT") {
            await saleService.updateOrderStatus(existingOrder.id, {
              paymentStatus: "paid",
            });
          }
          
          // Return immediately with updated order
          const updated = await saleService.getSaleById(orderId);
          if (updated) {
            try {
              await sendOrderBookedEmail({
                order: updated,
                trackingNumber: bookingResponse.track_number,
              });
            } catch (mailError: any) {
              console.error(
                `Booked notification email failed for order ${updated.id}:`,
                mailError?.message || mailError,
              );
            }
          }
          return res.status(200).json(updated);
        } catch (error: any) {
          console.error("Manual booking failed:", error);
          return res.status(400).json({ message: `Leopards Booking Failed: ${error.message || "Unknown error"}` });
        }
      }
    }

    const order = await saleService.updateOrderStatus(orderId, { courierStatus, paymentStatus });
    if (
      shouldAttemptBookedNotification &&
      order &&
      order.trackingNumber &&
      (existingOrderBeforeStatusUpdate?.courierStatus ?? "").trim().toLowerCase() !== "booked"
    ) {
      try {
        await sendOrderBookedEmail({
          order,
          trackingNumber: order.trackingNumber,
        });
      } catch (mailError: any) {
        console.error(
          `Booked notification email failed for order ${order.id}:`,
          mailError?.message || mailError,
        );
      }
    }

    if (
      shouldAttemptCancelledNotification &&
      order &&
      !["cancelled", "canceled"].includes((existingOrderBeforeStatusUpdate?.courierStatus ?? "").trim().toLowerCase())
    ) {
      try {
        await sendOrderCancelledEmail({ order });
      } catch (mailError: any) {
        console.error(
          `Cancelled notification email failed for order ${order.id}:`,
          mailError?.message || mailError,
        );
      }
    }

    res.status(200).json(order);
  } catch (error) {
    next(error);
  }
};
