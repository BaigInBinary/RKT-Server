import { Request, Response, NextFunction } from 'express';
import * as saleService from '../services/saleService';
import { sendOrderBookedEmail, sendOrderCancelledEmail } from "../services/orderNotificationService";
import { uploadImageBuffer } from "../config/r2";
import { bookCourierShipment, getActiveCourierProvider, getCourierName, normalizeCourierProvider } from "../services/courierService";
import { upsertMnpLocalShipmentHistory } from "../services/mnpService";
import { validateSalePayload } from "../utils/saleValidation";

export const getSales = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sales = await saleService.getAllSales();
    res.status(200).json(sales);
  } catch (error) {
    next(error);
  }
};

export const createSale = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validationError = validateSalePayload(req.body, {
      isAdminPortalRequest: req.authUser?.accountType === "ADMIN_PORTAL",
    });
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
    const existingSale = await saleService.getSaleById(saleId);
    if (!existingSale) {
      return res.status(404).json({ success: false, message: "Sale not found" });
    }

    // This route is admin-only, so it is judged as an admin-portal request.
    // Website orders keep their delivery-contact rules even when the editor
    // does not resend the address.
    const validationError = validateSalePayload(req.body, {
      isAdminPortalRequest: true,
      isExistingWebsiteOrder: !!existingSale.shippingAddress?.trim(),
    });
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

    const uploadedImage = await uploadImageBuffer(
      req.file.buffer,
      "bank-receipts",
      req.file.originalname,
      req.file.mimetype,
    );
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

export const updateOrderCustomerDetails = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const shippingAddress =
      typeof req.body?.shippingAddress === "string" ? req.body.shippingAddress.trim() : "";
    const city = typeof req.body?.city === "string" ? req.body.city.trim() : "";
    const postalCode = typeof req.body?.postalCode === "string" ? req.body.postalCode.trim() : "";

    if (!shippingAddress) {
      return res.status(400).json({ message: "Shipping address is required." });
    }

    const order = await saleService.updateOrderCustomerDetails(orderId, {
      shippingAddress,
      city: city || null,
      postalCode: postalCode || null,
    });

    res.status(200).json(order);
  } catch (error) {
    next(error);
  }
};

