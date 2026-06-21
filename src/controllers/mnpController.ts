import { Request, Response, NextFunction } from "express";
import {
  buildMnpLocalShipmentFromOrder,
  bookMnpShipment,
  getAllMnpCities,
  getMnpPaymentDetails,
  getMnpPaymentReport,
  getMnpShipmentByOrderIds,
  getMnpShipmentHistory,
  getMnpTariff,
  trackMnpShipment,
  upsertMnpLocalShipmentHistory,
  voidMnpConsignments,
} from "../services/mnpService";
import { getSaleById, updateOrderStatus as updateLocalOrderStatus, updateSaleTracking } from "../services/saleService";
import { sendOrderBookedEmail } from "../services/orderNotificationService";
import prisma from "../config/prisma";

const mapShipmentRecordToApi = (shipment: any) => ({
  booking_date: shipment.bookingDate || "",
  delivery_date: shipment.deliveryDate || "",
  shipper_id: shipment.shipperId ?? null,
  tracking_number: shipment.trackingNumber,
  booked_packet_weight: shipment.bookedPacketWeight || "",
  arival_dispatch_weight: shipment.arivalDispatchWeight || "",
  booked_packet_order_id: shipment.bookedPacketOrderId || "",
  origin_city: shipment.originCity || "",
  destination_city: shipment.destinationCity || "",
  consignment_name_eng: shipment.consignmentNameEng || "",
  consignment_phone: shipment.consignmentPhone || "",
  consignment_address: shipment.consignmentAddress || "",
  booked_packet_status: shipment.bookedPacketStatus || "",
  shipment_type: shipment.shipmentType || "",
  cod_value: shipment.codValue || "",
  courier_provider: shipment.courierProvider || "mnp",
  cheque_ref: shipment.chequeRef || null,
  cheque_date: shipment.chequeDate || null,
});

const isBrokenMnpStatus = (status?: string | null) => {
  const normalized = String(status || "").trim().toLowerCase();
  return (
    !normalized ||
    normalized === "unknown" ||
    normalized.includes("object reference not set") ||
    normalized.includes("exception") ||
    normalized.includes("internal server error")
  );
};

const parseMnpAmount = (value: unknown): number => {
  const parsed = Number(String(value || "").replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const isMnpPaymentConfirmed = (detail: any): boolean => {
  return (
    parseMnpAmount(detail?.amount_paid) > 0 ||
    Boolean(String(detail?.payment_id || "").trim()) ||
    Boolean(String(detail?.payment_date || "").trim()) ||
    Boolean(String(detail?.instrument_number || "").trim())
  );
};

const withLocalMnpFallback = (shipment: any, order?: any) => {
  if (!order || shipment?.courierProvider !== "mnp") return shipment;

  const fallback = buildMnpLocalShipmentFromOrder(order, {
    trackingNumber: shipment.trackingNumber,
    bookingOrderId: shipment.bookedPacketOrderId || order.bookingId || order.id,
    status: order.courierStatus,
    source: "shipment-history-read-fallback",
  });

  return {
    ...shipment,
    bookingDate: shipment.bookingDate || fallback.booking_date,
    deliveryDate: shipment.deliveryDate || fallback.delivery_date,
    bookedPacketWeight: shipment.bookedPacketWeight || fallback.booked_packet_weight,
    arivalDispatchWeight: shipment.arivalDispatchWeight || fallback.arival_dispatch_weight,
    bookedPacketOrderId: shipment.bookedPacketOrderId || fallback.booked_packet_order_id,
    originCity: shipment.originCity || fallback.origin_city,
    destinationCity: shipment.destinationCity || fallback.destination_city,
    consignmentNameEng: shipment.consignmentNameEng || fallback.consignment_name_eng,
    consignmentPhone: shipment.consignmentPhone || fallback.consignment_phone,
    consignmentAddress: shipment.consignmentAddress || fallback.consignment_address,
    bookedPacketStatus: isBrokenMnpStatus(shipment.bookedPacketStatus)
      ? fallback.booked_packet_status
      : shipment.bookedPacketStatus,
    shipmentType: shipment.shipmentType || fallback.shipment_type,
    codValue: shipment.codValue || fallback.cod_value,
  };
};

export const getCities = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cities = await getAllMnpCities();
    res.status(200).json(cities);
  } catch (error) {
    next(error);
  }
};

