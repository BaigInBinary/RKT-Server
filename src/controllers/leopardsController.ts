import { Request, Response, NextFunction } from 'express';
import { getAllLeopardsCities, getLeopardsTariff, getLeopardsShipmentHistory, getLeopardsPaymentDetails, getLeopardsShipmentByOrderIds, bookLeopardsShipment } from '../services/leopardsService';
import { getSaleById, updateSaleTracking } from '../services/saleService';

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
