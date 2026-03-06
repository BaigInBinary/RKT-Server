import prisma from "../config/prisma";
import { CollectionSubCategoryMode, Prisma } from "@prisma/client";

export interface CollectionSubCategoryInput {
  subCategoryId: string;
  mode: CollectionSubCategoryMode;
  itemIds?: string[];
}

export interface CreateCollectionInput {
  name: string;
  slug: string;
  bannerImage: string;
  isActive?: boolean;
  categoryIds?: string[];
  subCategories?: CollectionSubCategoryInput[];
  directItemIds?: string[];
}

export type UpdateCollectionInput = Partial<CreateCollectionInput>;

interface PaginatedInput {
  page?: number;
  limit?: number;
  search?: string;
}

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const uniqueStrings = (values?: string[]) =>
  Array.from(new Set((values || []).map((v) => v.trim()).filter(Boolean)));

const loadResolvedItemIds = async (collectionId: string) => {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    include: {
      subCategorySelections: {
        include: {
          selectedItems: true,
        },
      },
      directItems: true,
    },
  });

  if (!collection) {
    throw new Error("Collection not found");
  }

  const ids = new Set<string>();
  collection.directItems.forEach((entry) => ids.add(entry.itemId));

  const allSubCategoryIds = collection.subCategorySelections
    .filter((entry) => entry.mode === CollectionSubCategoryMode.ALL_ITEMS)
    .map((entry) => entry.subCategoryId);

  if (allSubCategoryIds.length > 0) {
    const items = await prisma.item.findMany({
      where: {
        subCategoryId: { in: allSubCategoryIds },
      },
      select: { id: true },
    });
    items.forEach((item) => ids.add(item.id));
  }

  collection.subCategorySelections
    .filter((entry) => entry.mode === CollectionSubCategoryMode.SELECTED_ITEMS)
    .forEach((entry) => {
      entry.selectedItems.forEach((selected) => ids.add(selected.itemId));
    });

  return Array.from(ids);
};

const validateAndNormalizePayload = async (
  payload: CreateCollectionInput | UpdateCollectionInput,
  forUpdate: boolean,
) => {
  const normalized = {
    name: payload.name?.trim(),
    slug: payload.slug ? slugify(payload.slug) : undefined,
    bannerImage: payload.bannerImage?.trim(),
    isActive: payload.isActive,
    categoryIds: uniqueStrings(payload.categoryIds),
    directItemIds: uniqueStrings(payload.directItemIds),
    subCategories: (payload.subCategories || []).map((entry) => ({
      subCategoryId: entry.subCategoryId?.trim(),
      mode: entry.mode,
      itemIds: uniqueStrings(entry.itemIds),
    })),
  };

  if (!forUpdate) {
    if (!normalized.name) {
      throw new Error("name is required");
    }
    if (!normalized.slug) {
      throw new Error("slug is required");
    }
    if (!normalized.bannerImage) {
      throw new Error("bannerImage is required");
    }
  }

  if (normalized.slug && normalized.slug.length < 2) {
    throw new Error("slug must be at least 2 characters");
  }

  return normalized;
};

const validateReferences = async (payload: {
  categoryIds: string[];
  directItemIds: string[];
  subCategories: Array<{
    subCategoryId?: string;
    mode: CollectionSubCategoryMode;
    itemIds: string[];
  }>;
}) => {
  if (payload.categoryIds.length > 0) {
    const categories = await prisma.category.findMany({
      where: { id: { in: payload.categoryIds } },
      select: { id: true },
    });
    if (categories.length !== payload.categoryIds.length) {
      throw new Error("One or more categoryIds are invalid");
    }
  }

  if (payload.directItemIds.length > 0) {
    const items = await prisma.item.findMany({
      where: { id: { in: payload.directItemIds } },
      select: { id: true },
    });
    if (items.length !== payload.directItemIds.length) {
      throw new Error("One or more directItemIds are invalid");
    }
  }

  const subCategoryIds = payload.subCategories
    .map((entry) => entry.subCategoryId)
    .filter((id): id is string => !!id);
  if (subCategoryIds.length > 0) {
    const subs = await prisma.subCategory.findMany({
      where: { id: { in: subCategoryIds } },
      select: { id: true, categoryId: true },
    });
    if (subs.length !== subCategoryIds.length) {
      throw new Error("One or more subCategoryIds are invalid");
    }

    const subById = new Map(subs.map((entry) => [entry.id, entry]));
    for (const subInput of payload.subCategories) {
      if (!subInput.subCategoryId) {
        throw new Error("subCategoryId is required in subCategories");
      }
      const sub = subById.get(subInput.subCategoryId);
      if (!sub) {
        throw new Error("Invalid subCategoryId");
      }

      if (
        payload.categoryIds.length > 0 &&
        !payload.categoryIds.includes(sub.categoryId)
      ) {
        throw new Error("Subcategory must belong to one of selected categories");
      }

      if (subInput.mode === CollectionSubCategoryMode.SELECTED_ITEMS) {
        if (subInput.itemIds.length === 0) {
          throw new Error(
            "SELECTED_ITEMS mode requires at least one itemId",
          );
        }
        const selectedItems = await prisma.item.findMany({
          where: {
            id: { in: subInput.itemIds },
            subCategoryId: subInput.subCategoryId,
          },
          select: { id: true },
        });
        if (selectedItems.length !== subInput.itemIds.length) {
          throw new Error(
            "All selected itemIds must exist and belong to the subcategory",
          );
        }
      }
    }
  }
};

