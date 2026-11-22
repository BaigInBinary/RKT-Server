import { validateSalePayload } from "../utils/saleValidation";

// What the admin Billing desk sends: no delivery or contact details.
const inStoreSale = (paymentMethod: string, paymentStatus = "paid") => ({
  items: [{ itemId: "item-1", name: "Mug", price: 1000, quantity: 1, total: 1000 }],
  subtotal: 1000,
  tax: 50,
  discount: 0,
  total: 1050,
  customerName: "Walk-in customer",
  paymentMethod,
  paymentStatus,
});

// What the storefront checkout sends.
const websiteOrder = (overrides: Record<string, unknown> = {}) => ({
  items: [{ itemId: "item-1", name: "Mug", price: 1000, quantity: 1, total: 1000 }],
  subtotal: 1000,
  tax: 0,
  discount: 0,
  total: 1200,
  customerName: "Online Customer",
  customerEmail: "customer@example.com",
  customerPhone: "03001234567",
  shippingAddress: "House 1, Street 2",
  city: "Lahore",
  paymentMethod: "COD",
  paymentStatus: "PENDING",
  deliveryCharge: 200,
  ...overrides,
});

const admin = { isAdminPortalRequest: true };
const storefront = { isAdminPortalRequest: false };

describe("validateSalePayload", () => {
  describe("in-store sales from the admin portal", () => {
    it.each(["COD", "PREPAID", "LOAN"])(
      "accepts a %s sale without email, phone or address",
      (paymentMethod) => {
        expect(validateSalePayload(inStoreSale(paymentMethod), admin)).toBeNull();
      },
    );

    it("still requires contact details when an address is given", () => {
      const sale = { ...inStoreSale("COD"), shippingAddress: "House 1" };
      expect(validateSalePayload(sale, admin)).toContain("customerEmail");
    });

    it("keeps website-order rules when editing a website order", () => {
      const edit = inStoreSale("COD", "pending");
      expect(
        validateSalePayload(edit, { ...admin, isExistingWebsiteOrder: true }),
      ).toContain("customerEmail");
    });
  });

  describe("storefront requests", () => {
    it("accepts a complete website order", () => {
      expect(validateSalePayload(websiteOrder(), storefront)).toBeNull();
    });

    it.each(["COD", "PREPAID", "BANK_DEPOSIT"])(
      "rejects a %s order with no contact details even without an address",
      (paymentMethod) => {
        expect(validateSalePayload(inStoreSale(paymentMethod), storefront)).toContain(
          "customerEmail",
        );
      },
    );

    it("rejects non-Pakistan phone numbers", () => {
      expect(
        validateSalePayload(websiteOrder({ customerPhone: "1234567890" }), storefront),
      ).toContain("Pakistan phone number");
    });

    it("requires a bank receipt for bank deposit orders", () => {
      expect(
        validateSalePayload(websiteOrder({ paymentMethod: "BANK_DEPOSIT" }), storefront),
      ).toContain("bankReceiptUrl");
    });
  });

  it("rejects malformed line items regardless of channel", () => {
    const sale = { ...inStoreSale("COD"), items: [{ itemId: "item-1", name: "Mug", price: 1000, quantity: 0, total: 0 }] };
    expect(validateSalePayload(sale, admin)).toContain("quantity");
  });
});
