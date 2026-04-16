import { Request, Response, NextFunction } from 'express';
import { getAllLeopardsCities, getLeopardsTariff, getLeopardsShipmentHistory, getLeopardsPaymentDetails, getLeopardsShipmentByOrderIds, bookLeopardsShipment } from '../services/leopardsService';
import { getSaleById, updateSaleTracking } from '../services/saleService';
import prisma from '../config/prisma';

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
  cod_value: shipment.codValue || ""
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
      : ['python3', 'python'];
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

    const pythonProcess = spawn(pythonCommand, [scriptPath, filePath]);

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
    const { fileName, htmlContent, isHtml, paymentDate, chequeNumber } = req.body;

    if (!fileName || !htmlContent) {
      return res.status(400).json({ message: "filename and htmlContent are required" });
    }

    if (paymentDate) {
      const existingRecord = await (prisma as any).chequeRecord.findFirst({
        where: { paymentDate }
      });
      
      if (existingRecord) {
        return res.status(409).json({ message: `A report with Payment Date ${paymentDate} already exists.` });
      }
    }

    const record = await (prisma as any).chequeRecord.create({
      data: {
        fileName,
        htmlContent,
        isHtml: !!isHtml,
        paymentDate: paymentDate || null,
        chequeNumber: chequeNumber || null,
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
    const { id } = req.params;
    await (prisma as any).chequeRecord.delete({
      where: { id },
    });
    res.status(200).json({ message: "Record deleted successfully" });
  } catch (error) {
    next(error);
  }
};
