import nodemailer from "nodemailer";
import { Sale } from "@prisma/client";

type SendOrderBookedEmailInput = {
  order: Sale;
  trackingNumber?: string | null;
  leopardsOrderId?: string | null;
  bookingOrderId?: string | null;
  courierName?: string | null;
};

type MailResult = {
  sent: boolean;
  reason?: string;
};

type SmtpMailContext = {
  transporter: ReturnType<typeof nodemailer.createTransport>;
  fromEmail: string;
  fromName: string;
  replyTo: string;
};

const SUPPORT_EMAIL = "rktradershop@gmail.com";

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, "");

const resolveOrderIdForCustomerEmail = (
  order: Sale,
  bookingOrderId?: string | null,
): string => {
  const preferred = (bookingOrderId || "").trim();
  if (preferred) {
    return preferred;
  }

  const bookingId = (order.bookingId || "").trim();
  if (bookingId) {
    return bookingId;
  }

  const internalOrderId = (order.id || "").trim();
  if (internalOrderId) {
    return internalOrderId;
  }

  return (order.txnRefNo || order.id).trim();
};

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
    return `${normalizeBaseUrl(frontBase)}/track-order?id=${encodeURIComponent(order.id)}`;
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
  orderIdForEmail: string,
  cnNumber: string,
  trackingUrl: string | null,
  courierName: string,
): string => {
  const safeCustomerName = order.customerName || "Customer";

  return `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.5; color: #111827;">
      <h2 style="margin: 0 0 12px;">Your order is booked with ${courierName}</h2>
      <p style="margin: 0 0 12px;">Hi ${safeCustomerName},</p>
      <p style="margin: 0 0 16px;">
        Your order has been booked successfully. You can use the details below to track your shipment:
      </p>
      <table style="border-collapse: collapse; width: 100%; max-width: 480px; margin: 0 0 16px;">
        <tr>
          <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: 600;">Order ID</td>
          <td style="padding: 8px; border: 1px solid #e5e7eb;">${orderIdForEmail}</td>
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
      <p style="margin: 0 0 16px;">
        For any help, contact us at
        <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.
      </p>
      <p style="margin: 0;">Thank you for shopping with us.</p>
    </div>
  `;
};

const buildOrderCancelledHtml = (order: Sale): string => {
  const safeCustomerName = order.customerName || "Customer";

  return `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.5; color: #111827;">
      <h2 style="margin: 0 0 12px;">Your order has been cancelled</h2>
      <p style="margin: 0 0 12px;">Hi ${safeCustomerName},</p>
      <p style="margin: 0 0 16px;">
        Your order has been marked as cancelled by our team.
      </p>
      <p style="margin: 0;">
        If you need help, contact us at
        <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.
      </p>
    </div>
  `;
};

const getSmtpMailContext = (order: Sale, emailType: "booked" | "cancelled"): SmtpMailContext | null => {
  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpPortRaw = process.env.SMTP_PORT?.trim() || "587";
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS?.trim();
  const smtpSecure = (process.env.SMTP_SECURE?.trim() || "").toLowerCase() === "true";
  const fromEmail =
    process.env.SMTP_FROM_EMAIL?.trim() ||
    process.env.ORDER_EMAIL_FROM?.trim();
  const fromName = process.env.SMTP_FROM_NAME?.trim() || "RKT Store";
  const replyTo = process.env.SMTP_REPLY_TO?.trim() || SUPPORT_EMAIL || fromEmail;
  const smtpPort = Number(smtpPortRaw);

  if (!smtpHost) {
    console.warn(
      `Order ${emailType} email skipped for order ${order.id}: SMTP_HOST is not configured`,
    );
    return null;
  }

  if (!Number.isFinite(smtpPort)) {
    console.warn(
      `Order ${emailType} email skipped for order ${order.id}: SMTP_PORT is invalid`,
    );
    return null;
  }

  if (!smtpUser || !smtpPass) {
    console.warn(
      `Order ${emailType} email skipped for order ${order.id}: SMTP_USER / SMTP_PASS is not configured`,
    );
    return null;
  }

  if (!fromEmail) {
    console.warn(
      `Order ${emailType} email skipped for order ${order.id}: SMTP_FROM_EMAIL is not configured`,
    );
    return null;
  }

  return {
    transporter: nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure || smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    }),
    fromEmail,
    fromName,
    replyTo,
  };
};

export const sendOrderBookedEmail = async ({
  order,
  trackingNumber,
  leopardsOrderId,
  bookingOrderId,
  courierName,
}: SendOrderBookedEmailInput): Promise<MailResult> => {
  const toEmail = order.customerEmail?.trim();
  if (!toEmail) {
    return { sent: false, reason: "customer email missing" };
  }

  const cnNumber = (trackingNumber || order.trackingNumber || "").trim();
  if (!cnNumber) {
    return { sent: false, reason: "tracking number missing" };
  }
  const mailContext = getSmtpMailContext(order, "booked");
  if (!mailContext) {
    return { sent: false, reason: "SMTP config missing" };
  }

  const trackingUrl = buildTrackingUrl(order, cnNumber);
  const orderIdForEmail = resolveOrderIdForCustomerEmail(order, bookingOrderId || leopardsOrderId);
  const resolvedCourierName = (courierName || "Leopards").trim() || "Leopards";
  const subject = `Order booked: ${orderIdForEmail} | CN ${cnNumber}`;
  const text = [
    `Your order has been booked with ${resolvedCourierName}.`,
    `Order ID: ${orderIdForEmail}`,
    `CN Number: ${cnNumber}`,
    trackingUrl ? `Track Order: ${trackingUrl}` : "",
    `Support Email: ${SUPPORT_EMAIL}`,
  ]
    .filter(Boolean)
    .join("\n");

  await mailContext.transporter.sendMail({
    from: `"${mailContext.fromName}" <${mailContext.fromEmail}>`,
    to: toEmail,
    replyTo: mailContext.replyTo,
    subject,
    text,
    html: buildOrderBookedHtml(order, orderIdForEmail, cnNumber, trackingUrl, resolvedCourierName),
    headers: {
      "X-Auto-Response-Suppress": "All",
      "X-Entity-Ref-ID": `${order.id}-${cnNumber}`,
    },
  });

  return { sent: true };
};

export const sendOrderCancelledEmail = async ({
  order,
}: {
  order: Sale;
}): Promise<MailResult> => {
  const toEmail = order.customerEmail?.trim();
  if (!toEmail) {
    return { sent: false, reason: "customer email missing" };
  }

  const mailContext = getSmtpMailContext(order, "cancelled");
  if (!mailContext) {
    return { sent: false, reason: "SMTP config missing" };
  }

  const subject = "Order cancelled";
  const text = [
    "Your order has been cancelled.",
    `For support, email us at: ${SUPPORT_EMAIL}`,
  ].join("\n");

  await mailContext.transporter.sendMail({
    from: `"${mailContext.fromName}" <${mailContext.fromEmail}>`,
    to: toEmail,
    replyTo: mailContext.replyTo,
    subject,
    text,
    html: buildOrderCancelledHtml(order),
    headers: {
      "X-Auto-Response-Suppress": "All",
      "X-Entity-Ref-ID": `${order.id}-cancelled`,
    },
  });

  return { sent: true };
};