export const calculateShipping = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cityId, cityName, weightGrams, subtotal } = req.body;

    if (!weightGrams) {
      return res.status(400).json({ message: "Weight is required" });
    }

    const result = await getMnpTariff(String(cityName || cityId || ""), Number(weightGrams), Number(subtotal || 0));
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const trackShipment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const trackingNumber = Array.isArray(req.params.trackingNumber)
      ? req.params.trackingNumber[0]
      : req.params.trackingNumber;
    if (!trackingNumber) {
      return res.status(400).json({ message: "Tracking number is required" });
    }
    const result = await trackMnpShipment(trackingNumber);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getShipmentHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shipmentHistoryModel = (prisma as any).shipmentHistory;
    if (!shipmentHistoryModel) {
      return res.status(500).json({
        status: 0,
        message: "ShipmentHistory model is not available. Run: npx prisma generate && npx prisma db push, then restart server.",
      });
    }

    const { startDate, endDate } = req.query;
    const where: Record<string, any> = { courierProvider: "mnp" };

    if (startDate || endDate) {
      where.bookingDate = {};
      if (startDate) where.bookingDate.gte = startDate;
      if (endDate) where.bookingDate.lte = endDate;
    }

    const shipments = await shipmentHistoryModel.findMany({
      where,
      orderBy: [{ bookingDate: "desc" }, { updatedAt: "desc" }],
    });
    const trackingNumbers = shipments
      .map((shipment: any) => String(shipment?.trackingNumber || "").trim())
      .filter(Boolean);
    const orders = trackingNumbers.length > 0
      ? await (prisma as any).sale.findMany({
          where: {
            trackingNumber: { in: trackingNumbers },
            courierProvider: "mnp",
          },
        })
      : [];
    const orderByTracking = new Map(
      orders.map((order: any) => [String(order?.trackingNumber || "").trim(), order]),
    );

    res.status(200).json({
      status: 1,
      shipments: shipments
        .map((shipment: any) => withLocalMnpFallback(shipment, orderByTracking.get(String(shipment?.trackingNumber || "").trim())))
        .map(mapShipmentRecordToApi),
    });
  } catch (error) {
    next(error);
  }
};

export const syncShipment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shipmentHistoryModel = (prisma as any).shipmentHistory;
    if (!shipmentHistoryModel) {
      return res.status(500).json({
        status: 0,
        message: "ShipmentHistory model is not available. Run: npx prisma generate && npx prisma db push, then restart server.",
      });
    }

    const startDate = (req.query.startDate as string) || req.body?.startDate;
    const endDate = (req.query.endDate as string) || req.body?.endDate;
    const history = await getMnpShipmentHistory(startDate, endDate);

    if (!history || history.status !== 1) {
      return res.status(400).json({
        status: 0,
        message: history?.message || "Failed to fetch shipment history from M&P",
      });
    }

    const sourceShipments = Array.isArray(history.shipments) ? [...history.shipments] : [];

    const saleWhere: Record<string, any> = {
      courierProvider: "mnp",
      trackingNumber: { not: null },
    };
    if (startDate || endDate) {
      saleWhere.date = {};
      if (startDate) saleWhere.date.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        saleWhere.date.lte = end;
      }
    }

    const localMnpOrders = await (prisma as any).sale.findMany({
      where: saleWhere,
      orderBy: { date: "desc" },
    });

    const localShipments = await Promise.all(
      localMnpOrders.map(async (order: any) => {
        const trackingNumber = String(order?.trackingNumber || "").trim();
        let tracked: any = null;
        try {
          tracked = trackingNumber ? await trackMnpShipment(trackingNumber) : null;
        } catch (error) {
          tracked = null;
        }

        return buildMnpLocalShipmentFromOrder(order, {
          trackingNumber,
          trackingResult: tracked,
          source: "local-order-tracking",
        });
      }),
    );

    sourceShipments.push(...localShipments.filter((shipment) => shipment.tracking_number));
    const uniqueShipments = new Map<string, any>();

    for (const shipment of sourceShipments) {
      const trackingNumber = String(shipment?.tracking_number || "").trim();
      if (trackingNumber) {
        uniqueShipments.set(trackingNumber, shipment);
      }
    }

    const trackingNumbers = [...uniqueShipments.keys()];
    if (trackingNumbers.length === 0) {
      return res.status(200).json({
        status: 1,
        message: "No valid M&P shipments found to sync",
        totalReceived: sourceShipments.length,
        skipped: sourceShipments.length,
        created: 0,
        updated: 0,
        upserted: 0,
      });
    }

    const existingShipments = await shipmentHistoryModel.findMany({
      where: { trackingNumber: { in: trackingNumbers } },
      select: { trackingNumber: true },
    });
    const existingTrackingNumbers = new Set(existingShipments.map((s: any) => s.trackingNumber));

    await Promise.all(
      trackingNumbers.map((trackingNumber) => {
        const shipment = uniqueShipments.get(trackingNumber);
        const shipmentData = {
          bookingDate: shipment?.booking_date || null,
          deliveryDate: shipment?.delivery_date || null,
          shipperId: shipment?.shipper_id ? Number(shipment.shipper_id) : null,
          trackingNumber,
          bookedPacketWeight: shipment?.booked_packet_weight || null,
          arivalDispatchWeight: shipment?.arival_dispatch_weight || null,
          bookedPacketOrderId: shipment?.booked_packet_order_id || null,
          originCity: shipment?.origin_city || null,
          destinationCity: shipment?.destination_city || null,
          consignmentNameEng: shipment?.consignment_name_eng || null,
          consignmentPhone: shipment?.consignment_phone || null,
          consignmentAddress: shipment?.consignment_address || null,
          bookedPacketStatus: shipment?.booked_packet_status || null,
          shipmentType: shipment?.shipment_type || null,
          codValue: shipment?.cod_value || null,
          courierProvider: "mnp",
          rawPayload: shipment?.rawPayload || shipment,
        };

        return shipmentHistoryModel.upsert({
          where: { trackingNumber },
          create: shipmentData,
          update: shipmentData,
        });
      }),
    );

    const updated = trackingNumbers.filter((trackingNumber) => existingTrackingNumbers.has(trackingNumber)).length;
    const created = trackingNumbers.length - updated;

    res.status(200).json({
      status: 1,
      message: "M&P shipments synced successfully",
      totalReceived: sourceShipments.length,
      skipped: sourceShipments.length - trackingNumbers.length,
      created,
      updated,
      upserted: trackingNumbers.length,
    });
  } catch (error) {
    next(error);
  }
};

