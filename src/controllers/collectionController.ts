import { NextFunction, Request, Response } from "express";
import { CollectionSubCategoryMode } from "@prisma/client";
import * as collectionService from "../services/collectionService";

const getParam = (value: string | string[]) =>
  Array.isArray(value) ? value[0] : value;

const toNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
};

const normalizeSubCategories = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const row = entry as Record<string, unknown>;
      const mode = String(row.mode || "ALL_ITEMS");
      if (
        mode !== CollectionSubCategoryMode.ALL_ITEMS &&
        mode !== CollectionSubCategoryMode.SELECTED_ITEMS
      ) {
        return null;
      }
      return {
        subCategoryId: String(row.subCategoryId || "").trim(),
        mode: mode as CollectionSubCategoryMode,
        itemIds: toStringArray(row.itemIds),
      };
    })
    .filter(
      (
        entry,
      ): entry is {
        subCategoryId: string;
        mode: CollectionSubCategoryMode;
        itemIds: string[];
      } => !!entry,
    );
};

export const listPublicCollections = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const data = await collectionService.listCollectionsPublic();
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

export const getPublicCollection = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const idOrSlug = getParam(req.params.idOrSlug);
    const collection = await collectionService.getCollectionByIdPublic(idOrSlug);
    if (!collection) {
      return res.status(404).json({ message: "Collection not found" });
    }
    res.status(200).json(collection);
  } catch (error) {
    next(error);
  }
};

export const getPublicCollectionItems = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const idOrSlug = getParam(req.params.idOrSlug);
    const page = toNumber(req.query.page);
    const limit = toNumber(req.query.limit);
    const search = req.query.search ? String(req.query.search) : undefined;
    const data = await collectionService.getCollectionItemsPublic(idOrSlug, {
      page,
      limit,
      search,
    });
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

export const listAdminCollections = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const data = await collectionService.listCollectionsAdmin();
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

export const createCollection = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const body = req.body as Record<string, unknown>;
    const collection = await collectionService.createCollection({
      name: String(body.name || ""),
      slug: String(body.slug || ""),
      bannerImage: String(body.bannerImage || ""),
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
      categoryIds: toStringArray(body.categoryIds),
      directItemIds: toStringArray(body.directItemIds),
      subCategories: normalizeSubCategories(body.subCategories),
    });
    res.status(201).json(collection);
  } catch (error) {
    next(error);
  }
};

export const updateCollection = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = getParam(req.params.id);
    const body = req.body as Record<string, unknown>;
    const payload: collectionService.UpdateCollectionInput = {};

    if (body.name !== undefined) payload.name = String(body.name || "");
    if (body.slug !== undefined) payload.slug = String(body.slug || "");
    if (body.bannerImage !== undefined)
      payload.bannerImage = String(body.bannerImage || "");
    if (body.isActive !== undefined) payload.isActive = Boolean(body.isActive);
    if (body.categoryIds !== undefined) payload.categoryIds = toStringArray(body.categoryIds);
    if (body.directItemIds !== undefined) payload.directItemIds = toStringArray(body.directItemIds);
    if (body.subCategories !== undefined)
      payload.subCategories = normalizeSubCategories(body.subCategories);

    const collection = await collectionService.updateCollection(id, payload);
    res.status(200).json(collection);
  } catch (error) {
    next(error);
  }
};

export const deleteCollection = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = getParam(req.params.id);
    await collectionService.deleteCollection(id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
