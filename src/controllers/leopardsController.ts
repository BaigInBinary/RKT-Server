import { Request, Response, NextFunction } from 'express';
import { getAllLeopardsCities, getLeopardsTariff, getLeopardsShipmentHistory, getLeopardsPaymentDetails, getLeopardsShipmentByOrderIds, bookLeopardsShipment } from '../services/leopardsService';
import { getSaleById, updateSaleTracking } from '../services/saleService';
import { sendOrderBookedEmail } from "../services/orderNotificationService";
import prisma from '../config/prisma';

const parseChequePaymentDate = (value?: string | null): Date | null => {
  if (!value || typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const isoDate = new Date(normalized);
  if (!Number.isNaN(isoDate.getTime())) {
    return isoDate;
  }

  const match = normalized.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!day || !month || !year) {
    return null;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseSignedAmount = (value: string): number | null => {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const hasParentheses = normalized.includes("(") && normalized.includes(")");
  const isNegative = normalized.includes("-") || hasParentheses;
  const numeric = normalized
    .replace(/,/g, "")
    .replace(/[^\d.]/g, "");
  const parsed = Number(numeric);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return isNegative ? -parsed : parsed;
};

const extractNetPayableAmountFromHtml = (htmlContent?: string | null): number | null => {
  if (!htmlContent || typeof htmlContent !== "string") {
    return null;
  }

  const plainText = htmlContent
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ");
  const marker = /net\s*payable\s*amount/i;
  const markerMatch = marker.exec(plainText);

  if (!markerMatch) {
    return null;
  }

  const startIndex = markerMatch.index + markerMatch[0].length;
  const slice = plainText.slice(startIndex, startIndex + 200);
  const amountTokenMatch = slice.match(/[+\-]?\s*\(?\d[\d,]*(?:\.\d+)?\)?/);
  if (!amountTokenMatch) {
    return null;
  }

  const parsed = parseSignedAmount(amountTokenMatch[0]);
  return parsed === null ? null : Math.abs(parsed);
};

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
  cheque_ref: shipment.chequeRef || null,
  cheque_date: shipment.chequeDate || null,
});

export const getCities = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cities = await getAllLeopardsCities();
    res.status(200).json(cities);
  } catch (error) {
    next(error);
  }
};

