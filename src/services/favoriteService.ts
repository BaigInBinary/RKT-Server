import prisma from "../config/prisma";

export interface FavoriteInput {
  itemId: string;
}

export const getFavoritesByUserId = async (userId: string) => {
  const favorites = await (prisma as any).favorite.findMany({
    where: { userId },
    include: {
      item: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Filter out any favorites where the item was deleted
  return favorites.filter((fav: any) => !!fav.item);
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
    },
  });
};

export const removeFavorite = async (userId: string, itemId: string) => {
  const favorite = await (prisma as any).favorite.findFirst({
    where: { userId, itemId },
  });

  if (!favorite) {
    return null;
  }

  await (prisma as any).favorite.delete({
    where: { id: favorite.id },
  });

  return favorite;
};
