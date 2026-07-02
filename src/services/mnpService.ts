import axios from "axios";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_API_BASE_URL = "https://mnpcourier.com/mycodapi/api/";
const DEFAULT_TRACKING_BASE_URL = "https://tracking.mulphilog.com.pk/api/";
const CACHE_DURATION = 1000 * 60 * 60;

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

const isSuccessValue = (value: unknown): boolean => {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    return ["true", "1", "success", "successful"].includes(value.trim().toLowerCase());
  }
  return false;
};

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

interface CacheStore {
  cities: Array<{ id: string; name: string }>;
  timestamp: number;
}

const cache: CacheStore = {
  cities: [],
  timestamp: 0,
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

export const getAllMnpCities = async (): Promise<Array<{ id: string; name: string }>> => {
  await fetchMnpConfig();

  if (cache.cities.length > 0 && Date.now() - cache.timestamp < CACHE_DURATION) {
    return cache.cities;
  }

  if (!hasAccountCredentials()) {
    return MOCK_CITIES;
  }

  try {
    const response = await axios.get(`${MNP_API_URL}Branches/Get_Cities_All`, {
      params: {
        username: MNP_USERNAME,
        password: MNP_PASSWORD,
        AccountNo: MNP_ACCOUNT_NO,
      },
      timeout: 20000,
    });

    const cityNames = Array.isArray(response.data)
      ? response.data.flatMap((entry: any) => Array.isArray(entry?.City) ? entry.City : [])
      : Array.isArray(response.data?.City)
        ? response.data.City
        : [];

    const citySet = new Set<string>(
      cityNames
        .map((city: unknown) => String(city || "").trim())
        .filter(Boolean),
    );
    const cities = Array.from(citySet).map((name) => ({ id: name, name }));

    if (cities.length > 0) {
      cache.cities = cities;
      cache.timestamp = Date.now();
      return cities;
    }

    return MOCK_CITIES;
  } catch (error: any) {
    console.error("Failed to fetch M&P cities:", error.message);
    return cache.cities.length > 0 ? cache.cities : MOCK_CITIES;
  }
};

const resolveCityName = async (city: string | number): Promise<string> => {
  const normalized = String(city || "").trim();
  if (!normalized) return "Karachi";

  const cities = await getAllMnpCities();
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

  try {
    const destinationCityName = await resolveCityName(data.city);
    const remarks = String(data.remarks || `Order ${data.orderId}`).trim().slice(0, 400);
    const payload = {
      username: MNP_USERNAME,
      password: MNP_PASSWORD,
      consigneeName: String(data.customerName || "Customer").slice(0, 50),
      consigneeAddress: String(data.customerAddress || "").slice(0, 255),
      consigneeMobNo: String(data.customerPhone || "").slice(0, 50),
      consigneeEmail: String(data.customerEmail || "").slice(0, 50),
      destinationCityName,
      pieces: Math.max(1, Math.min(99, Math.round(Number(data.pieces || 1)))),
      weight: gramsToMnpWeight(Number(data.weight) || 500),
      codAmount: Math.max(0, Math.round(Number(data.amount) || 0)),
      custRefNo: String(data.orderId || "").slice(0, 50),
      productDetails: String(data.productDetails || "Order items").slice(0, 50),
      fragile: String(data.fragile || MNP_FRAGILE || "NO").toUpperCase() === "YES" ? "YES" : "NO",
      service: String(data.service || MNP_SERVICE || "Overnight").slice(0, 50),
      remarks,
      Remarks: remarks,
      insuranceValue: String(data.insuranceValue ?? "0").replace(/,/g, "").slice(0, 20) || "0",
      locationID: MNP_LOCATION_ID,
      AccountNo: MNP_ACCOUNT_NO,
      InsertType: MNP_INSERT_TYPE,
      ReturnLocation: MNP_RETURN_LOCATION,
      subAccountId: MNP_SUB_ACCOUNT_ID,
    };

    const response = await axios.post(`${MNP_API_URL}Booking/InsertBookingData`, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 20000,
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
      timeout: 20000,
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

export const trackMnpShipment = async (trackingNumber: string) => {
  await fetchMnpConfig();

  if (!trackingNumber || trackingNumber.startsWith("MNP-") || !hasAccountCredentials()) {
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
      timeout: 20000,
    });

    const root = firstArrayEntry(response.data);
    const shipment = Array.isArray(root?.tracking_Details) ? root.tracking_Details[0] || {} : {};
    const events = Array.isArray(shipment?.CNTrackingDetail) ? shipment.CNTrackingDetail : [];
    const latestEvent = pickLatestMnpEvent(events);
    const latestStatus = String(
      latestEvent?.TrackingStatus ||
      shipment?.DeliveryStatus ||
      shipment?.CNStatus ||
      root?.message ||
      "",
    ).trim();
    const meaningfulStatus = getMeaningfulMnpStatus(latestStatus);

    return {
      ...root,
      status: meaningfulStatus || (isSuccessValue(root?.isSuccess) ? "Booked" : "Unknown"),
      tracking_details: events.map((event: any) => ({
        status: event?.TrackingStatus || "",
        time: event?.TransactionTime || "",
        location: event?.Location || "",
        narration: event?.TrackingNarration || "",
      })),
      tracking_Details: root?.tracking_Details || [],
    };
  } catch (error: any) {
    throw new Error(`M&P Tracking Failed: ${error.message}`);
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

export const getMnpPaymentReport = async (startDate?: string, endDate?: string) => {
  await fetchMnpConfig();
  const range = buildDateRange(startDate, endDate);

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
    const response = await axios.post(`${MNP_API_URL}Reports/Payment_Report`, {
      UserName: MNP_USERNAME,
      Password: MNP_PASSWORD,
      dateFrom: range.from,
      dateTo: range.to,
      locationID: MNP_LOCATION_ID,
    }, {
      headers: { "Content-Type": "application/json" },
      timeout: 20000,
    });

    return {
      status: 1,
      paymentReports: Array.isArray(response.data) ? response.data : [response.data],
    };
  } catch (error: any) {
    console.error("M&P Payment Report Error:", error.message);
    return { status: 0, error: error.message, paymentReports: [] };
  }
};

export const getMnpPaymentDetails = async (cnNumbers: string) => {
  const consignments = cnNumbers
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (consignments.length === 0) {
    return { status: 0, error: "CN Numbers are required" };
  }

  const details = await Promise.all(
    consignments.map(async (cn) => {
      const tracked = await trackMnpShipment(cn);
      const shipment = Array.isArray((tracked as any).tracking_Details)
        ? (tracked as any).tracking_Details[0] || {}
        : {};
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
        message: (tracked as any).message || "",
        raw: shipment,
      };
    }),
  );

  return {
    status: 1,
    details,
    ...(details.length === 1 ? details[0] : {}),
  };
};

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
          timeout: 20000,
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
