import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import prisma from "../config/prisma";
import { getR2Config, getR2PublicUrl, putR2Object } from "../config/r2";

type MigrationStats = {
  cloudinaryUrlsFound: number;
  cloudinaryAssetsUploaded: number;
  cloudinaryAssetsUploadedFromExport: number;
  cloudinaryAssetsUploadedFromUrl: number;
  cloudinaryAssetsSkipped: number;
  itemRecordsUpdated: number;
  collectionRecordsUpdated: number;
  saleRecordsUpdated: number;
  unmappedCloudinaryUrls: number;
};

const CLOUDINARY_HOST = "res.cloudinary.com";
const R2_CACHE_CONTROL = "public, max-age=31536000, immutable";
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".svg"];

const isCloudinaryUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return new URL(value).hostname === CLOUDINARY_HOST;
  } catch {
    return false;
  }
};

const normalizeUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
};

const sanitizeKeySegment = (segment: string) =>
  segment
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "asset";

const publicIdFromCloudinaryUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    const marker = "/image/upload/";
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex < 0) return null;

    const afterUpload = parsed.pathname.slice(markerIndex + marker.length);
    const parts = afterUpload.split("/").filter(Boolean);
    const versionIndex = parts.findIndex((part) => /^v\d+$/.test(part));
    const idParts = versionIndex >= 0 ? parts.slice(versionIndex + 1) : parts;
    const idWithExt = idParts.join("/");
    return idWithExt.replace(/[.][a-zA-Z0-9]+$/, "") || null;
  } catch {
    return null;
  }
};

const extensionFromUrl = (url: string) => {
  try {
    const ext = new URL(url).pathname.match(/[.]([a-zA-Z0-9]+)$/)?.[1];
    return ext ? `.${ext.toLowerCase()}` : "";
  } catch {
    return "";
  }
};

const contentTypeFromUrl = (url: string, fallback?: string | null) => {
  if (fallback?.startsWith("image/")) return fallback;

  const ext = extensionFromUrl(url).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".avif") return "image/avif";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
};

const contentTypeFromFile = (filePath: string) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".avif") return "image/avif";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
};

const keyForCloudinaryUrl = (url: string) => {
  const { keyPrefix } = getR2Config();
  const publicId = publicIdFromCloudinaryUrl(url);
  const ext = extensionFromUrl(url);

  if (publicId) {
    const safePublicId = publicId
      .split("/")
      .map(sanitizeKeySegment)
      .join("/");
    const alreadyHasExtension = ext && safePublicId.toLowerCase().endsWith(ext);
    return `${keyPrefix}/cloudinary/${safePublicId}${alreadyHasExtension ? "" : ext}`;
  }

  const hash = crypto.createHash("sha256").update(normalizeUrl(url)).digest("hex");
  return `${keyPrefix}/cloudinary/unmapped/${hash}${ext || ".img"}`;
};

const collectStringsDeep = (value: unknown, urls: Set<string>) => {
  if (typeof value === "string") {
    if (isCloudinaryUrl(value)) urls.add(normalizeUrl(value));
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) collectStringsDeep(entry, urls);
    return;
  }

  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectStringsDeep(entry, urls);
  }
};

const collectCloudinaryUrlsFromDatabase = async () => {
  const urls = new Set<string>();

  const items = await prisma.item.findMany({
    select: {
      imageUrl: true,
      galleryImages: true,
      variants: true,
    },
  });
  for (const item of items) {
    if (isCloudinaryUrl(item.imageUrl)) urls.add(normalizeUrl(item.imageUrl));
    for (const imageUrl of item.galleryImages) {
      if (isCloudinaryUrl(imageUrl)) urls.add(normalizeUrl(imageUrl));
    }
    collectStringsDeep(item.variants, urls);
  }

  const collections = await prisma.collection.findMany({
    select: {
      bannerImage: true,
    },
  });
  for (const collection of collections) {
    if (isCloudinaryUrl(collection.bannerImage)) {
      urls.add(normalizeUrl(collection.bannerImage));
    }
  }

  const sales = await prisma.sale.findMany({
    select: {
      bankReceiptUrl: true,
      items: true,
    },
  });
  for (const sale of sales) {
    if (isCloudinaryUrl(sale.bankReceiptUrl)) {
      urls.add(normalizeUrl(sale.bankReceiptUrl));
    }
    collectStringsDeep(sale.items, urls);
  }

  return [...urls];
};

