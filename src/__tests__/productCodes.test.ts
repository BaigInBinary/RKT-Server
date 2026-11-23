import {
  cleanBarcode,
  collectRequestedBarcodes,
  findBarcodeConflict,
  normalizeProductCode,
} from "../utils/productCodes";

describe("normalizeProductCode", () => {
  it("ignores case, symbols and a leading SKU", () => {
    expect(normalizeProductCode("SKU-1001")).toBe("1001");
    expect(normalizeProductCode(" sku 1001 ")).toBe("1001");
    expect(normalizeProductCode("8901-2345")).toBe("89012345");
    expect(normalizeProductCode(null)).toBe("");
  });
});

describe("cleanBarcode", () => {
  it("trims and turns blanks into null", () => {
    expect(cleanBarcode(" 8901234567890 ")).toBe("8901234567890");
    expect(cleanBarcode("   ")).toBeNull();
    expect(cleanBarcode(undefined)).toBeNull();
  });
});

describe("collectRequestedBarcodes", () => {
  it("reads the product barcode and each variant barcode", () => {
    expect(
      collectRequestedBarcodes("111", [
        { label: "Red", barcode: " 222 " },
        { label: "Blue", barcode: "" },
        { barcode: "333" },
      ]),
    ).toEqual([
      { code: "111", owner: "this product" },
      { code: "222", owner: 'variant "Red"' },
      { code: "333", owner: 'variant "Option 3"' },
    ]);
  });

  it("skips variants when the payload does not set them", () => {
    expect(collectRequestedBarcodes(null, undefined)).toEqual([]);
  });
});

describe("findBarcodeConflict", () => {
  const otherProducts = [
    { id: "a", name: "Mug", sku: "1001", barcode: "8901234567890", variants: null },
    {
      id: "b",
      name: "T-Shirt",
      sku: "2002",
      barcode: null,
      variants: [{ label: "Red / M", sku: "TS-RED-M", barcode: "5000000000001" }],
    },
  ];

  it("allows barcodes nobody else uses", () => {
    expect(
      findBarcodeConflict([{ code: "4006381333931", owner: "this product" }], otherProducts),
    ).toBeNull();
  });

  it("rejects another product's barcode", () => {
    expect(
      findBarcodeConflict([{ code: "8901234567890", owner: "this product" }], otherProducts),
    ).toContain('already used by "Mug"');
  });

  it("rejects another product's SKU, compared the way the scanner compares", () => {
    expect(
      findBarcodeConflict([{ code: "SKU-1001", owner: "this product" }], otherProducts),
    ).toContain('"Mug"');
  });

  it("rejects another product's variant SKU or barcode", () => {
    expect(
      findBarcodeConflict([{ code: "ts-red-m", owner: 'variant "Large"' }], otherProducts),
    ).toContain('"T-Shirt"');
    expect(
      findBarcodeConflict([{ code: "5000000000001", owner: "this product" }], otherProducts),
    ).toContain('"T-Shirt"');
  });

  it("rejects the same barcode twice on one product", () => {
    expect(
      findBarcodeConflict(
        [
          { code: "777", owner: 'variant "Red"' },
          { code: "777", owner: 'variant "Blue"' },
        ],
        [],
      ),
    ).toContain('variant "Red" and variant "Blue"');
  });
});
