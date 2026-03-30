import crypto from "crypto";

const JAZZCASH_MERCHANT_ID = process.env.JAZZCASH_MERCHANT_ID || "T00000";
const JAZZCASH_PASSWORD = process.env.JAZZCASH_PASSWORD || "xxxxx";
const JAZZCASH_SALT = process.env.JAZZCASH_SALT || "xxxxx";
const JAZZCASH_RETURN_URL = process.env.JAZZCASH_RETURN_URL || "http://localhost:5000/api/payments/jazzcash/callback";
const JAZZCASH_API_URL = process.env.JAZZCASH_API_URL || "https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/";

export interface JazzCashRequestData {
  pp_Amount: string;
  pp_TxnRefNo: string;
  pp_MobileNumber: string;
  pp_CNIC: string;
  pp_BillReference: string;
  pp_Description: string;
}

export const generateSecureHash = (data: Record<string, string>): string => {
  // 1. Sort the keys alphabetically
  const sortedKeys = Object.keys(data).sort();

  // 2. Concatenate values with '&'
  let message = JAZZCASH_SALT;
  for (const key of sortedKeys) {
    if (data[key] !== "") {
      message += "&" + data[key];
    }
  }

  // 3. Compute HMAC-SHA256 hex string
  return crypto
    .createHmac("sha256", JAZZCASH_SALT)
    .update(message)
    .digest("hex")
    .toUpperCase();
};

export const initiateJazzCashMobileWallet = async (data: JazzCashRequestData) => {
  const pp_TxnDateTime = new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);
  
  const expiryDate = new Date();
  expiryDate.setHours(expiryDate.getHours() + 1);
  const pp_TxnExpiryDateTime = expiryDate
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);

  const payload: Record<string, string> = {
    pp_Version: "1.1",
    pp_TxnType: "MWALLET",
    pp_Language: "EN",
    pp_MerchantID: JAZZCASH_MERCHANT_ID,
    pp_Password: JAZZCASH_PASSWORD,
    pp_TxnRefNo: data.pp_TxnRefNo,
    pp_Amount: data.pp_Amount,
    pp_TxnCurrency: "PKR",
    pp_TxnDateTime,
    pp_TxnExpiryDateTime,
    pp_BillReference: data.pp_BillReference,
    pp_Description: data.pp_Description,
    pp_ReturnURL: JAZZCASH_RETURN_URL,
    pp_SecureHash: "",
    pp_MobileNumber: data.pp_MobileNumber,
    pp_CNIC: data.pp_CNIC,
  };

  // Remove empty fields for hash calculation
  const hashData: Record<string, string> = { ...payload };
  delete hashData.pp_SecureHash;

  payload.pp_SecureHash = generateSecureHash(hashData);

  try {
    const response = await fetch(JAZZCASH_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    return result;
  } catch (error: any) {
    throw new Error(`JazzCash API Call Failed: ${error.message}`);
  }
};

export const verifyJazzCashHash = (receivedData: Record<string, string>): boolean => {
  const receivedHash = receivedData.pp_SecureHash;
  const hashData = { ...receivedData };
  delete hashData.pp_SecureHash;

  const calculatedHash = generateSecureHash(hashData);
  return calculatedHash === receivedHash;
};
