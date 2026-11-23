// Codes the till scanner can read on a product: its SKU, the barcode printed on
// its packaging, and the same two fields on each variant. The admin Billing desk
// compares codes after `normalizeProductCode`, so uniqueness is checked the same way.

/** Lower-case, letters and digits only, without a leading "sku". "SKU-1001" -> "1001". */
export const normalizeProductCode = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/^sku/, "");
};

/** Trimmed barcode, or null when blank. */
export const cleanBarcode = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export interface RequestedBarcode {
  /** The barcode as entered. */
  code: string;
  /** Where it was entered, for the error message, e.g. `variant "Red / XL"`. */
  owner: string;
}

export interface ProductCodeRecord {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  variants?: unknown;
}

const variantCodes = (variants: unknown): string[] => {
  if (!Array.isArray(variants)) {
    return [];
  }
  const codes: string[] = [];
  for (const entry of variants) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const row = entry as Record<string, unknown>;
    codes.push(normalizeProductCode(row.sku), normalizeProductCode(row.barcode));
  }
  return codes;
};

/**
 * Barcodes on one product (and its variants) taken from a create/update payload.
 * `variants` is only read when it is an array, i.e. when the payload sets it.
 */
export const collectRequestedBarcodes = (
  barcode: unknown,
  variants: unknown,
): RequestedBarcode[] => {
  const requested: RequestedBarcode[] = [];
  const itemBarcode = cleanBarcode(barcode);
  if (itemBarcode) {
    requested.push({ code: itemBarcode, owner: "this product" });
  }
  if (Array.isArray(variants)) {
    variants.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return;
      }
      const row = entry as Record<string, unknown>;
      const variantBarcode = cleanBarcode(row.barcode);
      if (!variantBarcode) {
        return;
      }
      const label =
        typeof row.label === "string" && row.label.trim()
          ? row.label.trim()
          : `Option ${index + 1}`;
      requested.push({ code: variantBarcode, owner: `variant "${label}"` });
    });
  }
  return requested;
};

/**
 * Returns a message when a requested barcode is used twice on the same product
 * or already belongs to another product (as its SKU or barcode, or a variant's).
 * Returns null when every barcode is free.
 */
export const findBarcodeConflict = (
  requested: RequestedBarcode[],
  otherProducts: ProductCodeRecord[],
): string | null => {
  const seen = new Map<string, RequestedBarcode>();
  for (const entry of requested) {
    const key = normalizeProductCode(entry.code);
    if (!key) {
      continue;
    }
    const earlier = seen.get(key);
    if (earlier) {
      return `Barcode ${entry.code} is entered on both ${earlier.owner} and ${entry.owner}. Each barcode can only be used once.`;
    }
    seen.set(key, entry);
  }

  if (seen.size === 0) {
    return null;
  }

  for (const product of otherProducts) {
    const codes = new Set(
      [
        normalizeProductCode(product.sku),
        normalizeProductCode(product.barcode),
        ...variantCodes(product.variants),
      ].filter(Boolean),
    );
    for (const [key, entry] of seen) {
      if (codes.has(key)) {
        return `Barcode ${entry.code} (${entry.owner}) is already used by "${product.name}". Each barcode can only belong to one product.`;
      }
    }
  }

  return null;
};
