/**
 * Middleware to handle slug redirects for SEO
 * This middleware redirects requests from /product/:id to /product/:slug (301 redirect)
 * when accessing a product by its MongoDB ObjectId instead of its slug.
 *
 * Optional middleware - only add to routes where you want redirect behavior
 */

import { Request, Response, NextFunction } from "express";
import prisma from "../config/prisma";

/**
 * Middleware that redirects ID-based URLs to slug-based URLs (301 permanent redirect)
 * Usage in routes:
 *   router.get("/catalog/:id", redirectToSlugIfMongoId, itemController.getCatalogItem);
 */
export const redirectToSlugIfMongoId = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const { id } = req.params;
  const idStr = Array.isArray(id) ? id[0] : id;

  // Check if the parameter looks like a MongoDB ObjectId (24 hex characters)
  if (!/^[0-9a-fA-F]{24}$/.test(idStr)) {
    // Not a MongoDB ID, likely already a slug - continue
    return next();
  }

  try {
    // Check if this ID has a slug
    const items = await prisma.item.findMany({
      where: {
        id: idStr,
      },
      select: {
        id: true,
      },
    });

    const item = items[0];

    if (item) {
      // For now, since slug field isn't in Prisma types yet, we'll just continue
      // Once Prisma is regenerated, we can enable the redirect
      // TODO: Enable redirect after Prisma migration
      next();
    } else {
      // Item not found, continue anyway
      next();
    }
  } catch (error) {
    // If there's an error, continue anyway (don't break the request)
    console.error("Redirect middleware error:", error);
    next();
  }
};

/**
 * Optional: Middleware to track when products are accessed by ID instead of slug
 * Useful for analytics to understand which old URLs are still being used
 */
export const trackIdBasedAccess = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const { id } = req.params;
  const idStr = Array.isArray(id) ? id[0] : id;

  // Only track if it's a MongoDB ObjectId
  if (/^[0-9a-fA-F]{24}$/.test(idStr)) {
    try {
      const items = await prisma.item.findMany({
        where: {
          id: idStr,
        },
        select: {
          id: true,
          name: true,
        },
      });

      const item = items[0];

      if (item) {
        console.log(`[LEGACY_URL_ACCESS] Item: "${item.name}" | ID: ${idStr}`);
      }
    } catch (error) {
      // Silently fail - tracking should not break the request
      console.error("[LEGACY_URL_ACCESS] Error:", error);
    }
  }

  next();
};
