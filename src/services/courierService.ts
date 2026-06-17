import { bookLeopardsShipment, getAllLeopardsCities, getLeopardsTariff, trackLeopardsShipment } from "./leopardsService";
import { bookMnpShipment, getAllMnpCities, getMnpTariff, trackMnpShipment, type MnpBookingData } from "./mnpService";

export type CourierProvider = "leopards" | "mnp";

export type CourierBookingData = MnpBookingData;

export const normalizeCourierProvider = (value?: string | null): CourierProvider => {
  const normalized = (value || "").trim().toLowerCase();
  if (["mnp", "m&p", "mnpcourier", "mulphilog"].includes(normalized)) {
    return "mnp";
  }
  return "leopards";
};

export const getActiveCourierProvider = (): CourierProvider =>
  normalizeCourierProvider(process.env.COURIER_PROVIDER || process.env.ACTIVE_COURIER_PROVIDER);

export const getCourierName = (provider?: string | null): string =>
  normalizeCourierProvider(provider) === "mnp" ? "M&P" : "Leopards";

export const inferCourierProviderFromTrackingNumber = (trackingNumber?: string | null): CourierProvider => {
  const normalized = (trackingNumber || "").trim();
  if (/^\d{10,20}$/.test(normalized) || normalized.toUpperCase().startsWith("MNP-")) {
    return "mnp";
  }
  return "leopards";
};

export const getCourierCities = async (provider: CourierProvider = getActiveCourierProvider()) => {
  if (provider === "mnp") {
    return getAllMnpCities();
  }
  return getAllLeopardsCities();
};

export const calculateCourierShipping = async (
  input: { cityId?: string | number; cityName?: string; weightGrams: number; subtotal?: number },
  provider: CourierProvider = getActiveCourierProvider(),
) => {
  if (provider === "mnp") {
    return getMnpTariff(String(input.cityName || input.cityId || ""), Number(input.weightGrams), Number(input.subtotal || 0));
  }

  const destinationCityId = Number(input.cityId);
  return getLeopardsTariff(destinationCityId, Number(input.weightGrams), Number(input.subtotal || 0));
};

export const bookCourierShipment = async (
  data: CourierBookingData,
  provider: CourierProvider = getActiveCourierProvider(),
) => {
  if (provider === "mnp") {
    return bookMnpShipment(data);
  }
  return bookLeopardsShipment(data);
};

export const trackCourierShipment = async (trackingNumber: string, provider?: string | null) => {
  const resolvedProvider = provider
    ? normalizeCourierProvider(provider)
    : inferCourierProviderFromTrackingNumber(trackingNumber);

  if (resolvedProvider === "mnp") {
    return trackMnpShipment(trackingNumber);
  }
  return trackLeopardsShipment(trackingNumber);
};
