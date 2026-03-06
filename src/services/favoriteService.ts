import prisma from "../config/prisma";

export interface FavoriteInput {
  itemId: string;
  name: string;
  image?: string;
  price?: number;
  category?: string;
}

export const getFavoritesByUserId = async (userId: string) => {
  return (prisma as any).favorite.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
};

export const addFavorite = async (userId: string, data: FavoriteInput) => {
  const existing = await (prisma as any).favorite.findFirst({
    where: { userId, itemId: data.itemId },
  });

  if (existing) {
    return existing;
  }

  return (prisma as any).favorite.create({
    data: {
      userId,
      itemId: data.itemId,
      name: data.name,
      image: data.image ?? null,
      price: data.price ?? null,
      category: data.category ?? null,
    },
  });
};

export const removeFavorite = async (userId: string, itemId: string) => {
  const existing = await (prisma as any).favorite.findFirst({
    where: { userId, itemId },
  });

  if (!existing) {
    return null;
  }

  await (prisma as any).favorite.delete({
    where: { id: existing.id },
  });

  return existing;
};
