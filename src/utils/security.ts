import crypto from "crypto";

export type UserRole = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "CASHIER";
export type UserStatus = "PENDING" | "ACTIVE" | "SUSPENDED";
export type UserAccountType = "ADMIN_PORTAL" | "LOCAL_USER";

export interface AuthTokenPayload {
  sub: string;
  email: string;
  accountType: UserAccountType;
  role: UserRole;
  status: UserStatus;
  permissions: string[];
  exp: number;
}

const HEADER = { alg: "HS256", typ: "JWT" } as const;
const HASH_PREFIX = "scrypt";
const TOKEN_EXPIRY_SECONDS = 60 * 60 * 12;

const getSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret || !secret.trim()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET is required in production");
    }
    return "dev-only-secret-change-me";
  }
  return secret;
};

const base64UrlEncode = (value: string): string => {
  return Buffer.from(value, "utf8").toString("base64url");
};

const base64UrlDecode = (value: string): string => {
  return Buffer.from(value, "base64url").toString("utf8");
};

export const hashPassword = (password: string): string => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${HASH_PREFIX}$${salt}$${hash}`;
};

export const verifyPassword = (
  password: string,
  storedPassword: string,
): boolean => {
  const [prefix, salt, hash] = storedPassword.split("$");
  if (prefix !== HASH_PREFIX || !salt || !hash) {
    return false;
  }

  const hashedInput = crypto.scryptSync(password, salt, 64).toString("hex");
  const left = Buffer.from(hash, "hex");
  const right = Buffer.from(hashedInput, "hex");
  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
};

const createSignature = (encodedHeader: string, encodedPayload: string): string => {
  return crypto
    .createHmac("sha256", getSecret())
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
};

export const signAuthToken = (
  payload: Omit<AuthTokenPayload, "exp">,
  expiresInSeconds: number = TOKEN_EXPIRY_SECONDS,
): string => {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const encodedHeader = base64UrlEncode(JSON.stringify(HEADER));
  const encodedPayload = base64UrlEncode(JSON.stringify({ ...payload, exp }));
  const signature = createSignature(encodedHeader, encodedPayload);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
};

export const verifyAuthToken = (token: string): AuthTokenPayload | null => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSignature = createSignature(encodedHeader, encodedPayload);

  const left = Buffer.from(signature, "utf8");
  const right = Buffer.from(expectedSignature, "utf8");
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return null;
  }

  try {
    const header = JSON.parse(base64UrlDecode(encodedHeader)) as {
      alg?: string;
      typ?: string;
    };
    if (header.alg !== "HS256" || header.typ !== "JWT") {
      return null;
    }

    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as AuthTokenPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
};