export const voidConsignment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawTrackingNumbers =
      req.body?.trackingNumbers ||
      req.body?.consignmentNumbers ||
      req.body?.trackingNumber ||
      req.body?.consignmentNumber;
    const trackingNumbers = Array.isArray(rawTrackingNumbers)
      ? rawTrackingNumbers
      : [rawTrackingNumbers].filter(Boolean);

    if (trackingNumbers.length === 0) {
      return res.status(400).json({ message: "Tracking number is required" });
    }

    const result = await voidMnpConsignments(trackingNumbers);
    if (!result || result.status !== 1) {
      return res.status(400).json({
        status: 0,
        message: result?.error || result?.message || "M&P failed to invalidate consignment",
        result,
      });
    }

    const normalizedTrackingNumbers = trackingNumbers.map((entry: any) => String(entry).trim()).filter(Boolean);

    await (prisma as any).sale.updateMany({
      where: {
        trackingNumber: { in: normalizedTrackingNumbers },
        courierProvider: "mnp",
      },
      data: {
        courierStatus: "Cancelled",
      },
    });

    await (prisma as any).shipmentHistory.updateMany({
      where: {
        trackingNumber: { in: normalizedTrackingNumbers },
        courierProvider: "mnp",
      },
      data: {
        bookedPacketStatus: "Void",
        rawPayload: result,
      },
    });

    res.status(200).json({
      status: 1,
      message: "M&P consignment invalidated successfully",
      result,
    });
  } catch (error) {
    next(error);
  }
};

