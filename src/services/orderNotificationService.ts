import nodemailer from "nodemailer";
import { Sale } from "@prisma/client";

type SendOrderBookedEmailInput = {
  order: Sale;
  trackingNumber?: string | null;
};

type MailResult = {
  sent: boolean;
  reason?: string;
};

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, "");

const buildTrackingUrl = (order: Sale, cnNumber: string): string | null => {
  const template = process.env.ORDER_TRACKING_URL_TEMPLATE?.trim();
  if (template) {
    return template
      .replace("{orderId}", encodeURIComponent(order.id))
      .replace("{txnRefNo}", encodeURIComponent(order.txnRefNo || order.id))
      .replace("{cnNumber}", encodeURIComponent(cnNumber));
  }

  const frontBase = process.env.PUBLIC_MAIN_SITE_URL?.trim();
  if (frontBase) {
    return `${normalizeBaseUrl(frontBase)}/track-order?id=${encodeURIComponent(cnNumber)}`;
  }

  const apiBase = process.env.PUBLIC_API_BASE_URL?.trim();
  if (!apiBase) {
    return null;
  }

  const queryId = encodeURIComponent(cnNumber);
  return `${normalizeBaseUrl(apiBase)}/api/delivery/track/${queryId}`;
};

const buildOrderBookedHtml = (
  order: Sale,
  cnNumber: string,
  trackingUrl: string | null,
): string => {
  const safeOrderId = order.txnRefNo || order.id;
  const safeCustomerName = order.customerName || "Customer";

  return `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.5; color: #111827;">
      <h2 style="margin: 0 0 12px;">Your order is booked with Leopards</h2>
      <p style="margin: 0 0 12px;">Hi ${safeCustomerName},</p>
      <p style="margin: 0 0 16px;">
        Your order has been booked successfully. You can use the details below to track your shipment:
      </p>
      <table style="border-collapse: collapse; width: 100%; max-width: 480px; margin: 0 0 16px;">
        <tr>
          <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: 600;">Order ID</td>
          <td style="padding: 8px; border: 1px solid #e5e7eb;">${safeOrderId}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: 600;">CN Number</td>
          <td style="padding: 8px; border: 1px solid #e5e7eb;">${cnNumber}</td>
        </tr>
      </table>
      ${
        trackingUrl
          ? `<p style="margin: 0 0 16px;">
              Track your order here:
              <a href="${trackingUrl}" target="_blank" rel="noopener noreferrer">${trackingUrl}</a>
            </p>`
          : ""
      }
      <p style="margin: 0;">Thank you for shopping with us.</p>
    </div>
  `;
};

export const sendOrderBookedEmail = async ({
  order,
  trackingNumber,
}: SendOrderBookedEmailInput): Promise<MailResult> => {
  const toEmail = order.customerEmail?.trim();
  if (!toEmail) {
    return { sent: false, reason: "customer email missing" };
  }

  const cnNumber = (trackingNumber || order.trackingNumber || "").trim();
  if (!cnNumber) {
    return { sent: false, reason: "tracking number missing" };
  }

  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpPortRaw = process.env.SMTP_PORT?.trim() || "587";
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS?.trim();
  const smtpSecure = (process.env.SMTP_SECURE?.trim() || "").toLowerCase() === "true";
  const fromEmail =
    process.env.SMTP_FROM_EMAIL?.trim() ||
    process.env.ORDER_EMAIL_FROM?.trim();
  const fromName = process.env.SMTP_FROM_NAME?.trim() || "RKT Store";
  const replyTo = process.env.SMTP_REPLY_TO?.trim() || fromEmail;
  const smtpPort = Number(smtpPortRaw);

  if (!smtpHost) {
    console.warn(
      `Order booked email skipped for order ${order.id}: SMTP_HOST is not configured`,
    );
    return { sent: false, reason: "SMTP_HOST missing" };
  }

  if (!Number.isFinite(smtpPort)) {
    console.warn(
      `Order booked email skipped for order ${order.id}: SMTP_PORT is invalid`,
    );
    return { sent: false, reason: "SMTP_PORT invalid" };
  }

  if (!smtpUser || !smtpPass) {
    console.warn(
      `Order booked email skipped for order ${order.id}: SMTP_USER / SMTP_PASS is not configured`,
    );
    return { sent: false, reason: "SMTP credentials missing" };
  }

  if (!fromEmail) {
    console.warn(
      `Order booked email skipped for order ${order.id}: SMTP_FROM_EMAIL is not configured`,
    );
    return { sent: false, reason: "SMTP_FROM_EMAIL missing" };
  }

  const trackingUrl = buildTrackingUrl(order, cnNumber);
  const subject = `Order booked: ${order.txnRefNo || order.id} | CN ${cnNumber}`;
  const text = [
    `Your order has been booked with Leopards.`,
    `Order ID: ${order.txnRefNo || order.id}`,
    `CN Number: ${cnNumber}`,
    trackingUrl ? `Track Order: ${trackingUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure || smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: toEmail,
    replyTo,
    subject,
    text,
    html: buildOrderBookedHtml(order, cnNumber, trackingUrl),
    headers: {
      "X-Auto-Response-Suppress": "All",
      "X-Entity-Ref-ID": `${order.id}-${cnNumber}`,
    },
  });

  return { sent: true };
};
