import { Request, Response, NextFunction } from 'express';
import { getAllLeopardsCities, getLeopardsTariff, getLeopardsShipmentHistory, getLeopardsPaymentDetails, getLeopardsShipmentByOrderIds, bookLeopardsShipment } from '../services/leopardsService';
import { getSaleById, updateSaleTracking } from '../services/saleService';
import prisma from '../config/prisma';

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
    const { startDate, endDate } = req.query;
    const history = await getLeopardsShipmentHistory(startDate as string, endDate as string);
    res.status(200).json(history);
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

    const { spawn } = require('child_process');
    const path = require('path');
    const fs = require('fs');

    const filePath = req.file.path;
    const scriptPath = path.join(__dirname, '../scripts/extract_excel.py');

    // Call Python script
    // Try to detect the correct python command (python, python3, or py)
    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    const pythonProcess = spawn(pythonCommand, [scriptPath, filePath]);

    let dataString = '';
    let errorString = '';

    pythonProcess.stdout.on('data', (data: Buffer) => {
      dataString += data.toString();
    });

    pythonProcess.stderr.on('data', (data: Buffer) => {
      errorString += data.toString();
    });

    pythonProcess.on('close', (code: number) => {
      // Clean up uploaded file
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error("Failed to delete temporary file:", err);
      }

      if (code !== 0) {
        return res.status(500).json({
          message: "Python script failed",
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