export const calculateShipping = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cityId, weightGrams, subtotal } = req.body;
    
    if (!cityId || !weightGrams) {
      return res.status(400).json({ message: "City ID and Weight are required" });
    }

    const result = await getLeopardsTariff(parseInt(cityId), parseFloat(weightGrams), parseFloat(subtotal || 0));
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
        message: "ShipmentHistory model is not available. Run: npx prisma generate && npx prisma db push, then restart server."
      });
    }

    const { startDate, endDate } = req.query;
    const where: Record<string, any> = {};

    if (startDate || endDate) {
      where.bookingDate = {};
      if (startDate) where.bookingDate.gte = startDate;
      if (endDate) where.bookingDate.lte = endDate;
    }

    const shipments = await shipmentHistoryModel.findMany({
      where,
      orderBy: [{ bookingDate: "desc" }, { updatedAt: "desc" }]
    });

    res.status(200).json({
      status: 1,
      shipments: shipments.map(mapShipmentRecordToApi)
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
        message: "ShipmentHistory model is not available. Run: npx prisma generate && npx prisma db push, then restart server."
      });
    }

    const startDate = (req.query.startDate as string) || req.body?.startDate;
    const endDate = (req.query.endDate as string) || req.body?.endDate;

    const history = await getLeopardsShipmentHistory(startDate, endDate);

    if (!history || history.status !== 1) {
      return res.status(400).json({
        status: 0,
        message: history?.message || "Failed to fetch shipment history from Leopards"
      });
    }

    const sourceShipments = Array.isArray(history.shipments) ? history.shipments : [];
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
        message: "No valid shipments found to sync",
        totalReceived: sourceShipments.length,
        skipped: sourceShipments.length,
        created: 0,
        updated: 0,
        upserted: 0
      });
    }

    const existingShipments = await shipmentHistoryModel.findMany({
      where: {
        trackingNumber: { in: trackingNumbers }
      },
      select: { trackingNumber: true }
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
          rawPayload: shipment
        };

        return shipmentHistoryModel.upsert({
          where: { trackingNumber },
          create: shipmentData,
          update: shipmentData
        });
      })
    );

    const updated = trackingNumbers.filter((trackingNumber) => existingTrackingNumbers.has(trackingNumber)).length;
    const created = trackingNumbers.length - updated;

    res.status(200).json({
      status: 1,
      message: "Shipments synced successfully",
      totalReceived: sourceShipments.length,
      skipped: sourceShipments.length - trackingNumbers.length,
      created,
      updated,
      upserted: trackingNumbers.length
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
    const result = await getLeopardsPaymentDetails(cnNumbers as string);
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
    const result = await getLeopardsShipmentByOrderIds(orderIds);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const bookShipment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId, weight, pieces } = req.body;
    
    if (!orderId || !weight) {
      return res.status(400).json({ message: "Order ID and Weight are required" });
    }

    // 1. Fetch order details
    const order = await getSaleById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // 2. Prepare booking data
    const bookingData = {
      orderId: order.id,
      customerName: order.customerName || "Customer",
      customerPhone: order.customerPhone || "",
      customerAddress: order.shippingAddress || "",
      city: order.city || "Karachi",
      amount: order.total,
      weight: parseFloat(weight),
      pieces: parseInt(pieces) || 1
    };

    // 3. Call Leopards API
    const result = await bookLeopardsShipment(bookingData);

    if (result && result.status === 1) {
      // 4. Update order with tracking number and new status
      const updatedOrder = await updateSaleTracking(
        order.id,
        result.track_number,
        "Booked",
        result.track_number // Use CN as booking ID locally as well
      );

      try {
        await sendOrderBookedEmail({
          order: updatedOrder,
          trackingNumber: result.track_number,
        });
      } catch (mailError: any) {
        console.error(
          `Booked notification email failed for order ${updatedOrder.id}:`,
          mailError?.message || mailError,
        );
      }
      
      return res.status(200).json({
        status: 1,
        message: result.message || "Shipment booked successfully",
        track_number: result.track_number,
        order: updatedOrder
      });
    }

    res.status(400).json({
      status: 0,
      message: result.error || result.message || "Leopards API failed to book shipment"
    });
  } catch (error) {
    next(error);
  }
};

