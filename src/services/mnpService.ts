import axios from "axios";
import prisma from "../config/prisma";

/**
 * M&P (MNP Courier / Mulphilog) COD API client.
 * Implements the endpoints documented in "M&P COD API MANUAL" (version 2025022404):
 *  1. Booking       - InsertBookingData, VoidConsignment, InsertBulkBookingData
 *  2. Branches      - Get_Cities (booking cities), Get_Cities_All (delivery cities)
 *  3. Locations     - Get_locations, AddLocation, AddLocationWithSubAccount,
 *                     GetSubAccountLocations, CreateSubAccount
 *  4. Reports       - QSR_Report, Payment_Report, CN_Detail_Customer_Order_No, GetProofOfDelivery
 *  5. ShipperAdvice - GetShipperAdvices, CloseShipperAdvice, GetInitData, GetAdvices,
 *                     SaveAdvice, TicketDetails
 *  6. Tracking      - CNTracking (tracking host), Bulk_Consignment_Tracking_New
 *  7. UserManagement- GetSubAccounts, GetAccounts
 */

const DEFAULT_API_BASE_URL = "https://mnpcourier.com/mycodapi/api/";
const DEFAULT_TRACKING_BASE_URL = "https://tracking.mulphilog.com.pk/api/";
const CACHE_DURATION = 1000 * 60 * 60;
const REQUEST_TIMEOUT = 25000;
const BULK_TRACKING_CHUNK = 200; // documented maximum consignments per call
const PAYMENT_REPORT_MAX_DAYS = 31; // documented maximum window per call
const MAX_COD_AMOUNT = 99999; // documented maximum codAmount

const normalizeApiBaseUrl = (value?: string): string => {
  const trimmed = (value || DEFAULT_API_BASE_URL).trim();
  const noTrailingSlash = trimmed.replace(/\/+$/, "");
  return `${noTrailingSlash}/`;
};

const normalizeTrackingBaseUrl = (value?: string): string => {
  const trimmed = (value || DEFAULT_TRACKING_BASE_URL).trim();
  const noTrailingSlash = trimmed.replace(/\/+$/, "");
  return `${noTrailingSlash}/`;
};

const stringifyMnpError = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((entry) => stringifyMnpError(entry)).filter(Boolean).join(" | ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => {
        const msg = stringifyMnpError(entry);
        return msg ? `${key}: ${msg}` : key;
      })
      .filter(Boolean)
      .join(" | ");
  }
  return "";
};

// M&P responses report success as boolean true, "true", 1, and some endpoints
// even misspell the key ("isSucces"). Accept all of them.
const isSuccessValue = (value: unknown): boolean => {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    return ["true", "1", "success", "successful"].includes(value.trim().toLowerCase());
  }
  return false;
};

const readSuccessFlag = (source: any): boolean =>
  isSuccessValue(source?.isSuccess ?? source?.IsSuccess ?? source?.isSucces ?? source?.status ?? source?.sts === 0);

const parsePositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
};

const getEnvPositiveInt = (name: string): number | null => parsePositiveInt(process.env[name]);

const firstArrayEntry = (value: unknown): any => {
  if (Array.isArray(value)) return value[0] || {};
  return value || {};
};

const getNestedDetails = (value: unknown): any[] => {
  const root = firstArrayEntry(value);
  if (Array.isArray(root?.Details)) return root.Details;
  if (Array.isArray(root?.details)) return root.details;
  if (Array.isArray(root?.tracking_Details)) return root.tracking_Details;
  if (Array.isArray((value as any)?.Details)) return (value as any).Details;
  return [];
};

const firstValue = (source: any, keys: string[]): any => {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return value;
    }
  }
  return "";
};

/**
 * M&P requires consignee mobile numbers in local `03001234567` format.
 * Accepts +92 / 92 / 0092 prefixed and formatted inputs and converts them.
 */
