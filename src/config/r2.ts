import crypto from "crypto";
import path from "path";

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicBaseUrl: string;
  keyPrefix: string;
};

export type UploadedImage = {
  secure_url: string;
  public_id: string;
};

export type R2ObjectSummary = {
  key: string;
  size: number;
  lastModified?: string;
  etag?: string;
};

const R2_REGION = "auto";
const R2_SERVICE = "s3";
const CACHE_CONTROL = "public, max-age=31536000, immutable";

const requiredEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for Cloudflare R2 image storage`);
  }
  return value;
};

export const getR2Config = (): R2Config => ({
  accountId: requiredEnv("CLOUDFLARE_ACCOUNT_ID"),
  accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
  secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
  bucketName: requiredEnv("R2_BUCKET_NAME"),
  publicBaseUrl: requiredEnv("R2_PUBLIC_BASE_URL").replace(/\/+$/, ""),
  keyPrefix: (process.env.R2_KEY_PREFIX || "rkt-store").replace(/^\/+|\/+$/g, ""),
});

const sha256Hex = (value: Buffer | string) =>
  crypto.createHash("sha256").update(value).digest("hex");

const hmac = (key: Buffer | string, value: string) =>
  crypto.createHmac("sha256", key).update(value).digest();

const awsEncode = (value: string) =>
  encodeURIComponent(value)
    .replace(/[!'()*]/g, (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );

const encodeKeyPath = (key: string) =>
  key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const toAmzDate = (date: Date) =>
  date.toISOString().replace(/[:-]|\.\d{3}/g, "");

const buildCanonicalQueryString = (params: Record<string, string | number | undefined>) =>
  Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${awsEncode(key)}=${awsEncode(String(value))}`)
    .join("&");

const signR2Request = ({
  method,
  canonicalUri,
  queryParams,
  bodyHash,
  extraHeaders = {},
}: {
  method: string;
  canonicalUri: string;
  queryParams?: Record<string, string | number | undefined>;
  bodyHash: string;
  extraHeaders?: Record<string, string>;
}) => {
  const config = getR2Config();
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const canonicalQueryString = buildCanonicalQueryString(queryParams || {});

  const canonicalHeadersMap: Record<string, string> = {
    host,
    "x-amz-content-sha256": bodyHash,
    "x-amz-date": amzDate,
    ...Object.fromEntries(
      Object.entries(extraHeaders).map(([key, value]) => [key.toLowerCase(), value]),
    ),
  };

  const signedHeaders = Object.keys(canonicalHeadersMap)
    .sort()
    .join(";");
  const canonicalHeaders = Object.keys(canonicalHeadersMap)
    .sort()
    .map((key) => `${key}:${canonicalHeadersMap[key]}\n`)
    .join("");

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), R2_REGION), R2_SERVICE),
    "aws4_request",
  );
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    amzDate,
    authorization,
    host,
    canonicalQueryString,
  };
};

const sanitizePathSegment = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const extensionFrom = (filename?: string, contentType?: string) => {
  const filenameExt = filename ? path.extname(filename).toLowerCase() : "";
  if (filenameExt && /^[.][a-z0-9]+$/.test(filenameExt)) {
    return filenameExt;
  }

  const type = (contentType || "").toLowerCase();
  if (type === "image/jpeg") return ".jpg";
  if (type === "image/png") return ".png";
  if (type === "image/webp") return ".webp";
  if (type === "image/gif") return ".gif";
  if (type === "image/avif") return ".avif";
  if (type === "image/svg+xml") return ".svg";
  return ".jpg";
};

export const createR2ObjectKey = (
  folder: string,
  filename?: string,
  contentType?: string,
) => {
  const config = getR2Config();
  const safeFolder = sanitizePathSegment(folder || "images") || "images";
  const baseName = sanitizePathSegment(
    filename ? path.basename(filename, path.extname(filename)) : "image",
  ) || "image";
  const ext = extensionFrom(filename, contentType);
  const id = crypto.randomUUID();
  return `${config.keyPrefix}/${safeFolder}/${baseName}-${id}${ext}`;
};

export const getR2PublicUrl = (key: string) => {
  const config = getR2Config();
  return `${config.publicBaseUrl}/${encodeKeyPath(key)}`;
};