export const extractExcel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const { spawn, spawnSync } = require('child_process');
    const path = require('path');
    const fs = require('fs');

    const filePath = req.file.path;
    const scriptCandidates = [
      path.join(__dirname, '../scripts/extract_excel.py'),
      path.join(process.cwd(), 'src/scripts/extract_excel.py'),
      path.join(process.cwd(), 'dist/scripts/extract_excel.py'),
    ];
    const scriptPath = scriptCandidates.find((candidate: string) => fs.existsSync(candidate));

    if (!scriptPath) {
      try {
        fs.unlinkSync(filePath);
      } catch (_err) {}
      return res.status(500).json({
        message: "Python script not found",
        searchedPaths: scriptCandidates
      });
    }

    const pythonCandidates = process.platform === 'win32'
      ? ['python', 'py', 'python3']
      : ['python3', 'python', '/var/lang/bin/python3', '/usr/bin/python3'];
    const pythonCommand = pythonCandidates.find((cmd: string) => {
      try {
        const result = spawnSync(cmd, ['--version'], { stdio: 'pipe' });
        return result.status === 0;
      } catch (_err) {
        return false;
      }
    });

    if (!pythonCommand) {
      try {
        fs.unlinkSync(filePath);
      } catch (_err) {}
      return res.status(500).json({
        message: "Python is not available on server. Please install Python 3 and ensure it is in PATH.",
        checkedCommands: pythonCandidates
      });
    }

    const pythonDependencyPath = path.join(process.cwd(), '.python_packages');
    const mergedPythonPath = [pythonDependencyPath, process.env.PYTHONPATH]
      .filter(Boolean)
      .join(path.delimiter);

    const pythonProcess = spawn(pythonCommand, [scriptPath, filePath], {
      env: {
        ...process.env,
        PYTHONPATH: mergedPythonPath
      }
    });

    let dataString = '';
    let errorString = '';
    let hasResponded = false;

    const cleanupUploadedFile = () => {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error("Failed to delete temporary file:", err);
      }
    };

    pythonProcess.stdout.on('data', (data: Buffer) => {
      dataString += data.toString();
    });

    pythonProcess.stderr.on('data', (data: Buffer) => {
      errorString += data.toString();
    });

    pythonProcess.on('error', (err: Error) => {
      if (hasResponded) return;
      hasResponded = true;
      cleanupUploadedFile();
      return res.status(500).json({
        message: "Failed to start Python process",
        pythonCommand,
        scriptPath,
        error: err.message
      });
    });

    pythonProcess.on('close', (code: number) => {
      if (hasResponded) return;
      hasResponded = true;
      cleanupUploadedFile();

      if (code !== 0) {
        return res.status(500).json({
          message: "Python script failed",
          pythonCommand,
          scriptPath,
          error: errorString || `Exit code ${code}`
        });
      }

      try {
        const result = JSON.parse(dataString);
        if (result.error) {
          return res.status(400).json({ message: result.error });
        }
        res.status(200).json(result);
      } catch (e) {
        res.status(500).json({
          message: "Failed to parse Python output",
          rawOutput: dataString,
          error: e instanceof Error ? e.message : String(e)
        });
      }
    });

  } catch (error) {
    next(error);
  }
};

export const saveChequeRecord = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  try {
    const { fileName, htmlContent, isHtml, paymentDate, chequeNumber, netPayableAmount } = req.body;

    if (!fileName || !htmlContent) {
      return res.status(400).json({ message: "filename and htmlContent are required" });
    }

    const extractedNetPayableAmount = extractNetPayableAmountFromHtml(htmlContent);
    const parsedNetPayableAmount = Number(netPayableAmount);
    const finalNetPayableAmount =
      typeof extractedNetPayableAmount === "number" && Number.isFinite(extractedNetPayableAmount)
        ? extractedNetPayableAmount
        : parsedNetPayableAmount;

    if (!Number.isFinite(finalNetPayableAmount)) {
      return res.status(400).json({ message: "netPayableAmount is required and must be a valid number" });
    }

    const paymentDateValue = parseChequePaymentDate(paymentDate);

    if (chequeNumber) {
      const existingByChequeNumber = await (prisma as any).chequeRecord.findFirst({
        where: { chequeNumber }
      });

      if (existingByChequeNumber) {
        return res.status(409).json({ message: `Cheque reference ${chequeNumber} already exists.` });
      }
    } else if (paymentDate) {
      const existingByPaymentDate = await (prisma as any).chequeRecord.findFirst({
        where: { paymentDate }
      });

      if (existingByPaymentDate) {
        return res.status(409).json({ message: `A report with Payment Date ${paymentDate} already exists.` });
      }
    }

    const record = await (prisma as any).chequeRecord.create({
      data: {
        fileName,
        htmlContent,
        isHtml: !!isHtml,
        paymentDate: paymentDate || null,
        paymentDateValue,
        chequeNumber: chequeNumber || null,
        netPayableAmount: finalNetPayableAmount,
      },
    });

    res.status(201).json(record);
  } catch (error) {
    next(error);
  }
};

