import {
  describeStockShortfalls,
  groupSaleLinesByItem,
  planStockDeduction,
} from "../utils/saleStock";

const shirt = {
  id: "shirt",
  name: "Shirt",
  quantity: 6,
  variants: [
    { id: "s", label: "Small", quantity: 1 },
    { id: "l", label: "Large", quantity: 5 },
  ],
};

const cap = { id: "cap", name: "Cap", quantity: 3, variants: [] };

describe("groupSaleLinesByItem", () => {
  it("adds up lines of the same product and variant", () => {
    const needs = groupSaleLinesByItem([
      { itemId: "shirt", variantId: "l", name: "Shirt (Large)", quantity: 2 },
      { itemId: "shirt", variantId: "l", quantity: 1 },
      { itemId: "shirt", variantId: "s", quantity: 1 },
      { itemId: "cap", quantity: 2 },
    ]);

    expect(needs.get("shirt")?.total).toBe(4);
    expect(needs.get("shirt")?.byVariant.get("l")).toBe(3);
    expect(needs.get("shirt")?.byVariant.get("s")).toBe(1);
    expect(needs.get("shirt")?.lineName).toBe("Shirt (Large)");
    expect(needs.get("cap")?.withoutVariant).toBe(2);
  });

  it("ignores lines without a product or a positive quantity", () => {
    const needs = groupSaleLinesByItem([
      { itemId: "", quantity: 2 },
      { itemId: "cap", quantity: 0 },
      { itemId: "cap", quantity: -1 },
    ]);
    expect(needs.size).toBe(0);
  });
});

describe("planStockDeduction", () => {
  it("takes a product's units off its stock", () => {
    const plan = planStockDeduction(cap, groupSaleLinesByItem([{ itemId: "cap", quantity: 2 }]).get("cap")!);
    expect(plan).toEqual({ quantity: 1, variants: undefined, shortfalls: [] });
  });

  it("takes a variant's units off that variant and makes the product the sum of its variants", () => {
    const plan = planStockDeduction(
      shirt,
      groupSaleLinesByItem([{ itemId: "shirt", variantId: "l", quantity: 2 }]).get("shirt")!,
    );
    expect(plan.shortfalls).toEqual([]);
    expect(plan.variants).toEqual([
      { id: "s", label: "Small", quantity: 1 },
      { id: "l", label: "Large", quantity: 3 },
    ]);
    expect(plan.quantity).toBe(4);
  });

  it("reports a variant the stock can't cover and leaves it at zero", () => {
    const plan = planStockDeduction(
      shirt,
      groupSaleLinesByItem([{ itemId: "shirt", variantId: "s", quantity: 3 }]).get("shirt")!,
    );
    expect(plan.shortfalls).toEqual([
      { itemId: "shirt", variantId: "s", name: "Shirt (Small)", available: 1, requested: 3 },
    ]);
    expect(plan.variants?.[0]).toEqual({ id: "s", label: "Small", quantity: 0 });
    // The product total stays the real sum (0 + 5), not 6 - 3.
    expect(plan.quantity).toBe(5);
  });

  it("reports a product the stock can't cover and leaves it at zero", () => {
    const plan = planStockDeduction(cap, groupSaleLinesByItem([{ itemId: "cap", quantity: 5 }]).get("cap")!);
    expect(plan.shortfalls).toEqual([{ itemId: "cap", name: "Cap", available: 3, requested: 5 }]);
    expect(plan.quantity).toBe(0);
  });

  it("counts a line for a variant the product no longer has against the product", () => {
    const plan = planStockDeduction(
      shirt,
      groupSaleLinesByItem([{ itemId: "shirt", variantId: "gone", quantity: 2 }]).get("shirt")!,
    );
    expect(plan.variants).toBeUndefined();
    expect(plan.quantity).toBe(4);
    expect(plan.shortfalls).toEqual([]);
  });

  it("treats missing or broken stock numbers as zero", () => {
    const plan = planStockDeduction(
      { id: "x", name: "X", quantity: Number.NaN, variants: null },
      groupSaleLinesByItem([{ itemId: "x", quantity: 1 }]).get("x")!,
    );
    expect(plan.shortfalls).toEqual([{ itemId: "x", name: "X", available: 0, requested: 1 }]);
    expect(plan.quantity).toBe(0);
  });
});

describe("describeStockShortfalls", () => {
  it("names each short line", () => {
    expect(
      describeStockShortfalls([
        { itemId: "shirt", variantId: "s", name: "Shirt (Small)", available: 0, requested: 1 },
        { itemId: "cap", name: "Cap", available: 1, requested: 3 },
        { itemId: "hat", name: "Hat", available: 2, requested: 3 },
      ]),
    ).toBe(
      "Shirt (Small) is out of stock. Only 1 unit of Cap left (3 requested). Only 2 units of Hat left (3 requested).",
    );
  });
});