export const normalizeMnpPhone = (value: unknown): string => {
  const digits = String(value || "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("0092") && digits.length === 14) return `0${digits.slice(4)}`;
  if (digits.startsWith("92") && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith("3")) return `0${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return digits;
  return digits.slice(0, 50);
};

let MNP_USERNAME = process.env.MNP_USERNAME || "";
let MNP_PASSWORD = process.env.MNP_PASSWORD || "";
let MNP_ACCOUNT_NO = process.env.MNP_ACCOUNT_NO || "";
let MNP_LOCATION_ID = process.env.MNP_LOCATION_ID || "";
let MNP_RETURN_LOCATION = process.env.MNP_RETURN_LOCATION || "";
let MNP_SUB_ACCOUNT_ID = parsePositiveInt(process.env.MNP_SUB_ACCOUNT_ID);
let MNP_INSERT_TYPE = parsePositiveInt(process.env.MNP_INSERT_TYPE) || 19;
let MNP_SERVICE = process.env.MNP_SERVICE || "Overnight";
let MNP_FRAGILE = process.env.MNP_FRAGILE || "NO";
let MNP_API_URL = normalizeApiBaseUrl(process.env.MNP_API_URL);
let MNP_TRACKING_URL = normalizeTrackingBaseUrl(process.env.MNP_TRACKING_URL);

const fetchMnpConfig = async () => {
  try {
    const config = await (prisma as any).mnpConfig?.findFirst();
    if (config) {
      MNP_USERNAME = config.username || process.env.MNP_USERNAME || "";
      MNP_PASSWORD = config.password || process.env.MNP_PASSWORD || "";
      MNP_ACCOUNT_NO = config.accountNo || process.env.MNP_ACCOUNT_NO || "";
      MNP_LOCATION_ID = config.locationId || process.env.MNP_LOCATION_ID || "";
      MNP_RETURN_LOCATION = config.returnLocation || process.env.MNP_RETURN_LOCATION || "";
      MNP_SUB_ACCOUNT_ID = parsePositiveInt(config.subAccountId) || getEnvPositiveInt("MNP_SUB_ACCOUNT_ID");
      MNP_INSERT_TYPE = parsePositiveInt(config.insertType) || getEnvPositiveInt("MNP_INSERT_TYPE") || 19;
      MNP_SERVICE = config.service || process.env.MNP_SERVICE || "Overnight";
      MNP_FRAGILE = config.fragile || process.env.MNP_FRAGILE || "NO";
      MNP_API_URL = normalizeApiBaseUrl(config.baseUrl || process.env.MNP_API_URL);
      MNP_TRACKING_URL = normalizeTrackingBaseUrl(config.trackingUrl || process.env.MNP_TRACKING_URL);
      return config;
    }
  } catch (err) {
    console.error("Failed to fetch M&P config from DB, using .env defaults");
  }
  return null;
};

const hasAccountCredentials = () =>
  Boolean(MNP_USERNAME && MNP_PASSWORD && MNP_ACCOUNT_NO);

const hasReportCredentials = () =>
  hasAccountCredentials() &&
  Boolean(MNP_LOCATION_ID);

const hasBookingCredentials = () =>
  hasReportCredentials() &&
  Boolean(MNP_LOCATION_ID && MNP_RETURN_LOCATION && MNP_SUB_ACCOUNT_ID);

const getMissingMnpBookingConfigFields = (): string[] => {
  const missing: string[] = [];
  if (!MNP_ACCOUNT_NO) missing.push("Account No");
  if (!MNP_LOCATION_ID) missing.push("Location ID");
  if (!MNP_RETURN_LOCATION) missing.push("Return Location ID");
  if (!MNP_SUB_ACCOUNT_ID) missing.push("Sub Account ID (numeric, not Account No)");
  return missing;
};

export type MnpCityScope = "booking" | "delivery";

interface CityCacheEntry {
  cities: Array<{ id: string; name: string }>;
  timestamp: number;
}

const cityCache: Record<MnpCityScope, CityCacheEntry> = {
  booking: { cities: [], timestamp: 0 },
  delivery: { cities: [], timestamp: 0 },
};

const MOCK_CITIES = [
  { id: "Karachi", name: "Karachi" },
  { id: "Lahore", name: "Lahore" },
  { id: "Islamabad", name: "Islamabad" },
  { id: "Faisalabad", name: "Faisalabad" },
  { id: "Rawalpindi", name: "Rawalpindi" },
  { id: "Multan", name: "Multan" },
  { id: "Peshawar", name: "Peshawar" },
  { id: "Quetta", name: "Quetta" },
  { id: "Sialkot", name: "Sialkot" },
  { id: "Gujranwala", name: "Gujranwala" },
];

export interface MnpBookingData {
  orderId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerEmail?: string;
  city: string | number;
  amount: number;
  weight: number;
  pieces?: number;
  productDetails?: string;
  remarks?: string;
  service?: string;
  fragile?: string;
  insuranceValue?: string | number;
}

const parseCityListResponse = (data: unknown): Array<{ id: string; name: string }> => {
  const cityNames = Array.isArray(data)
    ? data.flatMap((entry: any) => (Array.isArray(entry?.City) ? entry.City : []))
    : Array.isArray((data as any)?.City)
      ? (data as any).City
      : [];

  const citySet = new Set<string>(
    cityNames
      .map((city: unknown) => String(city || "").trim())
      .filter(Boolean),
  );
  return Array.from(citySet)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ id: name, name }));
};

/**
 * 2.1 Get_Cities returns cities valid for booking (destinationCityName values);
 * 2.2 Get_Cities_All returns the wider delivery coverage list.
 * Booking flows must use the booking scope so InsertBookingData accepts the city.
 */
export const getAllMnpCities = async (
  scope: MnpCityScope = "booking",
): Promise<Array<{ id: string; name: string }>> => {
  await fetchMnpConfig();

  const cache = cityCache[scope];
  if (cache.cities.length > 0 && Date.now() - cache.timestamp < CACHE_DURATION) {
    return cache.cities;
  }

  if (!hasAccountCredentials()) {
    return MOCK_CITIES;
  }

  const endpoint = scope === "booking" ? "Branches/Get_Cities" : "Branches/Get_Cities_All";

  try {
    const response = await axios.get(`${MNP_API_URL}${endpoint}`, {
      params: {
        username: MNP_USERNAME,
        password: MNP_PASSWORD,
        AccountNo: MNP_ACCOUNT_NO,
      },
      timeout: REQUEST_TIMEOUT,
    });

    const cities = parseCityListResponse(response.data);
    if (cities.length > 0) {
      cache.cities = cities;
      cache.timestamp = Date.now();
      return cities;
    }
  } catch (error: any) {
    console.error(`Failed to fetch M&P cities (${scope}):`, error.message);
  }

  if (cache.cities.length > 0) return cache.cities;

  // Fall back to the other scope's cache before resorting to mock data.
  const fallback = cityCache[scope === "booking" ? "delivery" : "booking"];
  return fallback.cities.length > 0 ? fallback.cities : MOCK_CITIES;
};

const resolveCityName = async (city: string | number): Promise<string> => {
  const normalized = String(city || "").trim();
  if (!normalized) return "Karachi";

  const cities = await getAllMnpCities("booking");
  const match = cities.find((entry) =>
    entry.name.toLowerCase() === normalized.toLowerCase() ||
    entry.id.toLowerCase() === normalized.toLowerCase(),
  );

  return match?.name || normalized;
};

const gramsToMnpWeight = (weightInGrams: number): number => {
  const weightKg = Number(weightInGrams) / 1000;
  if (!Number.isFinite(weightKg) || weightKg <= 0) return 0.5;
  return Math.max(0.1, Number(weightKg.toFixed(2)));
};

const getMeaningfulMnpStatus = (value: unknown): string => {
  const status = String(value || "").trim();
  if (!status) return "";

  const normalized = status.toLowerCase();
  if (["unknown", "null", "undefined"].includes(normalized)) return "";

  const looksLikeApiFailure =
    normalized.includes("object reference not set") ||
    normalized.includes("exception") ||
    normalized.includes("internal server error") ||
    normalized.includes("failed");

  return looksLikeApiFailure ? "" : status;
};

// M&P returns tracking events in an arbitrary order. Pick the most recent one
// using the numeric TrackingTagID first (higher = later stage) and the
// TransactionTime as a tie-breaker, rather than trusting array position.
const parseMnpEventTime = (value: unknown): number => {
  const text = String(value || "").trim();
  if (!text) return 0;
  const parsed = new Date(text.replace(" ", "T"));
  const time = parsed.getTime();
  return Number.isNaN(time) ? 0 : time;
};

const pickLatestMnpEvent = (events: any[]): any => {
  if (!Array.isArray(events) || events.length === 0) return {};
  return events.reduce((latest, event) => {
    const latestTag = Number(latest?.TrackingTagID);
    const eventTag = Number(event?.TrackingTagID);
    const bothTagsValid = Number.isFinite(latestTag) && Number.isFinite(eventTag);

    if (bothTagsValid && eventTag !== latestTag) {
      return eventTag > latestTag ? event : latest;
    }

    return parseMnpEventTime(event?.TransactionTime) >= parseMnpEventTime(latest?.TransactionTime)
      ? event
      : latest;
  });
};

// Maps a raw M&P status / narration to the local courier status vocabulary used
// on the Orders board. Returns null when the status can't be mapped confidently.
export const mapMnpStatusToCourierStatus = (
  value: unknown,
): "Booked" | "In Transit" | "Out for Delivery" | "Delivered" | "Returned" | "Cancelled" | null => {
  const status = getMeaningfulMnpStatus(value).toLowerCase();
  if (!status) return null;

  if (status.includes("deliver") && !status.includes("out for") && !status.includes("undeliver")) {
    return "Delivered";
  }
  if (status.includes("void") || status.includes("cancel")) return "Cancelled";
  if (
    status.includes("return") ||
    status.includes("rs-") ||
    status.includes("shipper")
  ) {
    return "Returned";
  }
  if (
    status.includes("out for delivery") ||
    status.includes("out-for-delivery") ||
    status.includes("dispatch for delivery") ||
    status.includes("loaded for delivery")
  ) {
    return "Out for Delivery";
  }
  if (
    status.includes("transit") ||
    status.includes("arrived") ||
    status.includes("departed") ||
    status.includes("received at") ||
    status.includes("forward") ||
    status.includes("on route") ||
    status.includes("on the way") ||
    status.includes("undeliver") ||
    status.includes("re-attempt") ||
    status.includes("reattempt") ||
    status.includes("dispatch")
  ) {
    return "In Transit";
  }
  if (status.includes("book") || status.includes("order placed") || status.includes("picked")) {
    return "Booked";
  }

  return null;
};

const getOrderWeightGrams = (order: any, fallbackWeightGrams?: number): number => {
  const fallback = Number(fallbackWeightGrams);
  if (Number.isFinite(fallback) && fallback > 0) return fallback;

  const itemWeight = Array.isArray(order?.items)
    ? order.items.reduce((sum: number, item: any) => sum + (Number(item?.quantity || 0) * 500), 0)
    : 0;

  return itemWeight > 0 ? itemWeight : 500;
};

export const buildMnpLocalShipmentFromOrder = (
  order: any,
  options: {
    trackingNumber?: string;
    bookingOrderId?: string;
    weightGrams?: number;
    service?: string;
    status?: string;
    trackingResult?: any;
    bookingData?: Partial<MnpBookingData>;
    source?: string;
  } = {},
) => {
  const trackingNumber = String(options.trackingNumber || order?.trackingNumber || "").trim();
  const trackingDetails = Array.isArray(options.trackingResult?.tracking_Details)
    ? options.trackingResult.tracking_Details[0] || {}
    : {};
  const trackedStatus = getMeaningfulMnpStatus(options.trackingResult?.status);
  const localStatus = getMeaningfulMnpStatus(options.status || order?.courierStatus);
  const detailWeight = firstValue(trackingDetails, ["Weight", "WEIGHT", "weight"]);
  const orderWeight = gramsToMnpWeight(getOrderWeightGrams(order, options.weightGrams));
  const bookingDate = order?.date ? new Date(order.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

  return {
    tracking_number: trackingNumber,
    booked_packet_order_id: options.bookingOrderId || order?.bookingId || order?.id || "",
    booking_date: bookingDate,
    delivery_date: firstValue(trackingDetails, ["HandOverDate", "DeliveryDate", "deliveryDate"]),
    booked_packet_weight: detailWeight ? String(detailWeight) : String(orderWeight),
    arival_dispatch_weight: "",
    origin_city: firstValue(trackingDetails, ["OriginCity", "OrgBranch", "OrgZone"]),
    destination_city: firstValue(trackingDetails, ["DestinationCity", "DESTINATION", "DESTZONE"]) || order?.city || "",
    consignment_name_eng: firstValue(trackingDetails, ["ConsigneeName", "consignee", "Consignee"]) || order?.customerName || "",
    consignment_phone: firstValue(trackingDetails, ["ContactNo", "consigneePhoneNo", "ConsigneeContact"]) || order?.customerPhone || "",
    consignment_address: firstValue(trackingDetails, ["DeliveryAddress", "address", "ConsigneeAddress"]) || order?.shippingAddress || "",
    booked_packet_status: trackedStatus || localStatus || "Booked",
    shipment_type: firstValue(trackingDetails, ["ServiceType", "SERVICE"]) || options.service || MNP_SERVICE || "Overnight",
    cod_value: firstValue(trackingDetails, ["CODAmount", "CodAmount"]) ? String(firstValue(trackingDetails, ["CODAmount", "CodAmount"])) : String(order?.total || ""),
    courier_provider: "mnp",
    rawPayload: {
      source: options.source || "local-order",
      orderId: order?.id || "",
      bookingData: options.bookingData || null,
      tracking: options.trackingResult || null,
    },
  };
};

export const upsertMnpLocalShipmentHistory = async (
  order: any,
  options: Parameters<typeof buildMnpLocalShipmentFromOrder>[1] = {},
) => {
  const shipmentHistoryModel = (prisma as any).shipmentHistory;
  if (!shipmentHistoryModel) return null;

  const shipment = buildMnpLocalShipmentFromOrder(order, options);
  const trackingNumber = String(shipment.tracking_number || "").trim();
  if (!trackingNumber) return null;

  const shipmentData = {
    bookingDate: shipment.booking_date || null,
    deliveryDate: shipment.delivery_date || null,
    shipperId: null,
    trackingNumber,
    bookedPacketWeight: shipment.booked_packet_weight || null,
    arivalDispatchWeight: shipment.arival_dispatch_weight || null,
    bookedPacketOrderId: shipment.booked_packet_order_id || null,
    originCity: shipment.origin_city || null,
    destinationCity: shipment.destination_city || null,
    consignmentNameEng: shipment.consignment_name_eng || null,
    consignmentPhone: shipment.consignment_phone || null,
    consignmentAddress: shipment.consignment_address || null,
    bookedPacketStatus: shipment.booked_packet_status || null,
    shipmentType: shipment.shipment_type || null,
    codValue: shipment.cod_value || null,
    courierProvider: "mnp",
    rawPayload: shipment.rawPayload,
  };

  return shipmentHistoryModel.upsert({
    where: { trackingNumber },
    create: shipmentData,
    update: shipmentData,
  });
};

interface PreparedConsignment {
  payload: Record<string, unknown>;
  error?: string;
}

// Builds the per-consignment fields shared by single and bulk booking,
// enforcing the documented validation rules.
const prepareConsignmentFields = async (data: MnpBookingData): Promise<PreparedConsignment> => {
  const codAmount = Math.max(0, Math.round(Number(data.amount) || 0));
  if (codAmount > MAX_COD_AMOUNT) {
    return {
      payload: {},
      error: `COD amount ${codAmount} exceeds the M&P maximum of ${MAX_COD_AMOUNT}. Split the order or contact M&P.`,
    };
  }

  const consigneeMobNo = normalizeMnpPhone(data.customerPhone);
  if (!consigneeMobNo || consigneeMobNo.length !== 11 || !consigneeMobNo.startsWith("03")) {
    return {
      payload: {},
      error: `Customer phone "${data.customerPhone}" is not a valid Pakistani mobile number (03XXXXXXXXX required by M&P).`,
    };
  }

  const destinationCityName = await resolveCityName(data.city);

  return {
    payload: {
      consigneeName: String(data.customerName || "Customer").slice(0, 50),
      consigneeAddress: String(data.customerAddress || "").slice(0, 255),
      consigneeMobNo,
      consigneeEmail: String(data.customerEmail || "").slice(0, 50),
      destinationCityName: destinationCityName.slice(0, 50),
      pieces: Math.max(1, Math.min(99, Math.round(Number(data.pieces || 1)))),
      weight: gramsToMnpWeight(Number(data.weight) || 500),
      codAmount,
      custRefNo: String(data.orderId || "").slice(0, 50),
      productDetails: String(data.productDetails || "Order items").slice(0, 50),
      fragile: String(data.fragile || MNP_FRAGILE || "NO").toUpperCase() === "YES" ? "YES" : "NO",
      service: String(data.service || MNP_SERVICE || "Overnight").slice(0, 50),
      remarks: String(data.remarks || `Order ${data.orderId}`).trim().slice(0, 400),
      insuranceValue: String(data.insuranceValue ?? "0").replace(/,/g, "").slice(0, 20) || "0",
    },
  };
};

/** 1.1 Insert Booking Data API */
export const bookMnpShipment = async (data: MnpBookingData) => {
  await fetchMnpConfig();

  if (!hasAccountCredentials()) {
    console.log(`[MOCK M&P] Booking shipment for Order ${data.orderId}`);
    return {
      status: 1,
      track_number: `${Math.floor(544000000000000 + Math.random() * 999999999)}`,
      booking_order_id: data.orderId,
      message: "Shipment booked successfully (Mock)",
      courierProvider: "mnp",
    };
  }

  if (!hasBookingCredentials()) {
    const missingFields = getMissingMnpBookingConfigFields();
    return {
      status: 0,
      track_number: null,
      booking_order_id: data.orderId,
      error: `M&P booking configuration is incomplete. Missing: ${missingFields.join(", ")}. Fill these in Admin > M&P Courier > Config.`,
    };
  }

  const prepared = await prepareConsignmentFields(data);
  if (prepared.error) {
    return {
      status: 0,
      track_number: null,
      booking_order_id: data.orderId,
      error: prepared.error,
    };
  }

  try {
    const payload = {
      username: MNP_USERNAME,
      password: MNP_PASSWORD,
      ...prepared.payload,
      locationID: MNP_LOCATION_ID,
      AccountNo: MNP_ACCOUNT_NO,
      InsertType: MNP_INSERT_TYPE,
      ReturnLocation: MNP_RETURN_LOCATION,
      subAccountId: MNP_SUB_ACCOUNT_ID,
    };

    const response = await axios.post(`${MNP_API_URL}Booking/InsertBookingData`, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: REQUEST_TIMEOUT,
    });

    const apiData = firstArrayEntry(response.data);
    const trackNumber = String(
      apiData?.orderReferenceId ??
      apiData?.OrderReferenceId ??
      apiData?.consignmentNumber ??
      apiData?.ConsignmentNumber ??
      "",
    ).trim();

    if (isSuccessValue(apiData?.isSuccess) && trackNumber) {
      return {
        ...apiData,
        status: 1,
        track_number: trackNumber,
        booking_order_id: data.orderId,
        courierProvider: "mnp",
      };
    }

    return {
      ...apiData,
      status: 0,
      track_number: trackNumber || null,
      booking_order_id: data.orderId,
      error: stringifyMnpError(apiData?.message || apiData?.error) || "M&P booking was rejected.",
    };
  } catch (error: any) {
    const apiErrorMessage = stringifyMnpError(error?.response?.data);
    throw new Error(`M&P Booking Failed: ${apiErrorMessage || error?.message || "Unknown error"}`);
  }
};

/** 1.3 Insert Bulk Booking Data API — books up to a batch of consignments in one call. */
export const bookMnpBulkShipments = async (dataList: MnpBookingData[]) => {
  await fetchMnpConfig();

  const orders = (dataList || []).filter((entry) => entry && entry.orderId);
  if (orders.length === 0) {
    return { status: 0, error: "At least one order is required for bulk booking.", results: [] };
  }

  if (!hasAccountCredentials()) {
    return {
      status: 1,
      message: "Bulk shipment booked successfully (Mock)",
      results: orders.map((order) => ({
        orderId: order.orderId,
        success: true,
        trackNumber: `${Math.floor(544000000000000 + Math.random() * 999999999)}`,
        message: "Mock booking",
      })),
    };
  }

  if (!MNP_LOCATION_ID) {
    return {
      status: 0,
      error: "M&P bulk booking requires the Location ID in configuration.",
      results: [],
    };
  }

  const preparedList: Array<{ data: MnpBookingData; prepared: PreparedConsignment }> = [];
  for (const order of orders) {
    preparedList.push({ data: order, prepared: await prepareConsignmentFields(order) });
  }

  const invalid = preparedList.filter((entry) => entry.prepared.error);
  const valid = preparedList.filter((entry) => !entry.prepared.error);

  if (valid.length === 0) {
    return {
      status: 0,
      error: "No orders passed M&P validation.",
      results: invalid.map((entry) => ({
        orderId: entry.data.orderId,
        success: false,
        trackNumber: null,
        message: entry.prepared.error || "Validation failed",
      })),
    };
  }

  try {
    const payload = {
      username: MNP_USERNAME,
      password: MNP_PASSWORD,
      locationID: MNP_LOCATION_ID,
      InsertType: MNP_INSERT_TYPE,
      BulkConsignmentList: valid.map((entry, index) => ({
        id: index + 1,
        ...entry.prepared.payload,
      })),
    };

    const response = await axios.post(`${MNP_API_URL}Booking/InsertBulkBookingData`, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: REQUEST_TIMEOUT * 2,
    });

    const apiData = firstArrayEntry(response.data);
    const referenceList = Array.isArray(apiData?.orderReferenceIdList) ? apiData.orderReferenceIdList : [];
    // Bulk response maps our custRefNo (orderRefNum) to the generated CN (message).
    const byRefNo = new Map<string, any>(
      referenceList.map((entry: any) => [String(entry?.orderRefNum || "").trim(), entry]),
    );

    const results = valid.map((entry) => {
      const custRefNo = String(entry.prepared.payload.custRefNo || "").trim();
      const match = byRefNo.get(custRefNo);
      const cn = String(match?.message || "").trim();
      const succeeded = isSuccessValue(match?.success) && /^\d{6,}$/.test(cn);
      return {
        orderId: entry.data.orderId,
        success: succeeded,
        trackNumber: succeeded ? cn : null,
        message: succeeded ? "Booked" : stringifyMnpError(match?.message) || "No confirmation returned by M&P",
      };
    });

    results.push(...invalid.map((entry) => ({
      orderId: entry.data.orderId,
      success: false,
      trackNumber: null as string | null,
      message: entry.prepared.error || "Validation failed",
    })));

    return {
      status: readSuccessFlag(apiData) ? 1 : 0,
      message: stringifyMnpError(apiData?.message),
      results,
      raw: response.data,
    };
  } catch (error: any) {
    const apiErrorMessage = stringifyMnpError(error?.response?.data);
    return {
      status: 0,
      error: `M&P Bulk Booking Failed: ${apiErrorMessage || error?.message || "Unknown error"}`,
      results: [],
    };
  }
};

/** 1.2 Void Consignment API */
export const voidMnpConsignments = async (trackingNumbers: string[]) => {
  await fetchMnpConfig();
  const consignments = trackingNumbers
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);

  if (consignments.length === 0) {
    return { status: 0, error: "At least one M&P consignment number is required." };
  }

  if (!hasReportCredentials()) {
    return {
      status: 0,
      error: "M&P void consignment requires Username, Password, Account No, and Location ID in configuration.",
    };
  }

  try {
    const response = await axios.post(`${MNP_API_URL}Booking/VoidConsignment`, {
      Username: MNP_USERNAME,
      password: MNP_PASSWORD,
      locationID: MNP_LOCATION_ID,
      consignmentNumberList: consignments,
    }, {
      headers: { "Content-Type": "application/json" },
      timeout: REQUEST_TIMEOUT,
    });

    const apiData = firstArrayEntry(response.data);
    return {
      ...apiData,
      status: isSuccessValue(apiData?.isSuccess) ? 1 : 0,
      raw: response.data,
    };
  } catch (error: any) {
    const apiErrorMessage = stringifyMnpError(error?.response?.data);
    return {
      status: 0,
      error: apiErrorMessage || error?.message || "M&P void consignment failed",
    };
  }
};

const normalizeTrackingShipment = (shipment: any) => {
  const events = Array.isArray(shipment?.CNTrackingDetail) ? shipment.CNTrackingDetail : [];
  const latestEvent = pickLatestMnpEvent(events);
  const latestStatus = String(
    latestEvent?.TrackingStatus ||
    shipment?.DeliveryStatus ||
    shipment?.CNStatus ||
    "",
  ).trim();

  return {
    consignmentNumber: String(shipment?.ConsignmentNumber || "").trim(),
    status: getMeaningfulMnpStatus(latestStatus),
    tracking_details: events.map((event: any) => ({
      status: event?.TrackingStatus || "",
      time: event?.TransactionTime || "",
      location: event?.Location || "",
      narration: event?.TrackingNarration || "",
    })),
    shipment,
  };
};

/**
 * 6.1 CN Tracking — served from the tracking host and, per the manual, only
 * needs the consignment number and the fixed id=4 (no account credentials).
 */
export const trackMnpShipment = async (trackingNumber: string) => {
  await fetchMnpConfig();

  if (!trackingNumber || trackingNumber.startsWith("MNP-")) {
    return {
      status: "Booked",
      tracking_details: [
        { status: "Booked", time: new Date().toISOString(), location: "", narration: "Shipment booked (Mock)" },
      ],
      raw: null,
    };
  }

  try {
    const response = await axios.get(`${MNP_TRACKING_URL}CNTracking`, {
      params: {
        consignment: trackingNumber,
        id: 4,
      },
      timeout: REQUEST_TIMEOUT,
    });

    const root = firstArrayEntry(response.data);
    const shipment = Array.isArray(root?.tracking_Details) ? root.tracking_Details[0] || {} : {};
    const normalized = normalizeTrackingShipment(shipment);
    const meaningfulStatus = normalized.status || getMeaningfulMnpStatus(root?.message);

    return {
      ...root,
      status: meaningfulStatus || (isSuccessValue(root?.isSuccess) ? "Booked" : "Unknown"),
      tracking_details: normalized.tracking_details,
      tracking_Details: root?.tracking_Details || [],
    };
  } catch (error: any) {
    throw new Error(`M&P Tracking Failed: ${error.message}`);
  }
};

/**
 * 6.2 Bulk Consignment Tracking — tracks up to 200 CNs per call. Returns a
 * normalized entry per consignment (status + events + raw shipment record,
 * which also carries PaymentID / AmountPaid / PaymentDate fields).
 */
export const trackMnpShipmentsBulk = async (trackingNumbers: string[]) => {
  await fetchMnpConfig();

  const consignments = Array.from(new Set(
    (trackingNumbers || [])
      .map((entry) => String(entry || "").trim())
      .filter((entry) => entry && !entry.startsWith("MNP-")),
  ));

  if (consignments.length === 0) {
    return { status: 1, shipments: [] as ReturnType<typeof normalizeTrackingShipment>[] };
  }

  if (!hasAccountCredentials()) {
    return {
      status: 1,
      shipments: consignments.map((cn) => normalizeTrackingShipment({ ConsignmentNumber: cn })),
    };
  }

  const chunks: string[][] = [];
  for (let index = 0; index < consignments.length; index += BULK_TRACKING_CHUNK) {
    chunks.push(consignments.slice(index, index + BULK_TRACKING_CHUNK));
  }

  try {
    const responses = await Promise.all(
      chunks.map((chunk) =>
        axios.post(`${MNP_API_URL}Tracking/Bulk_Consignment_Tracking_New`, {
          Username: MNP_USERNAME,
          Password: MNP_PASSWORD,
          AccountNo: MNP_ACCOUNT_NO,
          Consignments: chunk,
        }, {
          headers: { "Content-Type": "application/json" },
          timeout: REQUEST_TIMEOUT * 2,
        }),
      ),
    );

    const shipments = responses.flatMap((response) => {
      const root = firstArrayEntry(response.data);
      const details = Array.isArray(root?.tracking_Details) ? root.tracking_Details : [];
      return details.map(normalizeTrackingShipment);
    });

    return { status: 1, shipments };
  } catch (error: any) {
    const apiErrorMessage = stringifyMnpError(error?.response?.data);
    return {
      status: 0,
      error: `M&P Bulk Tracking Failed: ${apiErrorMessage || error?.message || "Unknown error"}`,
      shipments: [],
    };
  }
};

export const getMnpTariff = async (_destinationCity: string, weightInGrams: number, _codAmount = 0) => {
  const weightKg = Number(weightInGrams) / 1000;
  const mockRate = 250 + Math.max(0, Math.ceil(weightKg - 1)) * 50;
  return {
    status: 1,
    tariff: mockRate,
    message: "M&P API documentation does not expose a live tariff endpoint; using configured fallback formula.",
  };
};

const buildDateRange = (startDate?: string, endDate?: string) => {
  const today = new Date();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return {
    from: startDate || thirtyDaysAgo.toISOString(),
    to: endDate || today.toISOString(),
  };
};

const buildMonthBuckets = (startDate?: string, endDate?: string) => {
  const range = buildDateRange(startDate, endDate);
  const start = new Date(range.from);
  const end = new Date(range.to);
  const safeStart = Number.isNaN(start.getTime()) ? new Date() : start;
  const safeEnd = Number.isNaN(end.getTime()) ? safeStart : end;
  const cursor = new Date(safeStart.getFullYear(), safeStart.getMonth(), 1);
  const last = new Date(safeEnd.getFullYear(), safeEnd.getMonth(), 1);
  const months: Array<{ monthNumber: number; year: number }> = [];

  while (cursor <= last && months.length < 12) {
    months.push({ monthNumber: cursor.getMonth() + 1, year: cursor.getFullYear() });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months.length > 0 ? months : [{ monthNumber: new Date().getMonth() + 1, year: new Date().getFullYear() }];
};

// Payment_Report enforces a documented 31-day maximum window; split wider
// ranges into compliant chunks and merge the results.
const buildPaymentReportWindows = (startDate?: string, endDate?: string) => {
  const range = buildDateRange(startDate, endDate);
  const start = new Date(range.from);
  const end = new Date(range.to);
  const safeStart = Number.isNaN(start.getTime()) ? new Date(Date.now() - 30 * 86_400_000) : start;
  const safeEnd = Number.isNaN(end.getTime()) ? new Date() : end;

  const windows: Array<{ from: string; to: string }> = [];
  let cursor = new Date(safeStart);
  let guard = 0;

  while (cursor <= safeEnd && guard < 24) {
    const windowEnd = new Date(Math.min(
      cursor.getTime() + (PAYMENT_REPORT_MAX_DAYS - 1) * 86_400_000,
      safeEnd.getTime(),
    ));
    windows.push({ from: cursor.toISOString(), to: windowEnd.toISOString() });
    cursor = new Date(windowEnd.getTime() + 86_400_000);
    guard += 1;
  }

  return windows.length > 0
    ? windows
    : [{ from: safeStart.toISOString(), to: safeEnd.toISOString() }];
};

/** 4.2 Payment Report API */
export const getMnpPaymentReport = async (startDate?: string, endDate?: string) => {
  await fetchMnpConfig();

  if (!hasReportCredentials()) {
    return {
      status: 1,
      paymentReports: [
        {
          isSuccess: true,
          message: "Success (Mock)",
          AccountNo: MNP_ACCOUNT_NO || "4T154",
          Details: [
            {
              serial_no: 1,
              PaymentID: "MNP-MOCK-1",
              PaidOn: new Date().toISOString(),
              RRAmount: 500,
              InvoiceAmount: 0,
              NetPayable: 500,
              InstrumentMode: "IBFT",
              InstrumentNumber: "MOCK",
            },
          ],
        },
      ],
    };
  }

  try {
    const windows = buildPaymentReportWindows(startDate, endDate);
    const responses = await Promise.all(
      windows.map((window) =>
        axios.post(`${MNP_API_URL}Reports/Payment_Report`, {
          UserName: MNP_USERNAME,
          Password: MNP_PASSWORD,
          dateFrom: window.from,
          dateTo: window.to,
          locationID: MNP_LOCATION_ID,
        }, {
          headers: { "Content-Type": "application/json" },
          timeout: REQUEST_TIMEOUT,
        }),
      ),
    );

    const paymentReports = responses.flatMap((response) =>
      Array.isArray(response.data) ? response.data : [response.data],
    );

    return { status: 1, paymentReports };
  } catch (error: any) {
    console.error("M&P Payment Report Error:", error.message);
    return { status: 0, error: error.message, paymentReports: [] };
  }
};

/**
 * Payment details per CN. Uses Bulk Consignment Tracking (6.2) which returns
 * PaymentID / PaymentDate / AmountPaid / InstrumentNumber per shipment record,
 * falling back to single CN tracking when bulk is unavailable.
 */
export const getMnpPaymentDetails = async (cnNumbers: string) => {
  const consignments = cnNumbers
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (consignments.length === 0) {
    return { status: 0, error: "CN Numbers are required" };
  }

  await fetchMnpConfig();

  const buildDetail = (cn: string, shipment: any, message = "") => {
    const paymentId = firstValue(shipment, ["PaymentID", "payment_id", "PaymentId"]);
    const paymentDate = firstValue(shipment, ["PaymentDate", "payment_date", "PaidOn"]);
    const amountPaid = firstValue(shipment, ["AmountPaid", "amount_paid", "PaidAmount", "NetPayable"]);
    const codAmount = firstValue(shipment, ["CODAmount", "CodAmount", "cod_amount"]);
    const instrumentNumber = firstValue(shipment, ["InstrumentNumber", "instrument_number", "ChequeNo", "InvoiceNo"]);

    return {
      booked_packet_cn: cn,
      payment_id: paymentId || null,
      payment_date: paymentDate || null,
      amount_paid: amountPaid || null,
      cod_amount: codAmount || null,
      instrument_number: instrumentNumber || null,
      message,
      raw: shipment,
    };
  };

  let details: Array<ReturnType<typeof buildDetail>> = [];

  if (hasAccountCredentials()) {
    const bulk = await trackMnpShipmentsBulk(consignments);
    if (bulk.status === 1 && bulk.shipments.length > 0) {
      const byCn = new Map(bulk.shipments.map((entry) => [entry.consignmentNumber, entry.shipment]));
      details = consignments.map((cn) => buildDetail(cn, byCn.get(cn) || {}, byCn.has(cn) ? "" : "CN not found in bulk tracking"));
    }
  }

  if (details.length === 0) {
    details = await Promise.all(
      consignments.map(async (cn) => {
        try {
          const tracked = await trackMnpShipment(cn);
          const shipment = Array.isArray((tracked as any).tracking_Details)
            ? (tracked as any).tracking_Details[0] || {}
            : {};
          return buildDetail(cn, shipment, (tracked as any).message || "");
        } catch (error: any) {
          return buildDetail(cn, {}, error?.message || "Tracking failed");
        }
      }),
    );
  }

  return {
    status: 1,
    details,
    ...(details.length === 1 ? details[0] : {}),
  };
};

/** 4.3 CN Detail Customer Order No API */
export const getMnpShipmentByOrderIds = async (orderIds: string[]) => {
  await fetchMnpConfig();

  if (!hasAccountCredentials()) {
    return {
      status: 1,
      details: orderIds.map((orderId) => ({
        consignmentNumber: `MNP-${orderId}`,
        CustomerOrderNo: orderId,
        ServiceType: "Overnight",
      })),
    };
  }

  try {
    const responses = await Promise.all(
      orderIds.map((orderId) =>
        axios.post(`${MNP_API_URL}Reports/CN_Detail_Customer_Order_No`, {
          UserName: MNP_USERNAME,
          Password: MNP_PASSWORD,
          CustomerOrderRef: orderId,
          AccountNumber: MNP_ACCOUNT_NO,
        }, {
          headers: { "Content-Type": "application/json" },
          timeout: REQUEST_TIMEOUT,
        }),
      ),
    );

    const details = responses.flatMap((response) => getNestedDetails(response.data));
    return { status: 1, details };
  } catch (error: any) {
    console.error("M&P Shipment Details Error:", error.message);
    return { status: 0, error: error.message, details: [] };
  }
};

/** 4.5 Get Proof of Delivery */
export const getMnpProofOfDelivery = async (consignmentNumber: string) => {
  await fetchMnpConfig();

  const cn = String(consignmentNumber || "").trim();
  if (!cn) {
    return { status: 0, error: "Consignment number is required" };
  }

  if (!MNP_USERNAME || !MNP_PASSWORD) {
    return { status: 0, error: "M&P username and password are required for proof of delivery." };
  }

  try {
    const response = await axios.get(`${MNP_API_URL}Reports/GetProofOfDelivery`, {
      params: {
        username: MNP_USERNAME,
        password: MNP_PASSWORD,
        consignmentNumber: cn,
      },
      timeout: REQUEST_TIMEOUT,
    });

    const root = firstArrayEntry(response.data);
    const proof = root?.proofOfDeliveryList || root?.ProofOfDeliveryList || {};

    return {
      status: readSuccessFlag(root) ? 1 : 0,
      message: stringifyMnpError(root?.message),
      proof: {
        lastAttemptDate: firstValue(proof, ["LastAttemptDate"]),
        currentLocation: firstValue(proof, ["CurrentLocation"]),
        deliveryStatus: firstValue(proof, ["DeliveryStatus"]),
        deliveryReason: firstValue(proof, ["DeliveryReason"]),
        receivedBy: firstValue(proof, ["ReceivedBy"]),
        relation: firstValue(proof, ["Relation"]),
        deliveryAttempts: Number(firstValue(proof, ["DeliveryAttempts"])) || 0,
        latitude: Number(firstValue(proof, ["Latitude"])) || 0,
        longitude: Number(firstValue(proof, ["Longitude"])) || 0,
        signatureImage: firstValue(proof, ["SignatureImage"]),
        supportingImage: firstValue(proof, ["SupportingImage"]),
      },
      raw: response.data,
    };
  } catch (error: any) {
    const apiErrorMessage = stringifyMnpError(error?.response?.data);
    return {
      status: 0,
      error: apiErrorMessage || error?.message || "M&P proof of delivery failed",
    };
  }
};

const normalizeAdviceRow = (row: any) => ({
  sno: Number(firstValue(row, ["SNo", "sno"])) || 0,
  cn: String(firstValue(row, ["CONSIGNMENTNUMBER", "CN", "cn"])).trim(),
  bookingDate: firstValue(row, ["BOOKINGDATE", "BookingDate"]),
  ticketNo: String(firstValue(row, ["TICKETNO", "TicketNo"])).trim(),
  ticketDate: firstValue(row, ["TICKETDATE", "TicketDate"]),
  createdOn: firstValue(row, ["CREATEDON", "CreatedOn"]),
  destinationBranch: firstValue(row, ["DESTINATIONBRANCH", "DestinationBranch"]),
  pendingReason: firstValue(row, ["PENDINGREASON", "PendingReason"]),
  standardNote: firstValue(row, ["STANDARDNOTE", "StandardNote"]),
  callStatus: firstValue(row, ["CALLSTATUS", "CallStatus"]),
  kpi: firstValue(row, ["KPI"]),
  additionalRemarks: firstValue(row, ["ADDITIONALREMARKS", "AdditionalRemarks"]),
  orderRefNo: firstValue(row, ["OrderRefNo", "ORDERREFNO"]),
  comment: firstValue(row, ["Comment", "Comments"]),
  consignee: firstValue(row, ["Consignee"]),
  consigneeContact: firstValue(row, ["ConsigneeContact"]),
  consigneeAddress: firstValue(row, ["ConsigneeAddress"]),
  codAmount: Number(firstValue(row, ["CodAmount", "CODAmount"])) || 0,
  cnStatus: firstValue(row, ["CNStatus"]),
  raw: row,
});

/**
 * 5.1 Get Shipper Advices — undelivered consignments waiting for the shipper's
 * decision. reportcheckbox: 0 = active advices, 1 = closed advices.
 */
export const getMnpShipperAdvices = async (options: {
  scope?: "active" | "closed";
  cn?: string;
  startDate?: string;
  endDate?: string;
} = {}) => {
  await fetchMnpConfig();

  if (!hasAccountCredentials()) {
    return { status: 1, advices: [], message: "M&P credentials not configured (mock mode)." };
  }

  try {
    const params: Record<string, string | number> = {
      username: MNP_USERNAME,
      password: MNP_PASSWORD,
      AccountNo: MNP_ACCOUNT_NO,
      reportcheckbox: options.scope === "closed" ? 1 : 0,
    };
    if (options.cn) params.cn = String(options.cn).trim();
    if (options.startDate) params.StartDate = options.startDate;
    if (options.endDate) params.EndDate = options.endDate;

    const response = await axios.get(`${MNP_API_URL}ShipperAdvice/GetShipperAdvices`, {
      params,
      timeout: REQUEST_TIMEOUT,
    });

    const root = firstArrayEntry(response.data);
    const rows = Array.isArray(root?.Details) ? root.Details : [];

    return {
      status: readSuccessFlag(root) ? 1 : 0,
      message: stringifyMnpError(root?.message),
      accountNumber: firstValue(root, ["AccountNumber", "AccountNo"]),
      clientName: firstValue(root, ["ClientName"]),
      advices: rows.map(normalizeAdviceRow).filter((row: any) => row.cn),
    };
  } catch (error: any) {
    const apiErrorMessage = stringifyMnpError(error?.response?.data);
    return {
      status: 0,
      error: apiErrorMessage || error?.message || "M&P shipper advices failed",
      advices: [],
    };
  }
};

export type MnpAdviceOption = 1 | 2 | 3; // 1 = hold, 2 = return, 3 = re-attempt
export type MnpReattemptOption = 1 | 2 | 3 | 4;

/**
 * 5.2 Close Shipper Advice — responds to a pending advice.
 * adviceoption: 1 "hold for further advice", 2 "Return the Shipment", 3 "Re-Attempt".
 * reattempt (when re-attempting): 1 same address, 2 new address, 3 hold in office,
 * 4 re-attempt as reason is fake.
 */
export const closeMnpShipperAdvice = async (input: {
  consignment: string;
  adviceOption: MnpAdviceOption;
  reattempt?: MnpReattemptOption;
  remarks?: string;
  consigneeAddress?: string;
  consigneePhone?: string;
}) => {
  await fetchMnpConfig();

  const consignment = String(input.consignment || "").trim();
  if (!consignment) {
    return { status: 0, error: "Consignment number is required" };
  }

  const adviceOption = Number(input.adviceOption) as MnpAdviceOption;
  if (![1, 2, 3].includes(adviceOption)) {
    return { status: 0, error: "adviceOption must be 1 (hold), 2 (return), or 3 (re-attempt)." };
  }

  const reattempt = input.reattempt ? (Number(input.reattempt) as MnpReattemptOption) : undefined;
  if (adviceOption === 3 && !reattempt) {
    return { status: 0, error: "A re-attempt option (1-4) is required when advising a re-attempt." };
  }
  if (reattempt && ![1, 2, 3, 4].includes(reattempt)) {
    return { status: 0, error: "reattempt must be 1 (same address), 2 (new address), 3 (hold in office), or 4 (reason is fake)." };
  }
  if (reattempt === 2 && !String(input.consigneeAddress || "").trim()) {
    return { status: 0, error: "A new consignee address is required when re-attempting on a new address." };
  }

  if (!hasAccountCredentials()) {
    return { status: 0, error: "M&P credentials are not configured." };
  }

  try {
    const params: Record<string, string | number> = {
      username: MNP_USERNAME,
      password: MNP_PASSWORD,
      accountno: MNP_ACCOUNT_NO,
      consignment,
      adviceoption: adviceOption,
    };
    if (reattempt) params.reattempt = reattempt;
    if (input.remarks) params.remarks = String(input.remarks).trim().slice(0, 400);
    if (input.consigneeAddress) params.consigneeaddress = String(input.consigneeAddress).trim().slice(0, 255);
    if (input.consigneePhone) params.consigneeno = normalizeMnpPhone(input.consigneePhone);

    const response = await axios.get(`${MNP_API_URL}ShipperAdvice/CloseShipperAdvice`, {
      params,
      timeout: REQUEST_TIMEOUT,
    });

    const root = firstArrayEntry(response.data);
    const succeeded = readSuccessFlag(root);
    return {
      status: succeeded ? 1 : 0,
      message: stringifyMnpError(root?.message) || (succeeded ? "Advice closed" : "M&P rejected the advice"),
      raw: response.data,
    };
  } catch (error: any) {
    const apiErrorMessage = stringifyMnpError(error?.response?.data);
    return {
      status: 0,
      error: apiErrorMessage || error?.message || "M&P close shipper advice failed",
    };
  }
};

/** 5.3 Get Init Data API — advice dropdown values (call tracks / re-attempt reasons). */
export const getMnpAdviceInitData = async (cn: string, from?: string, to?: string) => {
  await fetchMnpConfig();

  if (!hasAccountCredentials()) {
    return { status: 0, error: "M&P credentials are not configured." };
  }

  try {
    const response = await axios.post(`${MNP_API_URL}ShipperAdvice/GetInitData`, {
      Type: 1,
      AccountNo: MNP_ACCOUNT_NO,
      From: from || "",
      To: to || "",
      CN: String(cn || "").trim(),
    }, {
      headers: { "Content-Type": "application/json" },
      timeout: REQUEST_TIMEOUT,
    });

    const root = response.data || {};
    return {
      status: root?.sts === 0 || readSuccessFlag(root) ? 1 : 0,
      callTracks: Array.isArray(root?.calltracks) ? root.calltracks : [],
      reattempts: Array.isArray(root?.reattempts) ? root.reattempts : [],
      advices: Array.isArray(root?.advices) ? root.advices : [],
      raw: root,
    };
  } catch (error: any) {
    const apiErrorMessage = stringifyMnpError(error?.response?.data);
    return { status: 0, error: apiErrorMessage || error?.message || "M&P advice init data failed" };
  }
};

/** 5.4 Get Advices API — detailed advice records for a CN. */
export const getMnpAdvices = async (cn: string, from?: string, to?: string) => {
  await fetchMnpConfig();

  if (!hasAccountCredentials()) {
    return { status: 0, error: "M&P credentials are not configured.", advices: [] };
  }

  try {
    const response = await axios.post(`${MNP_API_URL}ShipperAdvice/GetAdvices`, {
      Type: 1,
      AccountNo: MNP_ACCOUNT_NO,
      CN: String(cn || "").trim(),
      ...(from ? { From: from } : {}),
      ...(to ? { To: to } : {}),
    }, {
      headers: { "Content-Type": "application/json" },
      timeout: REQUEST_TIMEOUT,
    });

    const root = response.data || {};
    const rows = Array.isArray(root?.data) ? root.data : [];
    return {
      status: root?.sts === 0 || rows.length > 0 ? 1 : 0,
      advices: rows.map(normalizeAdviceRow),
      raw: root,
    };
  } catch (error: any) {
    const apiErrorMessage = stringifyMnpError(error?.response?.data);
    return { status: 0, error: apiErrorMessage || error?.message || "M&P get advices failed", advices: [] };
  }
};

/** 5.6 Ticket Details — call-center follow-up history for a CN. */
export const getMnpTicketDetails = async (cn: string) => {
  await fetchMnpConfig();

  const consignment = String(cn || "").trim();
  if (!consignment) {
    return { status: 0, error: "Consignment number is required", tickets: [] };
  }

  try {
    const response = await axios.get(`${MNP_API_URL}ShipperAdvice/TicketDetails`, {
      params: { cn: consignment },
      timeout: REQUEST_TIMEOUT,
    });

    const root = response.data || {};
    const rows = Array.isArray(root?.data) ? root.data : [];
    return {
      status: 1,
      tickets: rows.map((row: any) => ({
        status: firstValue(row, ["Status"]),
        ticketNo: firstValue(row, ["TicketNo"]),
        reason: firstValue(row, ["Reason"]),
        callStatus: firstValue(row, ["CallStatus"]),
        callTime: firstValue(row, ["CallTime"]),
        callTrack: firstValue(row, ["CallTrack"]),
        comments: firstValue(row, ["Comments"]),
        consignee: firstValue(row, ["Consignee"]),
        consigneeCell: firstValue(row, ["ConsigneeCell"]),
        consigneeAddress: firstValue(row, ["ConsigneeAddress"]),
      })),
      raw: root,
    };
  } catch (error: any) {
    const apiErrorMessage = stringifyMnpError(error?.response?.data);
    return { status: 0, error: apiErrorMessage || error?.message || "M&P ticket details failed", tickets: [] };
  }
};

const normalizeLocationList = (data: any) => {
  const root = firstArrayEntry(data);
  const list = Array.isArray(root?.locationList) ? root.locationList : [];
  return list.map((entry: any) => ({
    locationId: String(firstValue(entry, ["locationID", "LocationID", "locationId"])).trim(),
    locationName: firstValue(entry, ["locationName", "LocationName"]),
    locationAddress: firstValue(entry, ["locationAddress", "LocationAddress"]),
  })).filter((entry: any) => entry.locationId);
};

/** 3.1 Get Locations — booking/return location IDs available on the account. */
export const getMnpLocations = async () => {
  await fetchMnpConfig();

  if (!hasAccountCredentials()) {
    return { status: 0, error: "M&P credentials are not configured.", locations: [] };
  }

  try {
    const response = await axios.get(`${MNP_API_URL}Locations/Get_locations`, {
      params: {
        username: MNP_USERNAME,
        password: MNP_PASSWORD,
        AccountNo: MNP_ACCOUNT_NO,
      },
      timeout: REQUEST_TIMEOUT,
    });

    return {
      status: readSuccessFlag(firstArrayEntry(response.data)) ? 1 : 0,
      message: stringifyMnpError(firstArrayEntry(response.data)?.message),
      locations: normalizeLocationList(response.data),
    };
  } catch (error: any) {
    const apiErrorMessage = stringifyMnpError(error?.response?.data);
    return { status: 0, error: apiErrorMessage || error?.message || "M&P locations lookup failed", locations: [] };
  }
};

/** 3.4 Get Sub Account Locations */
export const getMnpSubAccountLocations = async (subAccountId?: number) => {
  await fetchMnpConfig();

  if (!MNP_USERNAME || !MNP_PASSWORD) {
    return { status: 0, error: "M&P credentials are not configured.", locations: [] };
  }

  try {
    const params: Record<string, string | number> = {
      username: MNP_USERNAME,
      password: MNP_PASSWORD,
    };
    const resolvedSubAccountId = parsePositiveInt(subAccountId) || MNP_SUB_ACCOUNT_ID;
    if (resolvedSubAccountId) params.SubAccountId = resolvedSubAccountId;

    const response = await axios.get(`${MNP_API_URL}Locations/GetSubAccountLocations`, {
      params,
      timeout: REQUEST_TIMEOUT,
    });

    return {
      status: readSuccessFlag(firstArrayEntry(response.data)) ? 1 : 0,
      locations: normalizeLocationList(response.data),
    };
  } catch (error: any) {
    const apiErrorMessage = stringifyMnpError(error?.response?.data);
    return { status: 0, error: apiErrorMessage || error?.message || "M&P sub account locations lookup failed", locations: [] };
  }
};

/** 3.2 Add Location API */
export const addMnpLocation = async (input: {
  branchCode: number;
  locationName: string;
  locationAddress: string;
}) => {
  await fetchMnpConfig();

  if (!hasAccountCredentials()) {
    return { status: 0, error: "M&P credentials are not configured." };
  }

  try {
    const response = await axios.post(`${MNP_API_URL}Locations/AddLocation`, {
      userId: MNP_USERNAME,
      password: MNP_PASSWORD,
      accountNo: MNP_ACCOUNT_NO,
      branchCode: Number(input.branchCode) || 1,
      locationName: String(input.locationName || "").slice(0, 50),
      locationAddress: String(input.locationAddress || "").slice(0, 255),
      to: [""],
      cc: [""],
    }, {
      headers: { "Content-Type": "application/json" },
      timeout: REQUEST_TIMEOUT,
    });

    const root = response.data || {};
    return {
      status: isSuccessValue(root?.status) ? 1 : 0,
      message: stringifyMnpError(root?.msg),
      locationId: root?.id ?? null,
      raw: root,
    };
  } catch (error: any) {
    const apiErrorMessage = stringifyMnpError(error?.response?.data);
    return { status: 0, error: apiErrorMessage || error?.message || "M&P add location failed" };
  }
};

/** 3.3 Add Location with Sub Account API */
export const addMnpLocationWithSubAccount = async (input: {
  branchName: string;
  locationName: string;
  locationAddress: string;
  subAccountId: number;
}) => {
  await fetchMnpConfig();

  if (!hasAccountCredentials()) {
    return { status: 0, error: "M&P credentials are not configured." };
  }

  try {
    const response = await axios.post(`${MNP_API_URL}Locations/AddLocationWithSubAccount`, {
      userId: MNP_USERNAME,
      password: MNP_PASSWORD,
      accountNo: MNP_ACCOUNT_NO,
      branchName: String(input.branchName || "").slice(0, 50),
      locationName: String(input.locationName || "").slice(0, 50),
      locationAddress: String(input.locationAddress || "").slice(0, 255),
      to: [""],
      cc: [""],
      SubAccountID: Number(input.subAccountId),
    }, {
      headers: { "Content-Type": "application/json" },
      timeout: REQUEST_TIMEOUT,
    });

    const root = response.data || {};
    return {
      status: isSuccessValue(root?.status) ? 1 : 0,
      message: stringifyMnpError(root?.msg),
      locationId: root?.id ?? null,
      raw: root,
    };
  } catch (error: any) {
    const apiErrorMessage = stringifyMnpError(error?.response?.data);
    return { status: 0, error: apiErrorMessage || error?.message || "M&P add location with sub account failed" };
  }
};

/** 3.5 Create Sub Account */
export const createMnpSubAccount = async (input: {
  shipperName: string;
  shipperAddress: string;
  autoCn?: boolean;
}) => {
  await fetchMnpConfig();

  if (!hasAccountCredentials()) {
    return { status: 0, error: "M&P credentials are not configured." };
  }

  try {
    const response = await axios.post(`${MNP_API_URL}Locations/CreateSubAccount`, {
      Username: MNP_USERNAME,
      Password: MNP_PASSWORD,
      AccountNo: MNP_ACCOUNT_NO,
      ShipperName: String(input.shipperName || "").slice(0, 50),
      ShipperAddress: String(input.shipperAddress || "").slice(0, 255),
      AutoCN: input.autoCn !== false,
    }, {
      headers: { "Content-Type": "application/json" },
      timeout: REQUEST_TIMEOUT,
    });

    const root = firstArrayEntry(response.data);
    const detail = root?.subAccountDetail || {};
    return {
      status: readSuccessFlag(root) ? 1 : 0,
      message: stringifyMnpError(root?.message),
      subAccount: {
        subAccountId: parsePositiveInt(detail?.SubAccountId),
        shipperName: firstValue(detail, ["ShipperName"]),
        shipperAddress: firstValue(detail, ["ShipperAddress"]),
      },
      raw: response.data,
    };
  } catch (error: any) {
    const apiErrorMessage = stringifyMnpError(error?.response?.data);
    return { status: 0, error: apiErrorMessage || error?.message || "M&P create sub account failed" };
  }
};

/** 7.2 Get Accounts — accounts visible to this username/password. */
export const getMnpAccounts = async () => {
  await fetchMnpConfig();

  if (!MNP_USERNAME || !MNP_PASSWORD) {
    return { status: 0, error: "M&P username and password are required.", accounts: [] };
  }

  try {
    const response = await axios.get(`${MNP_API_URL}UserManagement/GetAccounts`, {
      params: {
        username: MNP_USERNAME,
        password: MNP_PASSWORD,
      },
      timeout: REQUEST_TIMEOUT,
    });

    const root = firstArrayEntry(response.data);
    const list = Array.isArray(root?.locationList) ? root.locationList : [];
    return {
      status: readSuccessFlag(root) ? 1 : 0,
      message: stringifyMnpError(root?.message),
      accounts: list.map((entry: any) => ({
        accountNo: String(firstValue(entry, ["AccountNo", "accountNo"])).trim(),
        isCod: isSuccessValue(entry?.IsCod ?? entry?.isCod),
      })).filter((entry: any) => entry.accountNo),
    };
  } catch (error: any) {
    const apiErrorMessage = stringifyMnpError(error?.response?.data);
    return { status: 0, error: apiErrorMessage || error?.message || "M&P accounts lookup failed", accounts: [] };
  }
};

/** 7.1 Get Sub Accounts */
export const getMnpSubAccounts = async () => {
  await fetchMnpConfig();

  if (!hasAccountCredentials()) {
    return { status: 0, error: "M&P credentials are not configured.", subAccounts: [] };
  }

  try {
    const response = await axios.get(`${MNP_API_URL}UserManagement/GetSubAccounts`, {
      params: {
        username: MNP_USERNAME,
        password: MNP_PASSWORD,
        accountNo: MNP_ACCOUNT_NO,
      },
      timeout: REQUEST_TIMEOUT,
    });

    const root = firstArrayEntry(response.data);
    const list = Array.isArray(root?.locationList) ? root.locationList : [];
    return {
      status: readSuccessFlag(root) ? 1 : 0,
      message: stringifyMnpError(root?.message),
      subAccounts: list.map((entry: any) => ({
        subAccountId: parsePositiveInt(firstValue(entry, ["subAccountId", "SubAccountId"])),
        shipperName: firstValue(entry, ["shipperName", "ShipperName"]),
        shipperAddress: firstValue(entry, ["shipperAddress", "ShipperAddress"]),
      })).filter((entry: any) => entry.subAccountId),
    };
  } catch (error: any) {
    const apiErrorMessage = stringifyMnpError(error?.response?.data);
    return { status: 0, error: apiErrorMessage || error?.message || "M&P sub accounts lookup failed", subAccounts: [] };
  }
};

/**
 * Runs the read-only lookups against the configured credentials and reports
 * which configuration values check out — used by the admin Config tab so a
 * misconfigured account is diagnosed in one click instead of failed bookings.
 */
export const verifyMnpConnection = async () => {
  const config = await fetchMnpConfig();

  const checks: Array<{ name: string; ok: boolean; message: string }> = [];

  if (!MNP_USERNAME || !MNP_PASSWORD) {
    checks.push({ name: "Credentials", ok: false, message: "Username and password are not configured." });
    return { status: 0, checks, accounts: [], locations: [], subAccounts: [], citiesCount: 0 };
  }

  const [accountsResult, locationsResult, subAccountsResult, cities] = await Promise.all([
    getMnpAccounts(),
    getMnpLocations(),
    getMnpSubAccounts(),
    getAllMnpCities("booking").catch(() => [] as Array<{ id: string; name: string }>),
  ]);

  const credentialsOk = accountsResult.status === 1 && accountsResult.accounts.length > 0;
  checks.push({
    name: "Credentials",
    ok: credentialsOk,
    message: credentialsOk
      ? `Authenticated. ${accountsResult.accounts.length} account(s) visible.`
      : accountsResult.error || accountsResult.message || "M&P rejected the username/password.",
  });

  const accountMatch = accountsResult.accounts.find(
    (entry: any) => entry.accountNo.toLowerCase() === (MNP_ACCOUNT_NO || "").toLowerCase(),
  );
  checks.push({
    name: "Account No",
    ok: Boolean(accountMatch),
    message: accountMatch
      ? `Account ${accountMatch.accountNo} found${accountMatch.isCod ? " (COD enabled)" : " (COD disabled!)"}.`
      : `Account "${MNP_ACCOUNT_NO || "(empty)"}" not visible for this user.`,
  });

  const locationMatch = locationsResult.locations.find(
    (entry: any) => entry.locationId === String(MNP_LOCATION_ID || "").trim(),
  );
  checks.push({
    name: "Location ID",
    ok: Boolean(locationMatch),
    message: locationMatch
      ? `Location ${locationMatch.locationId} - ${locationMatch.locationName}.`
      : `Location ID "${MNP_LOCATION_ID || "(empty)"}" not found in account locations.`,
  });

  const returnMatch = locationsResult.locations.find(
    (entry: any) => entry.locationId === String(MNP_RETURN_LOCATION || "").trim(),
  );
  checks.push({
    name: "Return Location",
    ok: Boolean(returnMatch),
    message: returnMatch
      ? `Return location ${returnMatch.locationId} - ${returnMatch.locationName}.`
      : `Return location "${MNP_RETURN_LOCATION || "(empty)"}" not found in account locations.`,
  });

  const subAccountMatch = subAccountsResult.subAccounts.find(
    (entry: any) => entry.subAccountId === MNP_SUB_ACCOUNT_ID,
  );
  checks.push({
    name: "Sub Account",
    ok: Boolean(subAccountMatch),
    message: subAccountMatch
      ? `Sub account ${subAccountMatch.subAccountId} - ${subAccountMatch.shipperName}.`
      : `Sub account "${MNP_SUB_ACCOUNT_ID || "(empty)"}" not found for this account.`,
  });

  checks.push({
    name: "Booking Cities",
    ok: cities.length > 0,
    message: cities.length > 0
      ? `${cities.length} booking cities available.`
      : "Could not load the booking city list.",
  });

  return {
    status: checks.every((check) => check.ok) ? 1 : 0,
    checks,
    accounts: accountsResult.accounts,
    locations: locationsResult.locations,
    subAccounts: subAccountsResult.subAccounts,
    citiesCount: cities.length,
    configured: {
      username: Boolean(MNP_USERNAME),
      accountNo: MNP_ACCOUNT_NO || "",
      locationId: MNP_LOCATION_ID || "",
      returnLocation: MNP_RETURN_LOCATION || "",
      subAccountId: MNP_SUB_ACCOUNT_ID,
      insertType: MNP_INSERT_TYPE,
      service: MNP_SERVICE,
      baseUrl: MNP_API_URL,
      trackingUrl: MNP_TRACKING_URL,
      updatedAt: config?.updatedAt || null,
    },
  };
};

/** 4.1 QSR Report API — month-bucketed shipment history. */
export const getMnpShipmentHistory = async (startDate?: string, endDate?: string) => {
  await fetchMnpConfig();
  const monthBuckets = buildMonthBuckets(startDate, endDate);

  if (!hasReportCredentials()) {
    return {
      status: 1,
      shipments: [
        {
          tracking_number: "MNP-544794010101495",
          booked_packet_order_id: "MOCK-ORDER",
          booking_date: new Date().toISOString().slice(0, 10),
          delivery_date: "",
          consignment_name_eng: "Mock Customer",
          consignment_phone: "03000000000",
          consignment_address: "Mock Address",
          origin_city: "Faisalabad",
          destination_city: "Karachi",
          booked_packet_status: "Booked",
          shipment_type: "Overnight",
          cod_value: "1000",
        },
      ],
    };
  }

  try {
    const responses = await Promise.all(
      monthBuckets.map((bucket) =>
        axios.post(`${MNP_API_URL}Reports/QSR_Report`, {
          UserName: MNP_USERNAME,
          Password: MNP_PASSWORD,
          MonthNumber: bucket.monthNumber,
          year: bucket.year,
          locationID: MNP_LOCATION_ID,
        }, {
          headers: { "Content-Type": "application/json" },
          timeout: 30000,
        }),
      ),
    );

    const rows = responses.flatMap((response) => getNestedDetails(response.data));
    const shipments = rows.map((shipment: any) => ({
      tracking_number: String(firstValue(shipment, ["consignmentNumber", "ConsignmentNumber", "CONSIGNMENTNUMBER", "CN"])).trim(),
      booked_packet_order_id: firstValue(shipment, ["orderRefNo", "OrderRefNo", "CustomerOrderNo", "OrderId", "OrderID"]),
      booking_date: firstValue(shipment, ["BookingDate", "BOOKINGDATE", "bookingDate"]),
      delivery_date: firstValue(shipment, ["deliveryDate", "DeliveryDate", "DELIVERYDATE"]),
      shipper_id: null,
      booked_packet_weight: firstValue(shipment, ["WEIGHT", "Weight", "weight"]) ? String(firstValue(shipment, ["WEIGHT", "Weight", "weight"])) : "",
      arival_dispatch_weight: "",
      origin_city: firstValue(shipment, ["OrgBranch", "OrgZone", "OriginCity"]),
      destination_city: firstValue(shipment, ["DESTINATION", "DESTZONE", "DestinationCity"]),
      consignment_name_eng: firstValue(shipment, ["consignee", "Consignee", "ConsigneeName"]),
      consignment_phone: firstValue(shipment, ["consigneePhoneNo", "ContactNo", "ConsigneeContact"]),
      consignment_address: firstValue(shipment, ["address", "DeliveryAddress", "ConsigneeAddress"]),
      booked_packet_status: firstValue(shipment, ["RRStatus", "CNStatus", "DeliveryStatus", "Status"]),
      shipment_type: firstValue(shipment, ["SERVICE", "ServiceType"]),
      cod_value: firstValue(shipment, ["CODAmount", "CodAmount"]) ? String(firstValue(shipment, ["CODAmount", "CodAmount"])) : "",
      rawPayload: shipment,
    })).filter((shipment: any) => shipment.tracking_number);

    return { status: 1, shipments };
  } catch (error: any) {
    console.error("M&P Shipment History Error:", error.message);
    return { status: 0, message: error.message, shipments: [] };
  }
};