export const getChequeRecords = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  try {
    const records = await (prisma as any).chequeRecord.findMany({
      select: {
        id: true,
        fileName: true,
        isHtml: true,
        paymentDate: true,
        chequeNumber: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.status(200).json(records);
  } catch (error) {
    next(error);
  }
};

export const getChequeRecordById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  try {
    const { id } = req.params;
    const record = await (prisma as any).chequeRecord.findUnique({
      where: { id },
    });

    if (!record) {
      return res.status(404).json({ message: "Record not found" });
    }

    res.status(200).json(record);
  } catch (error) {
    next(error);
  }
};

export const deleteChequeRecord = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  try {
    const shipmentHistoryModel = (prisma as any).shipmentHistory;
    const { id } = req.params;
    const chequeRecord = await (prisma as any).chequeRecord.findUnique({
      where: { id },
      select: {
        id: true,
        fileName: true,
        chequeNumber: true,
        paymentDate: true,
      },
    });

    if (!chequeRecord) {
      return res.status(404).json({ message: "Record not found" });
    }

    await (prisma as any).chequeRecord.delete({
      where: { id },
    });

    if (shipmentHistoryModel) {
      const chequeRef = chequeRecord.chequeNumber || chequeRecord.fileName;
      await shipmentHistoryModel.updateMany({
        where: {
          chequeRef,
          ...(chequeRecord.paymentDate ? { chequeDate: chequeRecord.paymentDate } : {}),
        },
        data: {
          chequeRef: null,
          chequeDate: null,
        },
      });
    }

    res.status(200).json({ message: "Record deleted successfully and linked shipment refs were cleared." });
  } catch (error) {
    next(error);
  }
};

export const syncChequeToShipments = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  try {
    const shipmentHistoryModel = (prisma as any).shipmentHistory;
    if (!shipmentHistoryModel) {
      return res.status(500).json({ message: "ShipmentHistory model is not available." });
    }

    const { chequeId } = req.body;
    if (!chequeId) {
      return res.status(400).json({ message: "chequeId is required" });
    }

    // 1. Fetch the cheque record
    const chequeRecord = await (prisma as any).chequeRecord.findUnique({
      where: { id: chequeId },
    });

    if (!chequeRecord) {
      return res.status(404).json({ message: "Cheque record not found" });
    }

    // 2. Extract CN numbers from HTML content using regex
    // Leopards CN numbers are typically formatted as FS7527XXXXXXX or similar patterns
    const cnPattern = /FS\d{10,13}/gi;
    const matches = chequeRecord.htmlContent.match(cnPattern) || [];
    const uniqueCns = [...new Set(matches.map((cn: string) => cn.toUpperCase()))] as string[];

    if (uniqueCns.length === 0) {
      return res.status(200).json({
        message: "No CN numbers found in the cheque. Make sure the cheque contains valid tracking numbers (e.g. FS7527XXXXXXX).",
        matched: 0,
        cns: []
      });
    }

    // 3. Bulk-update matching ShipmentHistory records
    const result = await shipmentHistoryModel.updateMany({
      where: {
        trackingNumber: { in: uniqueCns }
      },
      data: {
        chequeRef: chequeRecord.chequeNumber || chequeRecord.fileName,
        chequeDate: chequeRecord.paymentDate || null,
      }
    });

    // 4. Confirm which ones matched
    const matched = await shipmentHistoryModel.findMany({
      where: { trackingNumber: { in: uniqueCns } },
      select: { trackingNumber: true, chequeRef: true, chequeDate: true }
    });

    res.status(200).json({
      message: `Synced cheque ref to ${result.count} shipment(s).`,
      totalCnsInCheque: uniqueCns.length,
      matched: result.count,
      matchedShipments: matched,
      chequeRef: chequeRecord.chequeNumber || chequeRecord.fileName,
      chequeDate: chequeRecord.paymentDate,
    });
  } catch (error) {
    next(error);
  }
};
