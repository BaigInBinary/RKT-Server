import axios from "axios";

const LEOPARDS_API_KEY = process.env.LEOPARDS_API_KEY || "";
const LEOPARDS_API_PASSWORD = process.env.LEOPARDS_API_KEY || "";
const LEOPARDS_API_URL = process.env.LEOPARDS_API_KEY || "";

export interface LeopardsBookingData {
    orderId: string;
    customerName: string;
    customerPhone: string;
    customerAddress: string;
    city: string;
    amount: number;
    weight: number;
}

export const bookLeopardsShipment = async (data: LeopardsBookingData) => {
    // If credentials are mock, return a mock success
    if (LEOPARDS_API_KEY === "") {
        console.log(`[MOCK LEOPARDS] Booking shipment for Order ${data.orderId}`);
        return {
            status: 1,
            track_number: `LEO-${Math.floor(Math.random() * 1000000)}`,
            message: "Shipment booked successfully (Mock)"
        };
    }

    try {
        const response = await axios.post(`${LEOPARDS_API_URL}/book_packet`, {
            api_key: LEOPARDS_API_KEY,
            api_password: LEOPARDS_API_PASSWORD,
            order_id: data.orderId,
            customer_name: data.customerName,
            customer_phone: data.customerPhone,
            customer_address: data.customerAddress,
            destination_city: data.city,
            amount: data.amount,
            weight: data.weight,
        });

        return response.data;
    } catch (error: any) {
        throw new Error(`Leopards Booking Failed: ${error.message}`);
    }
};

export const trackLeopardsShipment = async (trackingNumber: string) => {
    // If credentials are mock, return mock tracking
    if (LEOPARDS_API_KEY === "" || trackingNumber.startsWith("LEO-")) {
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
        const response = await axios.get(`${LEOPARDS_API_URL}/track_packet`, {
            params: {
                api_key: LEOPARDS_API_KEY,
                api_password: LEOPARDS_API_PASSWORD,
                track_number: trackingNumber
            }
        });

        return response.data;
    } catch (error: any) {
        throw new Error(`Leopards Tracking Failed: ${error.message}`);
    }
};