export const putR2Object = async ({
  key,
  body,
  contentType,
  cacheControl = CACHE_CONTROL,
}: {
  key: string;
  body: Buffer;
  contentType: string;
  cacheControl?: string;
}) => {
  const config = getR2Config();
  const payloadHash = sha256Hex(body);
  const canonicalUri = `/${config.bucketName}/${encodeKeyPath(key)}`;
  const { amzDate, authorization, host } = signR2Request({
    method: "PUT",
    canonicalUri,
    bodyHash: payloadHash,
    extraHeaders: {
      "cache-control": cacheControl,
      "content-type": contentType,
    },
  });

  const response = await fetch(`https://${host}${canonicalUri}`, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "Cache-Control": cacheControl,
      "Content-Type": contentType,
      "X-Amz-Content-Sha256": payloadHash,
      "X-Amz-Date": amzDate,
    },
    body: body as unknown as BodyInit,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(
      `R2 upload failed with ${response.status} ${response.statusText}: ${message}`,
    );
  }

  return {
    key,
    url: getR2PublicUrl(key),
  };
};

const XML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"',
};

const decodeXmlEntities = (value: string) =>
  value.replace(/&([a-z]+);/gi, (match, entity) => XML_ENTITY_MAP[entity] || match);

const extractTagValue = (source: string, tagName: string) => {
  const match = source.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeXmlEntities(match[1].trim()) : undefined;
};

const parseBoolTag = (source: string, tagName: string) => {
  const value = extractTagValue(source, tagName);
  if (!value) {
    return false;
  }
  return value.toLowerCase() === "true";
};

const parseR2ListObjectsXml = (xml: string) => {
  const contents = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((match) => {
    const block = match[1];
    const key = extractTagValue(block, "Key");
    if (!key) {
      return null;
    }

    const size = Number(extractTagValue(block, "Size") || 0);
    return {
      key,
      size: Number.isFinite(size) ? size : 0,
      lastModified: extractTagValue(block, "LastModified"),
      etag: extractTagValue(block, "ETag")?.replace(/^"|"$/g, ""),
    } satisfies R2ObjectSummary;
  }).filter((entry): entry is R2ObjectSummary => !!entry);

  return {
    contents,
    isTruncated: parseBoolTag(xml, "IsTruncated"),
    nextContinuationToken: extractTagValue(xml, "NextContinuationToken"),
  };
};

export const listR2Objects = async ({
  prefix,
  maxKeys = 1000,
}: {
  prefix?: string;
  maxKeys?: number;
}): Promise<{ objects: R2ObjectSummary[] }> => {
  const config = getR2Config();
  const canonicalUri = `/${config.bucketName}`;
  const payloadHash = sha256Hex("");
  const collected: R2ObjectSummary[] = [];
  let continuationToken: string | undefined;

  do {
    const queryParams: Record<string, string | number | undefined> = {
      "list-type": 2,
      prefix,
      "max-keys": maxKeys,
      "continuation-token": continuationToken,
    };

    const { authorization, amzDate, host, canonicalQueryString } = signR2Request({
      method: "GET",
      canonicalUri,
      queryParams,
      bodyHash: payloadHash,
    });

    const response = await fetch(
      `https://${host}${canonicalUri}?${canonicalQueryString}`,
      {
        method: "GET",
        headers: {
          Authorization: authorization,
          "X-Amz-Content-Sha256": payloadHash,
          "X-Amz-Date": amzDate,
        },
      },
    );

    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new Error(
        `R2 listing failed with ${response.status} ${response.statusText}: ${message}`,
      );
    }

    const xml = await response.text();
    const parsed = parseR2ListObjectsXml(xml);
    collected.push(...parsed.contents);
    continuationToken = parsed.nextContinuationToken;

    if (!parsed.isTruncated) {
      break;
    }
  } while (continuationToken);

  return { objects: collected };
};

export const uploadImageBuffer = async (
  buffer: Buffer,
  folder = "items",
  filename?: string,
  contentType = "image/jpeg",
): Promise<UploadedImage> => {
  const key = createR2ObjectKey(folder, filename, contentType);
  const uploaded = await putR2Object({
    key,
    body: buffer,
    contentType,
  });
  return {
    secure_url: uploaded.url,
    public_id: uploaded.key,
  };
};
