// How a sale changes a product's stock, and which lines the stock can't cover.
// A product with variants keeps its stock on the variants and its own quantity
// is their sum (the admin product form saves it that way); a product without
// variants keeps it on the product.

export type SaleLineForStock = {
  itemId: string;
  variantId?: string | null;
  name?: string;
  quantity: number;
};

export type StockNeed = {
  /** Units of the product in the sale, across all its lines. */
  total: number;
  /** Units per variant id, for lines that name a variant. */
  byVariant: Map<string, number>;
  /** Units on lines that name no variant. */
  withoutVariant: number;
  /** Name from the sale line, for messages when the product no longer exists. */
  lineName: string;
};

export type ItemForStock = {
  id: string;
  name: string;
  quantity: number;
  variants?: unknown;
};

export type StockShortfall = {
  itemId: string;
  variantId?: string;
  /** "Shirt" or "Shirt (Large)". */
  name: string;
  available: number;
  requested: number;
};

export type StockDeduction = {
  quantity: number;
  /** The product's variants after the sale; absent when the sale sold no variant of it. */
  variants?: unknown[];
  shortfalls: StockShortfall[];
};

const toStock = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
};

const toUnits = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const variantIdOf = (row: Record<string, unknown>) => (typeof row.id === "string" ? row.id.trim() : "");

const variantLabelOf = (row: Record<string, unknown>) => {
  const label = typeof row.label === "string" ? row.label.trim() : "";
  if (label) {
    return label;
  }
  const parts = [row.size, row.color].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(" / ") : variantIdOf(row);
};

/** Groups a sale's lines by product. */
export const groupSaleLinesByItem = (lines: SaleLineForStock[]): Map<string, StockNeed> => {
  const needs = new Map<string, StockNeed>();
  for (const line of lines) {
    const itemId = String(line.itemId || "").trim();
    const units = toUnits(line.quantity);
    if (!itemId || units === 0) {
      continue;
    }

    const need = needs.get(itemId) ?? {
      total: 0,
      byVariant: new Map<string, number>(),
      withoutVariant: 0,
      lineName: typeof line.name === "string" ? line.name : "",
    };
    need.total += units;
    const variantId = String(line.variantId || "").trim();
    if (variantId) {
      need.byVariant.set(variantId, (need.byVariant.get(variantId) || 0) + units);
    } else {
      need.withoutVariant += units;
    }
    needs.set(itemId, need);
  }
  return needs;
};

/**
 * The product's stock after selling `need`, never below zero, and every line
 * the stock could not cover. The caller decides whether a shortfall stops the sale.
 */
export const planStockDeduction = (item: ItemForStock, need: StockNeed): StockDeduction => {
  const rows = Array.isArray(item.variants) ? item.variants : [];
  const knownVariantIds = new Set(
    rows.map((row) => asRecord(row)).filter((row): row is Record<string, unknown> => !!row).map(variantIdOf),
  );
  knownVariantIds.delete("");

  // A line naming a variant the product no longer has is taken from the product itself.
  const variantNeed = new Map<string, number>();
  let productNeed = need.withoutVariant;
  for (const [variantId, units] of need.byVariant.entries()) {
    if (knownVariantIds.has(variantId)) {
      variantNeed.set(variantId, units);
    } else {
      productNeed += units;
    }
  }

  const shortfalls: StockShortfall[] = [];
  let variants: unknown[] | undefined;
  if (variantNeed.size > 0) {
    variants = rows.map((entry) => {
      const row = asRecord(entry);
      if (!row) {
        return entry;
      }
      const variantId = variantIdOf(row);
      const units = variantNeed.get(variantId);
      if (!units) {
        return entry;
      }
      const available = toStock(row.quantity);
      if (available < units) {
        shortfalls.push({
          itemId: item.id,
          variantId,
          name: `${item.name} (${variantLabelOf(row)})`,
          available,
          requested: units,
        });
      }
      return { ...row, quantity: Math.max(0, available - units) };
    });
  }

  const available = toStock(item.quantity);
  if (variants && productNeed === 0) {
    const quantity = variants.reduce<number>((sum, entry) => {
      const row = asRecord(entry);
      return row ? sum + toStock(row.quantity) : sum;
    }, 0);
    return { quantity, variants, shortfalls };
  }

  if (available < need.total) {
    shortfalls.push({ itemId: item.id, name: item.name, available, requested: need.total });
  }
  return { quantity: Math.max(0, available - need.total), variants, shortfalls };
};

const unitWord = (count: number) => (count === 1 ? "unit" : "units");

/** "Shirt (Large) is out of stock. Only 2 units of Cap left (3 requested)." */
export const describeStockShortfalls = (shortfalls: StockShortfall[]) =>
  shortfalls
    .map((shortfall) =>
      shortfall.available === 0
        ? `${shortfall.name} is out of stock.`
        : `Only ${shortfall.available} ${unitWord(shortfall.available)} of ${shortfall.name} left (${shortfall.requested} requested).`,
    )
    .join(" ");
