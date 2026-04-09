import axios from "axios";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Initial defaults from .env
let LEOPARDS_API_KEY = process.env.LEOPARDS_API_KEY || "";
let LEOPARDS_API_PASSWORD = process.env.LEOPARDS_API_PASSWORD || "";
let LEOPARDS_API_URL = process.env.LEOPARDS_API_URL || "https://merchantapistaging.leopardscourier.com/api/";

// Helper to get latest config from DB
const fetchLeopardsConfig = async () => {
    try {
        const config = await prisma.leopardsConfig.findFirst();
        if (config) {
            LEOPARDS_API_KEY = config.apiKey;
            LEOPARDS_API_PASSWORD = config.apiPassword;
            LEOPARDS_API_URL = config.baseUrl;
            return config;
        }
    } catch (err) {
        console.error("Failed to fetch Leopards config from DB, using .env defaults");
    }
    return null;
};

// In-memory cache for cities
interface CacheStore {
    cities: any[];
    timestamp: number;
}

const cache: CacheStore = {
    cities: [],
    timestamp: 0
};

const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

const MOCK_CITIES = [
    { id: "1", name: "Karachi" }, 
    { id: "2", name: "Lahore" }, 
    { id: "3", name: "Islamabad" },
    { id: "4", name: "Faisalabad" },
    { id: "5", name: "Rawalpindi" },
    { id: "6", name: "Multan" },
    { id: "7", name: "Peshawar" },
    { id: "8", name: "Quetta" },
    { id: "9", name: "Sialkot" },
    { id: "10", name: "Gujranwala" }
];

export interface LeopardsBookingData {
    orderId: string;
    customerName: string;
    customerPhone: string;
    customerAddress: string;
    city: string | number; // Support both name and ID
    amount: number;
    weight: number; // Weight in grams
    pieces?: number;
    shipmentType?: string; // e.g., 'overnight'
}

