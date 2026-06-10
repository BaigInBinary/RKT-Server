import { Request, Response, NextFunction } from "express";
import { getR2Config, getR2PublicUrl, listR2Objects } from "../config/r2";

const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);

const getQueryString = (value: unknown): string | undefined => {
  if (Array.isArray(value)) {
    return value[0] ? String(value[0]) : undefined;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  return String(value);
};

const getFileName = (key: string) => key.split("/").pop() || key;

const getFileExtension = (key: string) => {
  const fileName = getFileName(key).toLowerCase();
  const match = fileName.match(/\.[a-z0-9]+$/);
  return match ? match[0] : "";
};

export const getMediaImages = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prefix = getQueryString(req.query.prefix)?.trim();
    const bucketPrefix = prefix || getR2Config().keyPrefix;
    const result = await listR2Objects({ prefix: bucketPrefix });

    const images = result.objects
      .filter((entry) => IMAGE_EXTENSIONS.has(getFileExtension(entry.key)))
      .map((entry) => ({
        key: entry.key,
        url: getR2PublicUrl(entry.key),
        fileName: getFileName(entry.key),
        size: entry.size,
        lastModified: entry.lastModified,
        etag: entry.etag,
      }))
      .sort((left, right) => {
        const leftTime = left.lastModified ? Date.parse(left.lastModified) : 0;
        const rightTime = right.lastModified ? Date.parse(right.lastModified) : 0;
        return rightTime - leftTime;
      });

    res.status(200).json(images);
  } catch (error) {
    next(error);
  }
};
