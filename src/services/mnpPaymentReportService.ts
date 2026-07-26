/**
 * M&P IBFT payment report ingestion + reconciliation.
 *
 * The uploaded file is the spreadsheet/HTML export of M&P's `Reports/Payment_Report`
 * endpoint. Unlike a Leopards cheque — one payment per file, with the individual CN
 * numbers printed on it — an IBFT report holds many payout rows and carries no
 * consignment numbers at all, so shipments are linked afterwards by matching each
 * shipment's PaymentID (read back from M&P tracking) against these rows.
 */

export interface MnpPaymentRowInput {
  paymentId?: string | null;
  paidOn?: string | null;
  rrAmount?: number | string | null;
  invoiceAmount?: number | string | null;
  ibftFee?: number | string | null;
  taxAmount?: number | string | null;
  netPayable?: number | string | null;
  instrumentMode?: string | null;
  instrumentNumber?: string | null;
}

export interface NormalizedMnpPaymentRow {
  paymentId: string;
  paidOn: string | null;
  paidOnValue: Date | null;
  rrAmount: number;
  invoiceAmount: number;
  ibftFee: number;
  taxAmount: number;
  netPayable: number;
  instrumentMode: string | null;
  instrumentNumber: string | null;
}

/** Tolerance for float comparison on money values. */
const AMOUNT_EPSILON = 0.01;

export const parseReportAmount = (value: unknown): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const cleaned = String(value ?? "")
    .replace(/rs\.?/gi, "")
    .replace(/pkr/gi, "")
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Payment dates arrive either ISO (`2026-07-04`, straight from the API export) or
 * day-first (`04/07/2026`, from a hand-saved spreadsheet). Anything else is stored
 * as text only so an odd format never silently becomes the wrong date.
 */
export const parseReportDate = (value?: string | null): Date | null => {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const parsed = new Date(
      Number(isoMatch[1]),
      Number(isoMatch[2]) - 1,
      Number(isoMatch[3]),
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const dayFirstMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (dayFirstMatch) {
    const rawYear = Number(dayFirstMatch[3]);
    const parsed = new Date(
      rawYear < 100 ? 2000 + rawYear : rawYear,
      Number(dayFirstMatch[2]) - 1,
      Number(dayFirstMatch[1]),
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const direct = new Date(text);
  return Number.isNaN(direct.getTime()) ? null : direct;
};

export const normalizePaymentRows = (rows: MnpPaymentRowInput[]): NormalizedMnpPaymentRow[] => {
  const normalized: NormalizedMnpPaymentRow[] = [];
  const seen = new Set<string>();

  for (const row of rows || []) {
    const paymentId = String(row?.paymentId ?? "").trim();
    if (!paymentId || seen.has(paymentId)) {
      continue;
    }
    seen.add(paymentId);

    const paidOn = String(row?.paidOn ?? "").trim() || null;

    normalized.push({
      paymentId,
      paidOn,
      paidOnValue: parseReportDate(paidOn),
      rrAmount: parseReportAmount(row?.rrAmount),
      invoiceAmount: parseReportAmount(row?.invoiceAmount),
      ibftFee: parseReportAmount(row?.ibftFee),
      taxAmount: parseReportAmount(row?.taxAmount),
      netPayable: parseReportAmount(row?.netPayable),
      instrumentMode: String(row?.instrumentMode ?? "").trim() || null,
      instrumentNumber: String(row?.instrumentNumber ?? "").trim() || null,
    });
  }

  return normalized;
};

export interface MnpPaymentRowCheck {
  paymentId: string;
  paidOn: string | null;
  rrAmount: number;
  invoiceAmount: number;
  ibftFee: number;
  taxAmount: number;
  netPayable: number;
  instrumentMode: string | null;
  instrumentNumber: string | null;
  /** RR Amount − Invoice Amount − Tax Amount, the formula M&P's own reports follow. */
  expectedNetPayable: number;
  difference: number;
  isMismatch: boolean;
  /**
   * True when the only gap is the IBFT fee — i.e. that report deducted the transfer
   * fee separately instead of folding it into the invoice amount. Worth surfacing,
   * but not an error the merchant should chase M&P about.
   */
  isIbftFeeDeductedSeparately: boolean;
}

export interface MnpPaymentReportAnalysis {
  rows: MnpPaymentRowCheck[];
  totals: {
    rrAmount: number;
    invoiceAmount: number;
    ibftFee: number;
    taxAmount: number;
    netPayable: number;
    expectedNetPayable: number;
    difference: number;
  };
  mismatchCount: number;
  ibftFeeDeductedCount: number;
}

/**
 * Reconciles every payout row.
 *
 * M&P settles COD as: money collected from customers (RR Amount) minus their
 * courier invoice for the period, minus withholding tax. The IBFT transfer fee is
 * already inside the invoice amount on the reports we've seen, so deducting it
 * again would understate the payout by exactly the fee — which is why that case is
 * reported distinctly from a genuine arithmetic mismatch.
 */
export const analysePaymentRows = (
  rows: NormalizedMnpPaymentRow[],
): MnpPaymentReportAnalysis => {
  const checked: MnpPaymentRowCheck[] = (rows || []).map((row) => {
    const expectedNetPayable = row.rrAmount - row.invoiceAmount - row.taxAmount;
    const difference = row.netPayable - expectedNetPayable;
    const isMismatch = Math.abs(difference) > AMOUNT_EPSILON;
    const isIbftFeeDeductedSeparately =
      isMismatch && row.ibftFee > 0 && Math.abs(difference + row.ibftFee) <= AMOUNT_EPSILON;

    return {
      paymentId: row.paymentId,
      paidOn: row.paidOn,
      rrAmount: row.rrAmount,
      invoiceAmount: row.invoiceAmount,
      ibftFee: row.ibftFee,
      taxAmount: row.taxAmount,
      netPayable: row.netPayable,
      instrumentMode: row.instrumentMode ?? null,
      instrumentNumber: row.instrumentNumber ?? null,
      expectedNetPayable,
      difference,
      isMismatch,
      isIbftFeeDeductedSeparately,
    };
  });

  const totals = checked.reduce(
    (acc, row) => ({
      rrAmount: acc.rrAmount + row.rrAmount,
      invoiceAmount: acc.invoiceAmount + row.invoiceAmount,
      ibftFee: acc.ibftFee + row.ibftFee,
      taxAmount: acc.taxAmount + row.taxAmount,
      netPayable: acc.netPayable + row.netPayable,
      expectedNetPayable: acc.expectedNetPayable + row.expectedNetPayable,
      difference: acc.difference + row.difference,
    }),
    {
      rrAmount: 0,
      invoiceAmount: 0,
      ibftFee: 0,
      taxAmount: 0,
      netPayable: 0,
      expectedNetPayable: 0,
      difference: 0,
    },
  );

  return {
    rows: checked,
    totals,
    mismatchCount: checked.filter((row) => row.isMismatch && !row.isIbftFeeDeductedSeparately).length,
    ibftFeeDeductedCount: checked.filter((row) => row.isIbftFeeDeductedSeparately).length,
  };
};

/** Pulls a PaymentID out of whatever shape M&P's tracking payload arrives in. */
export const extractPaymentIdFromTracking = (shipment: any): string => {
  const candidates = [
    shipment?.PaymentID,
    shipment?.PaymentId,
    shipment?.payment_id,
    shipment?.PaymentNo,
    shipment?.PaymentNumber,
  ];

  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (value) return value;
  }

  return "";
};