const cloudinaryExportDir = () => {
  const value = process.env.CLOUDINARY_EXPORT_DIR?.trim();
  return value ? path.resolve(value) : null;
};

const fileExists = async (filePath: string) => {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
};

const findInCloudinaryExport = async (url: string) => {
  const exportDir = cloudinaryExportDir();
  if (!exportDir) return null;

  const publicId = publicIdFromCloudinaryUrl(url);
  const ext = extensionFromUrl(url);
  const candidates: string[] = [];

  if (publicId) {
    const decodedPublicId = decodeURIComponent(publicId);
    const publicIdExt = path.extname(decodedPublicId).toLowerCase();
    const basename = path.basename(decodedPublicId);

    candidates.push(path.join(exportDir, decodedPublicId));
    if (ext && publicIdExt !== ext) {
      candidates.push(path.join(exportDir, `${decodedPublicId}${ext}`));
    }

    for (const imageExt of IMAGE_EXTENSIONS) {
      candidates.push(path.join(exportDir, `${decodedPublicId}${imageExt}`));
    }

    candidates.push(path.join(exportDir, basename));
    if (ext && path.extname(basename).toLowerCase() !== ext) {
      candidates.push(path.join(exportDir, `${basename}${ext}`));
    }
    for (const imageExt of IMAGE_EXTENSIONS) {
      candidates.push(path.join(exportDir, `${basename}${imageExt}`));
    }
  }

  for (const candidate of [...new Set(candidates)]) {
    if (await fileExists(candidate)) return candidate;
  }

  return null;
};

const uploadExportedCloudinaryFile = async (url: string, filePath: string) => {
  const key = keyForCloudinaryUrl(url);
  const body = await fs.promises.readFile(filePath);
  await putR2Object({
    key,
    body,
    contentType: contentTypeFromFile(filePath),
    cacheControl: R2_CACHE_CONTROL,
  });

  return getR2PublicUrl(key);
};

