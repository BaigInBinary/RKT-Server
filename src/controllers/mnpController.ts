import { Request, Response, NextFunction } from "express";
import {
  buildMnpLocalShipmentFromOrder,
  bookMnpShipment,
  bookMnpBulkShipments,
  closeMnpShipperAdvice,
  getAllMnpCities,
  getMnpAdvices,
  getMnpPaymentDetails,
  getMnpPaymentReport,
  getMnpProofOfDelivery,
  getMnpShipmentByOrderIds,
  getMnpShipmentHistory,
  getMnpShipperAdvices,
  getMnpTariff,
  getMnpTicketDetails,
  mapMnpStatusToCourierStatus,
  trackMnpShipment,
  trackMnpShipmentsBulk,
  upsertMnpLocalShipmentHistory,
  verifyMnpConnection,
  voidMnpConsignments,
  type MnpBookingData,
} from "../services/mnpService";
import {
  analysePaymentRows,
  extractPaymentIdFromTracking,
  normalizePaymentRows,
  type MnpPaymentRowInput,
} from "../services/mnpPaymentReportService";
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

// Ordered pipeline used to decide whether a freshly tracked M&P status is a
// step forward for a local order. Terminal statuses are handled separately.
const COURIER_STATUS_RANK: Record<string, number> = {
  pending: 0,
  booked: 1,
  "in transit": 2,
  "out for delivery": 3,
  delivered: 4,
};
const TERMINAL_COURIER_STATUSES = new Set(["delivered", "returned", "cancelled", "canceled"]);

const shouldAdvanceCourierStatus = (current: string | null | undefined, next: string): boolean => {
  const currentNorm = String(current || "").trim().toLowerCase();
  const nextNorm = next.trim().toLowerCase();
  if (!nextNorm || currentNorm === nextNorm) return false;
  // Respect an already-terminal local status (admin cancellation, prior delivery/return).
  if (TERMINAL_COURIER_STATUSES.has(currentNorm)) return false;
  // A terminal courier truth (Delivered / Returned / Cancelled) always applies.
  if (TERMINAL_COURIER_STATUSES.has(nextNorm)) return true;
  // Otherwise only move forward through the pipeline, never backwards.
  const currentRank = COURIER_STATUS_RANK[currentNorm] ?? 0;
  const nextRank = COURIER_STATUS_RANK[nextNorm] ?? 0;
  return nextRank > currentRank;
};

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

// M&P bulk tracking takes 200 CNs per call, so this is 10 calls per sync run.
const MAX_PAYMENT_SYNC_SHIPMENTS = 2000;

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
    const scope = String(req.query.scope || "booking") === "delivery" ? "delivery" : "booking";
    const cities = await getAllMnpCities(scope);
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

    // Track every local order in one Bulk_Consignment_Tracking_New call (max
    // 200 CNs per request) instead of one CNTracking request per order.
    const localTrackingNumbers = localMnpOrders
      .map((order: any) => String(order?.trackingNumber || "").trim())
      .filter(Boolean);
    const bulkTracking = await trackMnpShipmentsBulk(localTrackingNumbers);
    const trackedByCn = new Map(
      (bulkTracking.shipments || []).map((entry: any) => [entry.consignmentNumber, entry]),
    );

    const localShipmentResults = await Promise.all(
      localMnpOrders.map(async (order: any) => {
        const trackingNumber = String(order?.trackingNumber || "").trim();
        const bulkEntry: any = trackingNumber ? trackedByCn.get(trackingNumber) : null;

        let tracked: any = null;
        if (bulkEntry) {
          tracked = {
            status: bulkEntry.status,
            tracking_details: bulkEntry.tracking_details,
            tracking_Details: [bulkEntry.shipment],
          };
        } else if (trackingNumber) {
          // Fall back to single tracking for CNs the bulk endpoint didn't return.
          try {
            tracked = await trackMnpShipment(trackingNumber);
          } catch (error) {
            tracked = null;
          }
        }

        const shipment = buildMnpLocalShipmentFromOrder(order, {
          trackingNumber,
          trackingResult: tracked,
          source: "local-order-tracking",
        });

        return { order, tracked, shipment };
      }),
    );

    // Reflect the freshly tracked M&P status back onto the local order so the
    // Orders board shows real delivery progress instead of a stale "Booked".
    let ordersStatusUpdated = 0;
    await Promise.all(
      localShipmentResults.map(async ({ order, tracked }) => {
        const nextStatus = mapMnpStatusToCourierStatus(tracked?.status);
        if (!nextStatus || !shouldAdvanceCourierStatus(order?.courierStatus, nextStatus)) {
          return;
        }
        try {
          await updateLocalOrderStatus(order.id, { courierStatus: nextStatus });
          ordersStatusUpdated += 1;
        } catch (error) {
          console.error(`Failed to update courier status for order ${order?.id}:`, error);
        }
      }),
    );

    const localShipments = localShipmentResults.map((result) => result.shipment);
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
        ordersUpdated: ordersStatusUpdated,
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
      ordersUpdated: ordersStatusUpdated,
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