const buildCollectionCreateData = (
  normalized: Awaited<ReturnType<typeof validateAndNormalizePayload>>,
): Prisma.CollectionCreateInput => {
  const categoryIds = normalized.categoryIds;
  const directItemIds = normalized.directItemIds;
  const subCategories = normalized.subCategories;

  return {
    name: normalized.name!,
    slug: normalized.slug!,
    bannerImage: normalized.bannerImage!,
    isActive: normalized.isActive ?? true,
    categories:
      categoryIds.length > 0
        ? {
            create: categoryIds.map((categoryId) => ({
              category: { connect: { id: categoryId } },
            })),
          }
        : undefined,
    directItems:
      directItemIds.length > 0
        ? {
            create: directItemIds.map((itemId) => ({ itemId })),
          }
        : undefined,
    subCategorySelections:
      subCategories.length > 0
        ? {
            create: subCategories.map((entry) => ({
              subCategory: { connect: { id: entry.subCategoryId! } },
              mode: entry.mode,
              selectedItems:
                entry.mode === CollectionSubCategoryMode.SELECTED_ITEMS
                  ? {
                      create: entry.itemIds.map((itemId) => ({ itemId })),
                    }
                  : undefined,
            })),
          }
        : undefined,
  };
};

export const listCollectionsPublic = async () => {
  return prisma.collection.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      bannerImage: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });
};

export const getCollectionByIdPublic = async (idOrSlug: string) => {
  return prisma.collection.findFirst({
    where: {
      AND: [
        { isActive: true },
        {
          OR: [{ id: idOrSlug }, { slug: idOrSlug }],
        },
      ],
    },
    include: {
      categories: {
        include: { category: true },
      },
      subCategorySelections: {
        include: {
          subCategory: true,
          selectedItems: true,
        },
      },
      directItems: true,
    },
  });
};

export const getCollectionItemsPublic = async (
  idOrSlug: string,
  query: PaginatedInput,
) => {
  const collection = await prisma.collection.findFirst({
    where: {
      AND: [
        { isActive: true },
        {
          OR: [{ id: idOrSlug }, { slug: idOrSlug }],
        },
      ],
    },
    select: { id: true },
  });

  if (!collection) {
    throw new Error("Collection not found");
  }

  const itemIds = await loadResolvedItemIds(collection.id);
  if (itemIds.length === 0) {
    return {
      data: [],
      meta: {
        page: 1,
        limit: 20,
        totalItems: 0,
        totalPages: 1,
      },
    };
  }

  const page = Number.isFinite(query.page) ? Math.max(1, Math.floor(query.page as number)) : 1;
  const limit = Number.isFinite(query.limit) ? Math.min(100, Math.max(1, Math.floor(query.limit as number))) : 20;

  const where: Prisma.ItemWhereInput = {
    id: { in: itemIds },
  };
  if (query.search && query.search.trim()) {
    const term = query.search.trim();
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { sku: { contains: term, mode: "insensitive" } },
    ];
  }

  const [items, totalItems] = await prisma.$transaction([
    prisma.item.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.item.count({ where }),
  ]);

  return {
    data: items,
    meta: {
      page,
      limit,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / limit)),
    },
  };
};