export const getPaymentDetails = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cnNumbers } = req.query;
    if (!cnNumbers) {
      return res.status(400).json({ message: "CN Numbers are required" });
    }
    const result = await getMnpPaymentDetails(cnNumbers as string);
    const details = Array.isArray((result as any)?.details)
      ? (result as any).details
      : (result ? [result] : []);
    const paidDetails = details.filter(isMnpPaymentConfirmed);
    const paidTrackingNumbers = paidDetails
      .map((detail: any) => String(detail?.booked_packet_cn || "").trim())
      .filter(Boolean);

    let updatedOrders = 0;
    if (paidTrackingNumbers.length > 0) {
      const orders = await (prisma as any).sale.findMany({
        where: {
          trackingNumber: { in: paidTrackingNumbers },
          courierProvider: "mnp",
        },
        select: { id: true, paymentStatus: true },
      });
      const ordersToMarkPaid = orders.filter(
        (order: any) => String(order?.paymentStatus || "").toLowerCase() !== "paid",
      );

      await Promise.all(
        ordersToMarkPaid.map((order: any) => updateLocalOrderStatus(order.id, { paymentStatus: "paid" })),
      );
      updatedOrders = ordersToMarkPaid.length;

      const shipmentHistoryModel = (prisma as any).shipmentHistory;
      if (shipmentHistoryModel) {
        await Promise.all(
          paidDetails.map((detail: any) => {
            const trackingNumber = String(detail?.booked_packet_cn || "").trim();
            if (!trackingNumber) return Promise.resolve();

            return shipmentHistoryModel.updateMany({
              where: {
                trackingNumber,
                courierProvider: "mnp",
              },
              data: {
                chequeRef: String(detail?.payment_id || detail?.instrument_number || "Paid").trim(),
                chequeDate: detail?.payment_date ? String(detail.payment_date) : null,
              },
            });
          }),
        );
      }
    }

    if (result && typeof result === "object") {
      (result as any).updated_orders = updatedOrders;
    }
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getPaymentReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate } = req.query;
    const result = await getMnpPaymentReport(startDate as string | undefined, endDate as string | undefined);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getShipmentDetailsByOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderIds } = req.body;
    if (!orderIds || !Array.isArray(orderIds)) {
      return res.status(400).json({ message: "Order IDs (array) are required" });
    }
    const result = await getMnpShipmentByOrderIds(orderIds);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const bookShipment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      orderId,
      weight,
      pieces,
      productDetails,
      remarks,
      fragile,
      service,
      insuranceValue,
    } = req.body;

    if (!orderId || !weight) {
      return res.status(400).json({ message: "Order ID and Weight are required" });
    }

    const order = await getSaleById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const bookingData = {
      orderId: order.id,
      customerName: order.customerName || "Customer",
      customerEmail: order.customerEmail || undefined,
      customerPhone: order.customerPhone || "",
      customerAddress: order.shippingAddress || "",
      city: order.city || "Karachi",
      amount: order.total,
      weight: Number(weight),
      pieces: Number(pieces) || 1,
      productDetails: String(
        productDetails ||
        (Array.isArray(order.items)
          ? order.items.map((item: any) => item?.name).filter(Boolean).join(", ")
          : "Order items"),
      ).slice(0, 50),
      remarks: typeof remarks === "string" ? remarks.slice(0, 400) : undefined,
      fragile: typeof fragile === "string"
        ? (fragile.toUpperCase() === "YES" ? "YES" : "NO")
        : undefined,
      service: typeof service === "string" && service.trim() ? service.trim().slice(0, 50) : undefined,
      insuranceValue: insuranceValue === undefined || insuranceValue === null
        ? "0"
        : String(insuranceValue).replace(/,/g, "").slice(0, 20),
    };

    const result = await bookMnpShipment(bookingData);
    const bookingOrderId =
      (typeof result?.booking_order_id === "string" && result.booking_order_id.trim()) ||
      (typeof result?.order_id === "string" && result.order_id.trim()) ||
      order.id;

    if (result && result.status === 1 && result.track_number) {
      const updatedOrder = await updateSaleTracking(
        order.id,
        result.track_number,
        "Booked",
        bookingOrderId,
        "mnp",
      );

      const orderAfterPaymentUpdate =
        (order.paymentMethod ?? "").trim().toUpperCase() === "BANK_DEPOSIT"
          ? await updateLocalOrderStatus(order.id, { paymentStatus: "paid" })
          : updatedOrder;

      await upsertMnpLocalShipmentHistory(orderAfterPaymentUpdate, {
        trackingNumber: result.track_number,
        bookingOrderId,
        weightGrams: Number(weight),
        status: "Booked",
        bookingData,
        source: "mnp-booking",
      });

      try {
        await sendOrderBookedEmail({
          order: orderAfterPaymentUpdate,
          trackingNumber: result.track_number,
          bookingOrderId,
          courierName: "M&P",
        });
      } catch (mailError: any) {
        console.error(`Booked notification email failed for order ${orderAfterPaymentUpdate.id}:`, mailError?.message || mailError);
      }

      return res.status(200).json({
        status: 1,
        message: result.message || "M&P shipment booked successfully",
        track_number: result.track_number,
        order: orderAfterPaymentUpdate,
      });
    }

    res.status(400).json({
      status: 0,
      message: result.error || result.message || "M&P API failed to book shipment",
    });
  } catch (error) {
    next(error);
  }
};