/**
 * Saves an uploaded M&P IBFT payment report. The browser does the file parsing
 * (xlsx/csv/html) and posts both the rendered HTML — kept so the admin can always
 * re-read the original document — and the structured rows we reconcile against.
 */
export const saveMnpPaymentReport = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const { fileName, htmlContent, isHtml, rows } = req.body as {
      fileName?: string;
      htmlContent?: string;
      isHtml?: boolean;
      rows?: MnpPaymentRowInput[];
    };

    if (!fileName || !htmlContent) {
      return res.status(400).json({ message: "fileName and htmlContent are required" });
    }

    const normalized = normalizePaymentRows(Array.isArray(rows) ? rows : []);
    if (normalized.length === 0) {
      return res.status(400).json({
        message:
          "No payment rows could be read from this file. Make sure it has a Payment ID column (the M&P IBFT report export).",
      });
    }

    const paymentIds = normalized.map((row) => row.paymentId);
    const existing = await (prisma as any).mnpPaymentEntry.findMany({
      where: { paymentId: { in: paymentIds } },
      select: { paymentId: true },
    });

    if (existing.length > 0) {
      const duplicates = existing.map((entry: any) => entry.paymentId);
      return res.status(409).json({
        message:
          duplicates.length === normalized.length
            ? "This report has already been uploaded — every Payment ID in it is already saved."
            : `Already saved: Payment ID ${duplicates.slice(0, 5).join(", ")}${duplicates.length > 5 ? ` and ${duplicates.length - 5} more` : ""}.`,
        duplicatePaymentIds: duplicates,
      });
    }

    const dates = normalized
      .map((row) => row.paidOnValue)
      .filter((value): value is Date => value instanceof Date);

    const totals = normalized.reduce(
      (acc, row) => ({
        rrAmount: acc.rrAmount + row.rrAmount,
        invoiceAmount: acc.invoiceAmount + row.invoiceAmount,
        ibftFee: acc.ibftFee + row.ibftFee,
        taxAmount: acc.taxAmount + row.taxAmount,
        netPayable: acc.netPayable + row.netPayable,
      }),
      { rrAmount: 0, invoiceAmount: 0, ibftFee: 0, taxAmount: 0, netPayable: 0 },
    );

    const report = await (prisma as any).mnpPaymentReport.create({
      data: {
        fileName,
        htmlContent,
        isHtml: !!isHtml,
        rowCount: normalized.length,
        totalRrAmount: totals.rrAmount,
        totalInvoiceAmount: totals.invoiceAmount,
        totalIbftFee: totals.ibftFee,
        totalTaxAmount: totals.taxAmount,
        totalNetPayable: totals.netPayable,
        periodFrom: dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null,
        periodTo: dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null,
      },
    });

    await (prisma as any).mnpPaymentEntry.createMany({
      data: normalized.map((row) => ({ ...row, reportId: report.id })),
    });

    res.status(201).json({ ...report, entries: normalized });
  } catch (error) {
    next(error);
  }
};

export const getMnpPaymentReports = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const reports = await (prisma as any).mnpPaymentReport.findMany({
      select: {
        id: true,
        fileName: true,
        isHtml: true,
        rowCount: true,
        totalRrAmount: true,
        totalInvoiceAmount: true,
        totalIbftFee: true,
        totalTaxAmount: true,
        totalNetPayable: true,
        periodFrom: true,
        periodTo: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json(reports);
  } catch (error) {
    next(error);
  }
};

export const getMnpPaymentReportById = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const { id } = req.params;
    const report = await (prisma as any).mnpPaymentReport.findUnique({
      where: { id },
      include: { entries: { orderBy: { paidOnValue: "asc" } } },
    });

    if (!report) {
      return res.status(404).json({ message: "Payment report not found" });
    }

    res.status(200).json({ ...report, analysis: analysePaymentRows(report.entries) });
  } catch (error) {
    next(error);
  }
};

