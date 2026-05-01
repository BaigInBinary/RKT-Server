/**
 * Migration script to generate slugs for existing products
 * Run this once to update all existing items in the database
 *
 * Usage:
 *   npx tsx src/scripts/migrateItemSlugs.ts
 */

import prisma from "../config/prisma";
import { generateSlug, ensureUniqueSlug } from "../utils/slugUtils";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export const migrateItemSlugs = async () => {
  console.log("Starting item slug migration...");

  try {
    // Get all items that don't have a slug
    const itemsWithoutSlug = await prisma.item.findMany({
      where: {
        OR: [{ slug: null }, { slug: "" }],
      },
      select: {
        id: true,
        name: true,
        slug: true,
      },
    });

    console.log(`Found ${itemsWithoutSlug.length} items without slugs`);

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    // Process each item
    for (let i = 0; i < itemsWithoutSlug.length; i++) {
      const item = itemsWithoutSlug[i];

      try {
        // Skip items with no name
        if (!item.name || item.name.trim() === "") {
          console.log(`⊘ Skipped item ${item.id} (no name)`);
          skippedCount++;
          continue;
        }

        // Generate slug from name
        const baseSlug = generateSlug(item.name);

        if (!baseSlug) {
          console.log(`⊘ Skipped item ${item.id} - "${item.name}" (no valid slug generated)`);
          skippedCount++;
          continue;
        }

        // Ensure slug is unique
        const uniqueSlug = await ensureUniqueSlug(baseSlug, item.id);

        // Update item with new slug
        await prisma.item.update({
          where: { id: item.id },
          data: { slug: uniqueSlug },
        });

        console.log(
          `✓ Updated item ${item.id} - "${item.name}" → "${uniqueSlug}" (${i + 1}/${itemsWithoutSlug.length})`,
        );
        successCount++;

        // Small delay to avoid overwhelming the database
        if ((i + 1) % 10 === 0) {
          await sleep(100);
        }
      } catch (error) {
        console.error(`✗ Error processing item ${item.id}:`, error);
        errorCount++;
      }
    }

    console.log("\n=== Migration Summary ===");
    console.log(`✓ Success: ${successCount}`);
    console.log(`✗ Errors: ${errorCount}`);
    console.log(`⊘ Skipped: ${skippedCount}`);
    console.log(`Total: ${itemsWithoutSlug.length}`);

    if (errorCount > 0) {
      console.log("\n⚠ Some items failed to migrate. Check the errors above.");
      process.exit(1);
    } else {
      console.log("\n✓ Migration completed successfully!");
      process.exit(0);
    }
  } catch (error) {
    console.error("Fatal error during migration:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
};

// Run migration if this script is executed directly
migrateItemSlugs();