export const getAllLeopardsCities = async (): Promise<any[]> => {
    // Refresh config from DB before fetching
    await fetchLeopardsConfig();

    // Return cache if it's still valid
    if (cache.cities.length > 0 && (Date.now() - cache.timestamp) < CACHE_DURATION) {
        return cache.cities;
    }

    // Use mock data if no API key is provided
    if (LEOPARDS_API_KEY === "" || LEOPARDS_API_KEY === "YOUR_API_KEY") {
        return MOCK_CITIES;
    }

    try {
        console.log(`[LEOPARDS] Fetching cities via POST from: ${LEOPARDS_API_URL}getAllCities/format/json/`);
        const response = await axios.post(`${LEOPARDS_API_URL}getAllCities/format/json/`, {
            api_key: LEOPARDS_API_KEY,
            api_password: LEOPARDS_API_PASSWORD,
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log(`[LEOPARDS] Response Status: ${response.status}`);
        
        if (response.data && response.data.status == 1 && response.data.city_list && Array.isArray(response.data.city_list)) {
            // Map Leopards API keys (city_id, city_name) to standard keys (id, name)
            cache.cities = response.data.city_list.map((c: any) => ({
                id: String(c.city_id || c.id),
                name: c.city_name || c.name
            }));
            cache.timestamp = Date.now();
            console.log(`[LEOPARDS] Successfully cached ${cache.cities.length} cities.`);
            return cache.cities;
        }
        
        console.warn(`[LEOPARDS] API returned error or invalid format. Falling back to MOCK.`);
        return MOCK_CITIES;
    } catch (error: any) {
        console.error("Failed to fetch Leopards cities:", error.message);
        if (error.response) {
            console.error("API Response Error Status:", error.response.status);
            console.error("API Response Error Data:", error.response.data);
        }
        return cache.cities.length > 0 ? cache.cities : MOCK_CITIES; 
    }
};

const resolveCityToId = async (cityName: string): Promise<number | null> => {
    const cities = await getAllLeopardsCities();
    const city = cities.find((c: any) => c.name && c.name.toLowerCase() === cityName.toLowerCase());
    return city ? parseInt(String(city.id)) : null;
};

export const bookLeopardsShipment = async (data: LeopardsBookingData) => {
    // Refresh config from DB
    const config = await fetchLeopardsConfig();

    // If credentials are mock, return a mock success
    if (LEOPARDS_API_KEY === "" || LEOPARDS_API_KEY === "YOUR_API_KEY") {
        console.log(`[MOCK LEOPARDS] Booking shipment for Order ${data.orderId}`);
        return {
            status: 1,
            track_number: `LEO-${Math.floor(Math.random() * 1000000)}`,
            message: "Shipment booked successfully (Mock)"
        };
    }

    try {
        // Resolve city name to ID if needed
        let cityId = typeof data.city === 'number' ? data.city : await resolveCityToId(data.city);
        
        if (!cityId) {
            console.warn(`Could not resolve city ID for "${data.city}". Defaulting to Karachi (1).`);
            cityId = 1;
        }

        const payload = {
            api_key: LEOPARDS_API_KEY,
            api_password: LEOPARDS_API_PASSWORD,
            booked_packet_order_id: data.orderId,
            booked_packet_collect_amount: data.amount,
            booked_packet_weight: data.weight,
            booked_packet_no_piece: data.pieces || 1,
            origin_city: await resolveCityToId("Faisalabad") || 4, // Defaulting to Faisalabad (ID 4)
            destination_city: cityId,
            shipment_type: data.shipmentType || "overnight",
            consignment_name_eng: data.customerName,
            consignment_phone: data.customerPhone,
            consignment_address: data.customerAddress,
        };

        const response = await axios.post(`${LEOPARDS_API_URL}bookPacket/format/json/`, payload);
        return response.data;
    } catch (error: any) {
        throw new Error(`Leopards Booking Failed: ${error.message}`);
    }
};

export const trackLeopardsShipment = async (trackingNumber: string) => {
    // Refresh config from DB
    await fetchLeopardsConfig();

    // If credentials are mock, return mock tracking
    if (LEOPARDS_API_KEY === "" || LEOPARDS_API_KEY === "YOUR_API_KEY" || trackingNumber.startsWith("LEO-")) {
        console.log(`[MOCK LEOPARDS] Tracking shipment ${trackingNumber}`);
        return {
            status: 1,
            tracking_details: [
                { status: "Booked", time: new Date().toISOString() },
                { status: "In Transit", time: "Pending" },
                { status: "Out for Delivery", time: "Pending" },
                { status: "Delivered", time: "Pending" }
            ]
        };
    }

    try {
        const response = await axios.get(`${LEOPARDS_API_URL}trackBookedPacket/format/json/`, {
            params: {
                api_key: LEOPARDS_API_KEY,
                api_password: LEOPARDS_API_PASSWORD,
                track_numbers: trackingNumber
            }
        });

        return response.data;
    } catch (error: any) {
        throw new Error(`Leopards Tracking Failed: ${error.message}`);
    }
};

export const getLeopardsTariff = async (destinationCityId: number, weightInGrams: number, codAmount: number = 0) => {
    // Refresh config from DB
    const config = await fetchLeopardsConfig();

    // Use DB config values for origin/shipment type if available
    const originCity = config?.originCity || "4";
    const shipmentType = config?.shipmentType || "1";

    // If credentials are mock, return a mock tariff
    if (LEOPARDS_API_KEY === "" || LEOPARDS_API_KEY === "YOUR_API_KEY") {
        console.log(`[MOCK LEOPARDS] Calculating tariff for City ${destinationCityId}, Weight ${weightInGrams}g`);
        // Mock logic: Base 250 + 50 per additional kg
        const weightKg = weightInGrams / 1000;
        const mockRate = 250 + (Math.max(0, Math.ceil(weightKg - 1)) * 50);
        return {
            status: 1,
            tariff: mockRate,
            message: "Mock tariff success"
        };
    }

    try {
        const response = await axios.get(`${LEOPARDS_API_URL}getTariffDetails/format/json/`, {
            params: {
                api_key: LEOPARDS_API_KEY,
                api_password: LEOPARDS_API_PASSWORD,
                origin_city: originCity,
                destination_city: destinationCityId,
                shipment_type: shipmentType,
                packet_weight: weightInGrams / 1000, 
                cod_amount: codAmount
            }
        });
        
        // Leopards V2 returns charges inside a packet_charges object
        if (response.data && response.data.status == 1 && response.data.packet_charges) {
            const pc = response.data.packet_charges;
            // Sum up the relevant charges (they come as strings from Leopards)
            const totalTariff = 
                (parseFloat(pc.shipment_charges) || 0) + 
                (parseFloat(pc.gst_amount) || 0) + 
                (parseFloat(pc.fuel_surcharge_amount) || 0) +
                (parseFloat(pc.cash_handling) || 0);

            return {
                status: 1,
                tariff: totalTariff,
                message: response.data.message,
                details: pc // Keep details for debugging
            };
        }

        console.warn(`[LEOPARDS] Tariff API failed or keys invalid. Falling back to MOCK. Message:`, response.data?.error || response.data?.message);
        
        // Manual Mock Fallback
        const weightKg = weightInGrams / 1000;
        const mockRate = 250 + (Math.max(0, Math.ceil(weightKg - 1)) * 50);
        return {
            status: 1,
            tariff: mockRate,
            message: "Mock tariff fallback (Production keys required for live rates)"
        };
    } catch (error: any) {
        console.error("Leopards Tariff API Error:", error.message);
        // Even on network error, return mock so checkout doesn't break
        const weightKg = weightInGrams / 1000;
        const mockRate = 250 + (Math.max(0, Math.ceil(weightKg - 1)) * 50);
        return {
            status: 1,
            tariff: mockRate,
            message: "Mock tariff fallback (Connection failed)"
        };
    }
};

export const getLeopardsShipmentHistory = async (startDate?: string, endDate?: string) => {
    // Refresh config from DB
    await fetchLeopardsConfig();

    // If credentials are mock, return mock shipment list
    if (LEOPARDS_API_KEY === "" || LEOPARDS_API_KEY === "YOUR_API_KEY") {
        const dateRangeStr = startDate && endDate ? `${startDate} to ${endDate}` : "Full History";
        console.log(`[MOCK LEOPARDS] Fetching shipment history: ${dateRangeStr}`);
        return {
            status: 1,
            shipments: [
                { 
                    tracking_number: "LEO-123456", 
                    booked_packet_order_id: "EBED9F", 
                    booking_date: "2026-03-31", 
                    delivery_date: "2026-04-02",
                    consignment_name_eng: "Muhammad Baig",
                    origin_city: "Faisalabad",
                    destination_city: "Karachi",
                    booked_packet_status: "Delivered",
                    shipment_type: "Overnight",
                    cod_value: "1500"
                },
                { 
                    tracking_number: "LEO-789012", 
                    booked_packet_order_id: "69B2BA", 
                    booking_date: "2026-04-01", 
                    delivery_date: "",
                    consignment_name_eng: "Usman Ahmed",
                    origin_city: "Faisalabad",
                    destination_city: "Lahore",
                    booked_packet_status: "In Transit",
                    shipment_type: "Overnight",
                    cod_value: "2500"
                },
                { 
                    tracking_number: "LEO-345678", 
                    booked_packet_order_id: "7AC3D1", 
                    booking_date: "2026-04-05", 
                    delivery_date: "",
                    consignment_name_eng: "Ali Raza",
                    origin_city: "Faisalabad",
                    destination_city: "Islamabad",
                    booked_packet_status: "Booked",
                    shipment_type: "Overland",
                    cod_value: "0"
                }
            ]
        };
    }

    try {
        console.log(`[LEOPARDS] Fetching shipment history from: ${LEOPARDS_API_URL}getBookedPacketLastStatus/format/json/`);
        
        const params: any = {
            api_key: LEOPARDS_API_KEY,
            api_password: LEOPARDS_API_PASSWORD
        };

        // Provide default 30-day range if no dates are provided
        const today = new Date().toISOString().split('T')[0];
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        params.from_date = startDate || thirtyDaysAgo;
        params.to_date = endDate || today;

        console.log(`[LEOPARDS] Query Params: From ${params.from_date} To ${params.to_date}`);

        const response = await axios.get(`${LEOPARDS_API_URL}getBookedPacketLastStatus/format/json/`, {
            params
        });

        if (response.data && response.data.status == 1) {
            return {
                status: 1,
                shipments: response.data.packet_list || []
            };
        }

        console.error(`[LEOPARDS] API Error Response:`, response.data);

        return {
            status: 0,
            message: response.data?.error || response.data?.message || "Failed to fetch shipment history",
            shipments: []
        };
    } catch (error: any) {
        console.error("Leopards History error:", error.message);
        throw new Error(`Leopards History Failed: ${error.message}`);
    }
};