export const deleteMnpPaymentReport = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const { id } = req.params;
    const report = await (prisma as any).mnpPaymentReport.findUnique({
      where: { id },
      include: { entries: { select: { paymentId: true } } },
    });

    if (!report) {
      return res.status(404).json({ message: "Payment report not found" });
    }

    const paymentIds = report.entries.map((entry: any) => entry.paymentId);

    await (prisma as any).mnpPaymentEntry.deleteMany({ where: { reportId: id } });
    await (prisma as any).mnpPaymentReport.delete({ where: { id } });

    // Unlink any shipments this report had settled, so they show as unpaid again.
    let clearedShipments = 0;
    const shipmentHistoryModel = (prisma as any).shipmentHistory;
    if (shipmentHistoryModel && paymentIds.length > 0) {
      const result = await shipmentHistoryModel.updateMany({
        where: { courierProvider: "mnp", chequeRef: { in: paymentIds } },
        data: { chequeRef: null, chequeDate: null },
      });
      clearedShipments = result.count;
    }

    res.status(200).json({
      message: `Report deleted. ${clearedShipments} shipment(s) were unlinked from its payments.`,
      clearedShipments,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Links M&P shipments to the payouts in a saved IBFT report.
 *
 * The report itself carries no CN numbers, so the join runs the other way: we take
 * the M&P shipments that are still unsettled, ask M&P's tracking API which PaymentID
 * each one was paid under, and stamp the ones whose PaymentID appears in this report.
 */
export const syncMnpPaymentReportToShipments = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const shipmentHistoryModel = (prisma as any).shipmentHistory;
    if (!shipmentHistoryModel) {
      return res.status(500).json({ message: "ShipmentHistory model is not available." });
    }

    const reportId = req.params.id || req.body?.reportId;
    if (!reportId) {
      return res.status(400).json({ message: "reportId is required" });
    }

    const report = await (prisma as any).mnpPaymentReport.findUnique({
      where: { id: reportId },
      include: { entries: true },
    });

    if (!report) {
      return res.status(404).json({ message: "Payment report not found" });
    }

    const paymentsById = new Map<string, any>(
      report.entries.map((entry: any) => [entry.paymentId, entry]),
    );

    // Only shipments that could still be settled by this report — already-linked ones
    // are left alone so a re-sync never rewrites an earlier report's stamp. Newest
    // first, and capped: each batch of 200 CNs is one M&P tracking call, and a first
    // run against years of history would otherwise fire them all at once.
    const candidates = await shipmentHistoryModel.findMany({
      where: {
        courierProvider: "mnp",
        OR: [{ chequeRef: null }, { chequeRef: "" }],
      },
      select: { trackingNumber: true },
      orderBy: { updatedAt: "desc" },
      take: MAX_PAYMENT_SYNC_SHIPMENTS + 1,
    });

    const allTrackingNumbers = candidates
      .map((shipment: any) => String(shipment.trackingNumber || "").trim())
      .filter((value: string) => value && !value.startsWith("MNP-"));

    const trackingNumbers = allTrackingNumbers.slice(0, MAX_PAYMENT_SYNC_SHIPMENTS);
    const skippedShipments = allTrackingNumbers.length - trackingNumbers.length;

    if (trackingNumbers.length === 0) {
      return res.status(200).json({
        message: "No unlinked M&P shipments to check. Sync shipments first, then try again.",
        matched: 0,
        checked: 0,
        totalPayments: report.entries.length,
        matchedShipments: [],
      });
    }

    const tracked = await trackMnpShipmentsBulk(trackingNumbers);
    if (tracked.status !== 1) {
      return res.status(502).json({
        message: (tracked as any).error || "M&P tracking is unavailable, so payments could not be matched.",
      });
    }

    const matches: Array<{ trackingNumber: string; paymentId: string; paidOn: string | null }> = [];
    for (const entry of tracked.shipments) {
      const trackingNumber = String(entry?.consignmentNumber || "").trim();
      const paymentId = extractPaymentIdFromTracking(entry?.shipment);
      if (!trackingNumber || !paymentId) continue;

      const payment = paymentsById.get(paymentId);
      if (!payment) continue;

      matches.push({ trackingNumber, paymentId, paidOn: payment.paidOn ?? null });
    }

    await Promise.all(
      matches.map((match) =>
        shipmentHistoryModel.updateMany({
          where: { trackingNumber: match.trackingNumber, courierProvider: "mnp" },
          data: { chequeRef: match.paymentId, chequeDate: match.paidOn },
        }),
      ),
    );

    const skippedNote =
      skippedShipments > 0
        ? ` ${skippedShipments} older unlinked shipment(s) were not checked this run — sync again to continue.`
        : "";

    res.status(200).json({
      message:
        (matches.length > 0
          ? `Linked ${matches.length} shipment(s) to ${new Set(matches.map((m) => m.paymentId)).size} payment(s) in this report.`
          : "None of the unlinked shipments were paid under a Payment ID from this report.") + skippedNote,
      matched: matches.length,
      checked: trackingNumbers.length,
      skipped: skippedShipments,
      totalPayments: report.entries.length,
      matchedShipments: matches,
    });
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
      city,
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
      city: (typeof city === "string" && city.trim()) ? city.trim() : (order.city || "Karachi"),
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

// Applies the local side-effects of a successful M&P booking (tracking number,
// payment status for bank deposits, shipment history, notification email).
const applyBookingSuccess = async (
  order: any,
  trackNumber: string,
  bookingData: MnpBookingData,
) => {
  const bookingOrderId = order.id;
  const updatedOrder = await updateSaleTracking(order.id, trackNumber, "Booked", bookingOrderId, "mnp");
  const orderAfterPaymentUpdate =
    (order.paymentMethod ?? "").trim().toUpperCase() === "BANK_DEPOSIT"
      ? await updateLocalOrderStatus(order.id, { paymentStatus: "paid" })
      : updatedOrder;

  await upsertMnpLocalShipmentHistory(orderAfterPaymentUpdate, {
    trackingNumber: trackNumber,
    bookingOrderId,
    weightGrams: Number(bookingData.weight),
    status: "Booked",
    bookingData,
    source: "mnp-bulk-booking",
  });

  try {
    await sendOrderBookedEmail({
      order: orderAfterPaymentUpdate,
      trackingNumber: trackNumber,
      bookingOrderId,
      courierName: "M&P",
    });
  } catch (mailError: any) {
    console.error(`Booked notification email failed for order ${order.id}:`, mailError?.message || mailError);
  }
};

export const bookBulkShipments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestedOrders = Array.isArray(req.body?.orders) ? req.body.orders : [];
    if (requestedOrders.length === 0) {
      return res.status(400).json({ status: 0, message: "orders (array of {orderId, weight, ...}) is required" });
    }

    const bookingDataList: MnpBookingData[] = [];
    const skipped: Array<{ orderId: string; message: string }> = [];
    const orderById = new Map<string, any>();

    for (const requested of requestedOrders) {
      const orderId = String(requested?.orderId || "").trim();
      if (!orderId) continue;

      const order = await getSaleById(orderId);
      if (!order) {
        skipped.push({ orderId, message: "Order not found" });
        continue;
      }
      if (order.trackingNumber) {
        skipped.push({ orderId, message: `Already booked (CN ${order.trackingNumber})` });
        continue;
      }

      const fallbackWeight = Array.isArray(order.items)
        ? order.items.reduce((sum: number, item: any) => sum + (Number(item?.quantity || 0) * 500), 0)
        : 0;
      const fallbackPieces = Array.isArray(order.items)
        ? order.items.reduce((sum: number, item: any) => sum + Number(item?.quantity || 0), 0)
        : 0;

      orderById.set(order.id, order);
      bookingDataList.push({
        orderId: order.id,
        customerName: order.customerName || "Customer",
        customerEmail: order.customerEmail || undefined,
        customerPhone: order.customerPhone || "",
        customerAddress: order.shippingAddress || "",
        city: requested?.city || order.city || "Karachi",
        amount: order.total,
        weight: Number(requested?.weight) || fallbackWeight || 500,
        pieces: Number(requested?.pieces) || fallbackPieces || 1,
        productDetails: String(
          requested?.productDetails ||
          (Array.isArray(order.items)
            ? order.items.map((item: any) => item?.name).filter(Boolean).join(", ")
            : "Order items"),
        ).slice(0, 50),
        remarks: typeof requested?.remarks === "string" ? requested.remarks.slice(0, 400) : undefined,
        fragile: typeof requested?.fragile === "string" ? requested.fragile : undefined,
        service: typeof requested?.service === "string" && requested.service.trim()
          ? requested.service.trim().slice(0, 50)
          : undefined,
        insuranceValue: requested?.insuranceValue === undefined || requested?.insuranceValue === null
          ? "0"
          : String(requested.insuranceValue).replace(/,/g, "").slice(0, 20),
      });
    }

    if (bookingDataList.length === 0) {
      return res.status(400).json({ status: 0, message: "No bookable orders in the request", skipped });
    }

    const result = await bookMnpBulkShipments(bookingDataList);
    const results = Array.isArray(result.results) ? result.results : [];

    for (const entry of results) {
      if (!entry.success || !entry.trackNumber) continue;
      const order = orderById.get(entry.orderId);
      const bookingData = bookingDataList.find((data) => data.orderId === entry.orderId);
      if (!order || !bookingData) continue;
      try {
        await applyBookingSuccess(order, entry.trackNumber, bookingData);
      } catch (error: any) {
        entry.message = `Booked as ${entry.trackNumber} but local update failed: ${error?.message || error}`;
      }
    }

    const booked = results.filter((entry: any) => entry.success).length;
    res.status(result.status === 1 || booked > 0 ? 200 : 400).json({
      status: result.status === 1 || booked > 0 ? 1 : 0,
      message: result.error || result.message || `Booked ${booked} of ${bookingDataList.length} order(s)`,
      booked,
      results,
      skipped,
    });
  } catch (error) {
    next(error);
  }
};

