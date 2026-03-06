import { Request, Response, NextFunction } from 'express';
import * as itemService from '../services/itemService';
import { uploadImageBuffer } from "../config/cloudinary";

const toNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const toStringArray = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((entry) => String(entry).trim()).filter(Boolean);
        }
      } catch {
        return trimmed
          .split("\n")
          .map((entry) => entry.trim())
          .filter(Boolean);
      }
    }

    return trimmed
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return undefined;
};

const toJson = (value: unknown): unknown => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return value;
};

const normalizeItemPayload = (body: Record<string, unknown>) => {
  const payload: Record<string, unknown> = { ...body };

  const numberFields = [
    "price",
    "costPrice",
    "quantity",
    "minStock",
    "soldCount",
    "viewerCount",
    "averageRating",
    "reviewCount",
  ] as const;

  for (const field of numberFields) {
    const parsed = toNumber(body[field]);
    if (parsed !== undefined) {
      payload[field] = parsed;
    }
  }

  const galleryImages = toStringArray(body.galleryImages);
  if (galleryImages !== undefined) {
    payload.galleryImages = galleryImages;
  }

  const features = toStringArray(body.features);
  if (features !== undefined) {
    payload.features = features;
  }

  const specifications = toJson(body.specifications);
  if (specifications !== undefined) {
    payload.specifications = specifications;
  }

  const reviews = toJson(body.reviews);
  if (reviews !== undefined) {
    payload.reviews = reviews;
  }

  return payload;
};

const getQueryString = (value: unknown): string | undefined => {
  if (Array.isArray(value)) {
    return value[0] ? String(value[0]) : undefined;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  return String(value);
};

const getStringList = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) {
    const list = value
      .flatMap((entry) => String(entry).split(","))
      .map((entry) => entry.trim())
      .filter(Boolean);
    return list.length > 0 ? list : undefined;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  const list = String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
};

export const getItems = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await itemService.getAllItems();
    res.status(200).json(items);
  } catch (error) {
    next(error);
  }
};

export const getCatalogItems = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const page = toNumber(getQueryString(req.query.page));
    const limit = toNumber(getQueryString(req.query.limit));
    const minPrice = toNumber(getQueryString(req.query.minPrice));
    const maxPrice = toNumber(getQueryString(req.query.maxPrice));
    const inStockRaw = getQueryString(req.query.inStockOnly);
    const inStockOnly =
      inStockRaw !== undefined ? inStockRaw.toLowerCase() === "true" : undefined;

    const sortByRaw = getQueryString(req.query.sortBy);
    const sortOrderRaw = getQueryString(req.query.sortOrder);
    const sortBy =
      sortByRaw === "price" ||
      sortByRaw === "name" ||
      sortByRaw === "createdAt" ||
      sortByRaw === "soldCount"
        ? sortByRaw
        : undefined;
    const sortOrder =
      sortOrderRaw === "asc" || sortOrderRaw === "desc" ? sortOrderRaw : undefined;

    const result = await itemService.getCatalogItems({
      page,
      limit,
      search: getQueryString(req.query.search),
      categories: getStringList(req.query.category),
      subCategoryIds: getStringList(req.query.subCategoryId),
      minPrice,
      maxPrice,
      inStockOnly,
      sortBy,
      sortOrder,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getTopSellingItems = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const pageHours = toNumber(getQueryString(req.query.hours));
    const limit = toNumber(getQueryString(req.query.limit));
    const result = await itemService.getTopSellingItems({
      hours: pageHours,
      limit,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getNewArrivals = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await itemService.getNewArrivals();
    res.status(200).json(items);
  } catch (error) {
    next(error);
  }
};

export const getItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await itemService.getItemById(req.params.id as string);
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }
    res.status(200).json(item);
  } catch (error) {
    next(error);
  }
};

export const createItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await itemService.createItem(
      normalizeItemPayload(req.body) as itemService.CreateItemInput,
    );
    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
};

export const updateItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await itemService.updateItem(
      req.params.id as string,
      normalizeItemPayload(req.body) as itemService.UpdateItemInput,
    );
    res.status(200).json(item);
  } catch (error) {
    next(error);
  }
};

export const deleteItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await itemService.deleteItem(req.params.id as string);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

export const getStockAlerts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const alerts = await itemService.getStockAlerts();
    res.status(200).json(alerts);
  } catch (error) {
    next(error);
  }
};

export const uploadItemImage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Image file is required" });
    }

    const uploadedImage = await uploadImageBuffer(req.file.buffer, "items");
    res.status(200).json({
      imageUrl: uploadedImage.secure_url,
      publicId: uploadedImage.public_id,
    });
  } catch (error) {
    next(error);
  }
};
