const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAKISTAN_PHONE_PATTERN = /^(?:03\d{9}|\+?923\d{9})$/;
const ONLINE_PAYMENT_METHODS = new Set(["COD", "PREPAID", "BANK_DEPOSIT"]);

const validateSaleItems = (items: unknown): string | null => {
  if (!Array.isArray(items)) {
    return "`items` must be an array.";
  }

  if (items.length === 0) {
    return "`items` must contain at least one item.";
  }

  for (let index = 0; index < items.length; index += 1) {
    const entry = items[index];
    if (!entry || typeof entry !== "object") {
      return `items[${index}] must be an object.`;
    }

    const item = entry as Record<string, unknown>;
    const itemId = typeof item.itemId === "string" ? item.itemId.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const variantId =
      item.variantId === undefined || item.variantId === null
        ? ""
        : typeof item.variantId === "string"
          ? item.variantId.trim()
          : null;
    const variantLabel =
      item.variantLabel === undefined || item.variantLabel === null
        ? ""
        : typeof item.variantLabel === "string"
          ? item.variantLabel.trim()
          : null;
    const image =
      item.image === undefined || item.image === null
        ? ""
        : typeof item.image === "string"
          ? item.image.trim()
          : null;

    if (!itemId) {
      return `items[${index}].itemId is required.`;
    }

    if (variantId === null) {
      return `items[${index}].variantId must be a string when provided.`;
    }
    if (variantLabel === null) {
      return `items[${index}].variantLabel must be a string when provided.`;
    }
    if (image === null) {
      return `items[${index}].image must be a string when provided.`;
    }

    if (!name) {
      return `items[${index}].name is required.`;
    }

    if (!isFiniteNumber(item.price) || item.price < 0) {
      return `items[${index}].price must be a valid number >= 0.`;
    }

    if (!isFiniteNumber(item.quantity) || item.quantity <= 0) {
      return `items[${index}].quantity must be a valid number > 0.`;
    }

    if (!isFiniteNumber(item.total) || item.total < 0) {
      return `items[${index}].total must be a valid number >= 0.`;
    }
  }

  return null;
};

export interface SaleValidationContext {
  /**
   * The request comes from an admin-portal user (the in-store Billing desk or
   * Sales Tracking). Those sales are paid for at the counter, so "COD" (cash)
   * and "PREPAID" (online transfer) on their own do not make them website
   * orders that need delivery contact details.
   */
  isAdminPortalRequest: boolean;
  /** The sale being edited was a website order (it has a shipping address). */
  isExistingWebsiteOrder?: boolean;
}

export const validateSalePayload = (
  payload: unknown,
  context: SaleValidationContext,
): string | null => {
  if (!payload || typeof payload !== "object") {
    return "Invalid request body.";
  }

  const body = payload as Record<string, unknown>;
  const itemsError = validateSaleItems(body.items);
  if (itemsError) {
    return itemsError;
  }

  const numberFields = ["subtotal", "tax", "discount", "total"] as const;
  for (const field of numberFields) {
    if (!isFiniteNumber(body[field])) {
      return `\`${field}\` must be a valid number.`;
    }
  }

  const paymentMethod =
    typeof body.paymentMethod === "string" ? body.paymentMethod.trim().toUpperCase() : "";
  const shippingAddress =
    typeof body.shippingAddress === "string" ? body.shippingAddress.trim() : "";
  const city = typeof body.city === "string" ? body.city.trim() : "";
  const customerEmail =
    typeof body.customerEmail === "string" ? body.customerEmail.trim() : "";
  const customerPhone =
    typeof body.customerPhone === "string" ? body.customerPhone.trim() : "";

  // A website order is one that has to be delivered. Storefront checkouts are
  // also recognised by their payment method, so a checkout that arrives without
  // an address is still held to the delivery rules.
  const isOnlineOrder =
    !!shippingAddress ||
    !!city ||
    !!context.isExistingWebsiteOrder ||
    (!context.isAdminPortalRequest && ONLINE_PAYMENT_METHODS.has(paymentMethod));

  if (isOnlineOrder) {
    if (!customerEmail || !EMAIL_PATTERN.test(customerEmail)) {
      return "`customerEmail` is required and must be a valid email address.";
    }
    if (!PAKISTAN_PHONE_PATTERN.test(customerPhone)) {
      return "`customerPhone` is required and must be a valid Pakistan phone number, e.g. 03329777119, 923329777119, or +923329777119.";
    }
  }

  if (paymentMethod === "BANK_DEPOSIT") {
    const bankReceiptUrl =
      typeof body.bankReceiptUrl === "string" ? body.bankReceiptUrl.trim() : "";
    if (!bankReceiptUrl) {
      return "`bankReceiptUrl` is required for bank deposit orders.";
    }
  }

  return null;
};