export const getProofOfDelivery = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const trackingNumber = String(req.params.trackingNumber || "").trim();
    if (!trackingNumber) {
      return res.status(400).json({ status: 0, message: "Tracking number is required" });
    }
    const result = await getMnpProofOfDelivery(trackingNumber);
    res.status(result.status === 1 ? 200 : 400).json(result);
  } catch (error) {
    next(error);
  }
};

export const listShipperAdvices = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = String(req.query.scope || "active") === "closed" ? "closed" : "active";
    const result = await getMnpShipperAdvices({
      scope,
      cn: req.query.cn ? String(req.query.cn) : undefined,
      startDate: req.query.startDate ? String(req.query.startDate) : undefined,
      endDate: req.query.endDate ? String(req.query.endDate) : undefined,
    });
    res.status(result.status === 1 ? 200 : 400).json(result);
  } catch (error) {
    next(error);
  }
};

export const respondToShipperAdvice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { consignment, adviceOption, reattempt, remarks, consigneeAddress, consigneePhone } = req.body || {};
    const result = await closeMnpShipperAdvice({
      consignment: String(consignment || ""),
      adviceOption: Number(adviceOption) as 1 | 2 | 3,
      reattempt: reattempt ? (Number(reattempt) as 1 | 2 | 3 | 4) : undefined,
      remarks: typeof remarks === "string" ? remarks : undefined,
      consigneeAddress: typeof consigneeAddress === "string" ? consigneeAddress : undefined,
      consigneePhone: typeof consigneePhone === "string" ? consigneePhone : undefined,
    });
    res.status(result.status === 1 ? 200 : 400).json(result);
  } catch (error) {
    next(error);
  }
};

export const getAdviceTicketDetails = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cn = String(req.params.cn || "").trim();
    if (!cn) {
      return res.status(400).json({ status: 0, message: "Consignment number is required" });
    }
    const [tickets, advices] = await Promise.all([
      getMnpTicketDetails(cn),
      getMnpAdvices(cn),
    ]);
    res.status(200).json({
      status: 1,
      tickets: tickets.tickets || [],
      advices: advices.advices || [],
    });
  } catch (error) {
    next(error);
  }
};

export const verifyConnection = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await verifyMnpConnection();
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