const uploadCloudinaryUrl = async (url: string) => {
  const key = keyForCloudinaryUrl(url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Download failed for ${url}: ${response.status} ${response.statusText}`,
    );
  }

  const body = Buffer.from(await response.arrayBuffer());
  await putR2Object({
    key,
    body,
    contentType: contentTypeFromUrl(url, response.headers.get("content-type")),
    cacheControl: R2_CACHE_CONTROL,
  });

  return getR2PublicUrl(key);
};

const makeUrlResolver = (urlMap: Map<string, string>, stats: MigrationStats) => {
  return (value: string) => {
    if (!isCloudinaryUrl(value)) return value;

    const migratedUrl = urlMap.get(normalizeUrl(value));
    if (migratedUrl) return migratedUrl;

    stats.unmappedCloudinaryUrls += 1;
    return value;
  };
};

const replaceStringsDeep = (
  value: unknown,
  replaceUrl: (value: string) => string,
): { value: unknown; changed: boolean } => {
  if (typeof value === "string") {
    const next = replaceUrl(value);
    return { value: next, changed: next !== value };
  }

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((entry) => {
      const result = replaceStringsDeep(entry, replaceUrl);
      changed = changed || result.changed;
      return result.value;
    });
    return { value: next, changed };
  }

  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const result = replaceStringsDeep(entry, replaceUrl);
      changed = changed || result.changed;
      next[key] = result.value;
    }
    return { value: next, changed };
  }

  return { value, changed: false };
};

const migrateItems = async (
  replaceUrl: (value: string) => string,
  stats: MigrationStats,
) => {
  const items = await prisma.item.findMany({
    select: {
      id: true,
      imageUrl: true,
      galleryImages: true,
      variants: true,
    },
  });

  for (const item of items) {
    const data: Record<string, unknown> = {};
    if (item.imageUrl) {
      const next = replaceUrl(item.imageUrl);
      if (next !== item.imageUrl) data.imageUrl = next;
    }

    const galleryImages = item.galleryImages.map(replaceUrl);
    if (galleryImages.some((url, index) => url !== item.galleryImages[index])) {
      data.galleryImages = galleryImages;
    }

    const variants = replaceStringsDeep(item.variants, replaceUrl);
    if (variants.changed) {
      data.variants = variants.value;
    }

    if (Object.keys(data).length > 0) {
      await prisma.item.update({ where: { id: item.id }, data });
      stats.itemRecordsUpdated += 1;
    }
  }
};

const migrateCollections = async (
  replaceUrl: (value: string) => string,
  stats: MigrationStats,
) => {
  const collections = await prisma.collection.findMany({
    select: {
      id: true,
      bannerImage: true,
    },
  });

  for (const collection of collections) {
    const bannerImage = replaceUrl(collection.bannerImage);
    if (bannerImage !== collection.bannerImage) {
      await prisma.collection.update({
        where: { id: collection.id },
        data: { bannerImage },
      });
      stats.collectionRecordsUpdated += 1;
    }
  }
};

const migrateSales = async (
  replaceUrl: (value: string) => string,
  stats: MigrationStats,
) => {
  const sales = await prisma.sale.findMany({
    select: {
      id: true,
      bankReceiptUrl: true,
      bankReceiptPublicId: true,
      items: true,
    },
  });

  for (const sale of sales) {
    const data: Record<string, unknown> = {};

    if (sale.bankReceiptUrl) {
      const bankReceiptUrl = replaceUrl(sale.bankReceiptUrl);
      if (bankReceiptUrl !== sale.bankReceiptUrl) {
        data.bankReceiptUrl = bankReceiptUrl;
        data.bankReceiptPublicId =
          keyForCloudinaryUrl(sale.bankReceiptUrl) || sale.bankReceiptPublicId;
      }
    }

    const items = sale.items.map((item) => {
      if (!item.image) return item;
      const image = replaceUrl(item.image);
      return image === item.image ? item : { ...item, image };
    });
    if (items.some((item, index) => item.image !== sale.items[index].image)) {
      data.items = items;
    }

    if (Object.keys(data).length > 0) {
      await prisma.sale.update({ where: { id: sale.id }, data });
      stats.saleRecordsUpdated += 1;
    }
  }
};

const main = async () => {
  const stats: MigrationStats = {
    cloudinaryUrlsFound: 0,
    cloudinaryAssetsUploaded: 0,
    cloudinaryAssetsUploadedFromExport: 0,
    cloudinaryAssetsUploadedFromUrl: 0,
    cloudinaryAssetsSkipped: 0,
    itemRecordsUpdated: 0,
    collectionRecordsUpdated: 0,
    saleRecordsUpdated: 0,
    unmappedCloudinaryUrls: 0,
  };

  getR2Config();
  const exportDir = cloudinaryExportDir();
  if (exportDir) {
    console.log(`Using Cloudinary export directory: ${exportDir}`);
  }

  const urls = await collectCloudinaryUrlsFromDatabase();
  stats.cloudinaryUrlsFound = urls.length;
  console.log(`Found ${urls.length} Cloudinary image URL(s) in the database.`);

  const urlMap = new Map<string, string>();
  for (const url of urls) {
    try {
      const exportedFile = await findInCloudinaryExport(url);
      const migratedUrl = exportedFile
        ? await uploadExportedCloudinaryFile(url, exportedFile)
        : await uploadCloudinaryUrl(url);
      urlMap.set(normalizeUrl(url), migratedUrl);
      stats.cloudinaryAssetsUploaded += 1;
      if (exportedFile) {
        stats.cloudinaryAssetsUploadedFromExport += 1;
        console.log(`Uploaded ${url} from ${exportedFile}`);
      } else {
        stats.cloudinaryAssetsUploadedFromUrl += 1;
        console.log(`Uploaded ${url}`);
      }
    } catch (error) {
      stats.cloudinaryAssetsSkipped += 1;
      console.error(`Skipped ${url}:`, error);
    }
  }

  const replaceUrl = makeUrlResolver(urlMap, stats);
  await migrateItems(replaceUrl, stats);
  await migrateCollections(replaceUrl, stats);
  await migrateSales(replaceUrl, stats);

  console.log("Cloudinary to R2 migration complete.");
  console.log(JSON.stringify(stats, null, 2));
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