export const listCollectionsAdmin = async () => {
  return prisma.collection.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      categories: { include: { category: true } },
      subCategorySelections: { include: { subCategory: true, selectedItems: true } },
      directItems: true,
    },
  });
};

export const createCollection = async (payload: CreateCollectionInput) => {
  const normalized = await validateAndNormalizePayload(payload, false);
  await validateReferences({
    categoryIds: normalized.categoryIds,
    directItemIds: normalized.directItemIds,
    subCategories: normalized.subCategories,
  });

  return prisma.collection.create({
    data: buildCollectionCreateData(normalized),
    include: {
      categories: { include: { category: true } },
      subCategorySelections: { include: { subCategory: true, selectedItems: true } },
      directItems: true,
    },
  });
};

export const updateCollection = async (
  id: string,
  payload: UpdateCollectionInput,
) => {
  const existing = await prisma.collection.findUnique({ where: { id } });
  if (!existing) {
    throw new Error("Collection not found");
  }

  const normalized = await validateAndNormalizePayload(
    {
      name: payload.name ?? existing.name,
      slug: payload.slug ?? existing.slug,
      bannerImage: payload.bannerImage ?? existing.bannerImage,
      isActive: payload.isActive ?? existing.isActive,
      categoryIds: payload.categoryIds ?? [],
      subCategories: payload.subCategories ?? [],
      directItemIds: payload.directItemIds ?? [],
    },
    true,
  );
  await validateReferences({
    categoryIds: normalized.categoryIds,
    directItemIds: normalized.directItemIds,
    subCategories: normalized.subCategories,
  });

  return prisma.$transaction(async (tx) => {
    await tx.collectionCategorySelection.deleteMany({ where: { collectionId: id } });
    const selectionRows = await tx.collectionSubCategorySelection.findMany({
      where: { collectionId: id },
      select: { id: true },
    });
    if (selectionRows.length > 0) {
      await tx.collectionSubCategoryItem.deleteMany({
        where: {
          subCategorySelectionId: {
            in: selectionRows.map((entry) => entry.id),
          },
        },
      });
    }
    await tx.collectionSubCategorySelection.deleteMany({ where: { collectionId: id } });
    await tx.collectionItemSelection.deleteMany({ where: { collectionId: id } });

    return tx.collection.update({
      where: { id },
      data: {
        name: normalized.name,
        slug: normalized.slug,
        bannerImage: normalized.bannerImage,
        isActive: normalized.isActive,
        categories:
          normalized.categoryIds.length > 0
            ? {
                create: normalized.categoryIds.map((categoryId) => ({
                  category: { connect: { id: categoryId } },
                })),
              }
            : undefined,
        directItems:
          normalized.directItemIds.length > 0
            ? {
                create: normalized.directItemIds.map((itemId) => ({ itemId })),
              }
            : undefined,
        subCategorySelections:
          normalized.subCategories.length > 0
            ? {
                create: normalized.subCategories.map((entry) => ({
                  subCategory: { connect: { id: entry.subCategoryId! } },
                  mode: entry.mode,
                  selectedItems:
                    entry.mode === CollectionSubCategoryMode.SELECTED_ITEMS
                      ? { create: entry.itemIds.map((itemId) => ({ itemId })) }
                      : undefined,
                })),
              }
            : undefined,
      },
      include: {
        categories: { include: { category: true } },
        subCategorySelections: { include: { subCategory: true, selectedItems: true } },
        directItems: true,
      },
    });
  });
};

export const deleteCollection = async (id: string) => {
  return prisma.$transaction(async (tx) => {
    const selectionRows = await tx.collectionSubCategorySelection.findMany({
      where: { collectionId: id },
      select: { id: true },
    });
    if (selectionRows.length > 0) {
      await tx.collectionSubCategoryItem.deleteMany({
        where: {
          subCategorySelectionId: {
            in: selectionRows.map((entry) => entry.id),
          },
        },
      });
    }

    await tx.collectionCategorySelection.deleteMany({ where: { collectionId: id } });
    await tx.collectionSubCategorySelection.deleteMany({ where: { collectionId: id } });
    await tx.collectionItemSelection.deleteMany({ where: { collectionId: id } });
    return tx.collection.delete({ where: { id } });
  });
};
