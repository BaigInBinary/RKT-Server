import prisma from "../config/prisma";

/**
 * Generates a URL-safe slug from text
 * - Converts to lowercase
 * - Removes special characters
 * - Replaces spaces with hyphens
 * - Removes leading/trailing hyphens
 */
export const generateSlug = (text: string): string => {
  if (!text || typeof text !== "string") {
    return "";
  }

  return text
    .trim()
    .toLowerCase()
    // Replace spaces with hyphens
    .replace(/\s+/g, "-")
    // Remove special characters, keep only alphanumeric and hyphens
    .replace(/[^a-z0-9-]/g, "")
    // Replace multiple consecutive hyphens with single hyphen
    .replace(/-+/g, "-")
    // Remove leading and trailing hyphens
    .replace(/^-+|-+$/g, "");
};

/**
 * Ensures slug uniqueness by appending -1, -2, etc. if needed
 */
export const ensureUniqueSlug = async (
  baseSlug: string,
  itemIdToExclude?: string,
): Promise<string> => {
  if (!baseSlug) {
    throw new Error("Cannot generate unique slug from empty string");
  }

  let slug = baseSlug;
  let counter = 0;

  while (true) {
    try {
      // Use type assertion to query by slug even if not yet in Prisma types
      const existing = await (prisma.item.findMany as any)({
        where: {
          slug: slug,
        },
        select: {
          id: true,
        },
      });

      const existingItem = existing.find((item: { id: string }) => item.id !== itemIdToExclude);

      if (!existingItem) {
        // Slug is unique or we're updating the same item
        return slug;
      }

      // Slug exists, append counter and try again
      counter++;
      slug = `${baseSlug}-${counter}`;

      // Safety check to prevent infinite loops
      if (counter > 1000) {
        throw new Error(`Could not generate unique slug after ${counter} attempts`);
      }
    } catch (error) {
      // If slug query isn't supported yet (before Prisma migration),
      // just return the slug without uniqueness check
      if ((error as any)?.code === "P2008" || (error as any)?.message?.includes("Unknown field")) {
        return slug;
      }
      throw error;
    }
  }
};

/**
 * Generate and ensure unique slug from item name
 */
export const generateItemSlug = async (
  name: string,
  itemIdToExclude?: string,
): Promise<string> => {
  const baseSlug = generateSlug(name);

  if (!baseSlug) {
    // Fallback to empty string if name generates no valid slug
    // In this case, the item won't have a slug and must be accessed by ID
    return "";
  }

  return ensureUniqueSlug(baseSlug, itemIdToExclude);
};