export const updateOrderStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const {
      courierStatus: rawCourierStatus,
      paymentStatus: rawPaymentStatus,
      courierProvider: rawCourierProvider,
      mnpBooking,
    } = req.body as {
      courierStatus?: string;
      paymentStatus?: string;
      courierProvider?: string;
      mnpBooking?: {
        weight?: number | string;
        pieces?: number | string;
        productDetails?: string;
        service?: string;
        fragile?: string;
        remarks?: string;
        insuranceValue?: number | string;
      };
    };

    const courierStatus = rawCourierStatus === "Canceled" ? "Cancelled" : rawCourierStatus;
    const paymentStatus = typeof rawPaymentStatus === "string"
      ? rawPaymentStatus.toLowerCase()
      : rawPaymentStatus;

    const VALID_COURIER_STATUSES = ["Pending", "Booked", "In Transit", "Out for Delivery", "Delivered", "Returned", "Cancelled", "Canceled"];
    const VALID_PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"];
    const normalizedRawCourierProvider = typeof rawCourierProvider === "string"
      ? rawCourierProvider.trim().toLowerCase()
      : "";
    const requestedCourierProvider = normalizedRawCourierProvider
      ? normalizeCourierProvider(normalizedRawCourierProvider)
      : undefined;

    if (courierStatus && !VALID_COURIER_STATUSES.includes(courierStatus)) {
      return res.status(400).json({ message: `Invalid courierStatus. Must be one of: ${VALID_COURIER_STATUSES.join(", ")}` });
    }
    if (paymentStatus && !VALID_PAYMENT_STATUSES.includes(paymentStatus)) {
      return res.status(400).json({ message: `Invalid paymentStatus. Must be one of: ${VALID_PAYMENT_STATUSES.join(", ")}` });
    }
    if (normalizedRawCourierProvider && !["leopards", "leopard", "mnp", "m&p", "mnpcourier", "mulphilog"].includes(normalizedRawCourierProvider)) {
      return res.status(400).json({ message: "Invalid courierProvider. Must be leopards or mnp." });
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
          return res.status(400).json({ message: "Order is missing customer details (Name, Phone, Address, City) required to book a courier shipment." });
        }

        try {
          const defaultWeight = existingOrder.items.reduce((sum, item: any) => sum + (item.quantity * 500), 0) || 500;
          const weight = Number(mnpBooking?.weight) || defaultWeight;
          const pieces = Number(mnpBooking?.pieces) || existingOrder.items.reduce((sum, item: any) => sum + (item.quantity || 0), 0) || 1;
          const courierProvider = requestedCourierProvider || getActiveCourierProvider();
          const courierName = getCourierName(courierProvider);
          const defaultProductDetails = existingOrder.items
            .map((item: any) => item?.name)
            .filter(Boolean)
            .join(", ");

          const bookingData = {
            orderId: existingOrder.id,
            customerName: existingOrder.customerName,
            customerEmail: existingOrder.customerEmail || undefined,
            customerPhone: existingOrder.customerPhone,
            customerAddress: existingOrder.shippingAddress,
            city: existingOrder.city,
            amount: existingOrder.total,
            weight,
            pieces,
            ...(courierProvider === "mnp" && {
              productDetails: String(mnpBooking?.productDetails || defaultProductDetails || "Order items").slice(0, 50),
              service: typeof mnpBooking?.service === "string" ? mnpBooking.service.slice(0, 50) : undefined,
              fragile: typeof mnpBooking?.fragile === "string"
                ? (mnpBooking.fragile.toUpperCase() === "YES" ? "YES" : "NO")
                : undefined,
              remarks: typeof mnpBooking?.remarks === "string" ? mnpBooking.remarks.slice(0, 400) : undefined,
              insuranceValue: mnpBooking?.insuranceValue === undefined || mnpBooking.insuranceValue === null
                ? "0"
                : String(mnpBooking.insuranceValue).replace(/,/g, "").slice(0, 20),
            }),
          };

          const bookingResponse = await bookCourierShipment(bookingData, courierProvider);
          const bookingOrderId =
            (typeof bookingResponse?.booking_order_id === "string" && bookingResponse.booking_order_id.trim()) ||
            (typeof bookingResponse?.booked_packet_order_id === "string" && bookingResponse.booked_packet_order_id.trim()) ||
            (typeof bookingResponse?.order_id === "string" && bookingResponse.order_id.trim()) ||
            existingOrder.id;
          
          if (!bookingResponse || bookingResponse.status !== 1 || !bookingResponse.track_number) {
            const bookingError =
              (typeof bookingResponse?.error === "string" && bookingResponse.error.trim()) ||
              (typeof bookingResponse?.message === "string" && bookingResponse.message.trim()) ||
              `${courierName} API failed to return a tracking number. Check configuration.`;
            return res.status(400).json({ message: bookingError });
          }

          // Directly assign it via updateSaleTracking without waiting for generic update below
          const trackedOrder = await saleService.updateSaleTracking(
            existingOrder.id, 
            bookingResponse.track_number, 
            "Booked",
            bookingOrderId,
            courierProvider,
          );

          if (courierProvider === "mnp") {
            await upsertMnpLocalShipmentHistory(trackedOrder, {
              trackingNumber: bookingResponse.track_number,
              bookingOrderId,
              weightGrams: weight,
              status: "Booked",
              bookingData,
              source: "sale-status-booking",
            });
          }

          if ((existingOrder.paymentMethod ?? "").trim().toUpperCase() === "BANK_DEPOSIT") {
            await saleService.updateOrderStatus(existingOrder.id, {
              paymentStatus: "paid",
            });
          }
          
          // Return immediately with updated order
          const updated = await saleService.getSaleById(orderId);
          if (updated) {
            let customerNotification: { sent: boolean; reason?: string } = { sent: false, reason: "not attempted" };
            try {
              customerNotification = await sendOrderBookedEmail({
                order: updated,
                trackingNumber: bookingResponse.track_number,
                bookingOrderId,
                courierName,
              });
            } catch (mailError: any) {
              console.error(
                `Booked notification email failed for order ${updated.id}:`,
                mailError?.message || mailError,
              );
              customerNotification = { sent: false, reason: mailError?.message || "email failed" };
            }
            return res.status(200).json({ ...updated, customerNotification });
          }
          return res.status(200).json(updated);
        } catch (error: any) {
          console.error("Manual booking failed:", error);
          return res.status(400).json({ message: `Courier Booking Failed: ${error.message || "Unknown error"}` });
        }
      }
    }

    const order = await saleService.updateOrderStatus(orderId, { courierStatus, paymentStatus });
    let customerNotification: { sent: boolean; reason?: string } | undefined;
    if (
      shouldAttemptBookedNotification &&
      order &&
      order.trackingNumber &&
      (existingOrderBeforeStatusUpdate?.courierStatus ?? "").trim().toLowerCase() !== "booked"
    ) {
      try {
        customerNotification = await sendOrderBookedEmail({
          order,
          trackingNumber: order.trackingNumber,
          courierName: getCourierName((order as any).courierProvider),
        });
      } catch (mailError: any) {
        console.error(
          `Booked notification email failed for order ${order.id}:`,
          mailError?.message || mailError,
        );
        customerNotification = { sent: false, reason: mailError?.message || "email failed" };
      }
    }

    if (
      shouldAttemptCancelledNotification &&
      order &&
      !["cancelled", "canceled"].includes((existingOrderBeforeStatusUpdate?.courierStatus ?? "").trim().toLowerCase())
    ) {
      try {
        customerNotification = await sendOrderCancelledEmail({ order });
      } catch (mailError: any) {
        console.error(
          `Cancelled notification email failed for order ${order.id}:`,
          mailError?.message || mailError,
        );
        customerNotification = { sent: false, reason: mailError?.message || "email failed" };
      }
    }

    res.status(200).json(customerNotification ? { ...order, customerNotification } : order);
  } catch (error) {
    next(error);
  }
};
