import express from "express";
import { initiateJazzCashMobileWallet, verifyJazzCashHash } from "../services/paymentService";
import { createSale, updateSale } from "../services/saleService";

const router = express.Router();

// POST /api/payments/jazzcash/initiate
router.post("/jazzcash/initiate", async (req, res) => {
  try {
    const { orderDetails, mobileNumber, cnic } = req.body;

    // 1. Create the order in PENDING status if not already created
    // Or if passed from frontend, we use the reference.
    // For this flow, we assume the order is created first.
    
    const txnRefNo = `T${Date.now()}`;
    
    // 2. Prepare JazzCash request
    const paymentData = await initiateJazzCashMobileWallet({
      pp_Amount: Math.round(orderDetails.total * 100).toString(), // PKR in paisas
      pp_TxnRefNo: txnRefNo,
      pp_MobileNumber: mobileNumber,
      pp_CNIC: cnic,
      pp_BillReference: txnRefNo,
      pp_Description: `Order ${txnRefNo} from RKT Store`,
    });

    // 3. Store txnRefNo in the order record if we have an order ID
    if (orderDetails.id) {
       await updateSale(orderDetails.id, {
         ...orderDetails,
         txnRefNo: txnRefNo,
         paymentMethod: "PREPAID",
         paymentStatus: "PENDING"
       });
    }

    res.status(200).json(paymentData);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/payments/jazzcash/callback
// This is the URL JazzCash will POST to after transaction
router.post("/jazzcash/callback", async (req, res) => {
  try {
    const jazzCashResponse = req.body;
    
    // 1. Verify Hash
    const isValid = verifyJazzCashHash(jazzCashResponse);
    if (!isValid) {
      return res.status(400).send("Invalid Secure Hash");
    }

    const txnRefNo = jazzCashResponse.pp_TxnRefNo;
    const responseCode = jazzCashResponse.pp_ResponseCode;
    
    // 2. Update Order Status
    // We need to find the order by txnRefNo
    // For simplicity, let's assume we have a way to find it.
    // In a real app, you'd find the sale with this txnRefNo.
    
    const status = responseCode === "000" ? "PAID" : "FAILED";
    
    // Note: You would typically implement a getSaleByTxnRefNo in saleService
    // But for now, we'll log it.
    console.log(`Payment for ${txnRefNo}: ${status}`);

    // JazzCash expects a response or redirect
    res.status(200).send("OK");
  } catch (error: any) {
    res.status(500).send("Internal Server Error");
  }
});

export default router;
