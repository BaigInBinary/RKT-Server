import { PrismaClient } from "@prisma/client";
import { generateItemSlug } from "../utils/slugUtils";

const prisma = new PrismaClient();

async function regenerateAllSlugs() {
  console.log("Starting comprehensive slug regeneration for all items...");

  try {
    // Find all items (MongoDB returns null slug as is)
    const allItems = await prisma.item.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
      },
    });

    const itemsWithoutSlugs = allItems.filter(
      (item) => !item.slug || item.slug.trim().length === 0
    );

    console.log(
      `Found ${itemsWithoutSlugs.length} items that need slug generation (out of ${allItems.length} total)...`
    );

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    for (const item of itemsWithoutSlugs) {
      try {
        // Generate slug with uniqueness check (excluding this item)
        const slug = await generateItemSlug(item.name, item.id);

        // Update the item
        await prisma.item.update({
          where: { id: item.id },
          data: { slug },
        });

        successCount++;
        console.log(`✓ ${item.id}: "${item.name}" -> "${slug}"`);
      } catch (error) {
        errorCount++;
        console.error(`✗ Failed to generate slug for ${item.id}: ${error}`);
      }
    }

    console.log("\n=== Slug Regeneration Summary ===");
    console.log(`✓ Success: ${successCount}`);
    console.log(`✗ Errors: ${errorCount}`);
    console.log(`⊘ Skipped: ${skippedCount}`);
    console.log(`Total: ${itemsWithoutSlugs.length}`);

    if (errorCount === 0) {
      console.log("\n✓ All items now have slugs!");
    }
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

regenerateAllSlugs();
