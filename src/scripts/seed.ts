import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting database seed...\n");

  // Clear existing data
  console.log("🗑️  Clearing existing data...");
  await prisma.sale.deleteMany();
  await prisma.item.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  console.log("✅ Existing data cleared\n");

  // Seed User
  console.log("👤 Creating user...");
  const user = await prisma.user.create({
    data: {
      email: "admin@store.com",
      password: "admin123",
      name: "Store Admin",
    },
  });
  console.log(`✅ User created: ${user.email}\n`);

  // Seed Categories
  console.log("📁 Creating categories...");
  const categories = [
    "Groceries",
    "Beverages",
    "Stationery",
    "Electronics",
    "Clothing",
  ];
  for (const name of categories) {
    await prisma.category.create({
      data: { name },
    });
    console.log(`   ✅ Category: ${name}`);
  }
  console.log("");

  // Seed Items
  console.log("📦 Creating items...");
  const items = [
    {
      name: "Basmati Rice 5kg",
      sku: "RICE001",
      category: "Groceries",
      price: 1200,
      costPrice: 950,
      quantity: 45,
      minStock: 10,
      supplier: "Pak Foods Ltd",
    },
    {
      name: "Coca Cola 1.5L",
      sku: "COLA001",
      category: "Beverages",
      price: 150,
      costPrice: 120,
      quantity: 8,
      minStock: 15,
      supplier: "Coca Cola Pakistan",
    },
    {
      name: "Notebook A4",
      sku: "NOTE001",
      category: "Stationery",
      price: 80,
      costPrice: 55,
      quantity: 25,
      minStock: 5,
      supplier: "Star Stationery",
    },
    {
      name: "Samsung Galaxy Earbuds",
      sku: "EARB001",
      category: "Electronics",
      price: 15000,
      costPrice: 12000,
      quantity: 3,
      minStock: 2,
      supplier: "Samsung Pakistan",
    },
    {
      name: "Cotton T-Shirt",
      sku: "TSHI001",
      category: "Clothing",
      price: 800,
      costPrice: 550,
      quantity: 15,
      minStock: 5,
      supplier: "Fashion Hub",
    },
    {
      name: "Cooking Oil 1L",
      sku: "OIL001",
      category: "Groceries",
      price: 350,
      costPrice: 280,
      quantity: 30,
      minStock: 8,
      supplier: "Golden Oil Co",
    },
    {
      name: "Pepsi 250ml",
      sku: "PEPSI001",
      category: "Beverages",
      price: 50,
      costPrice: 35,
      quantity: 120,
      minStock: 20,
      supplier: "PepsiCo Pakistan",
    },
    {
      name: "Ball Point Pen",
      sku: "PEN001",
      category: "Stationery",
      price: 25,
      costPrice: 15,
      quantity: 2,
      minStock: 10,
      supplier: "Dollar Pens",
    },
  ];

  const createdItems: Record<string, string> = {};
  for (const item of items) {
    const created = await prisma.item.create({
      data: item,
    });
    createdItems[item.sku] = created.id;
    console.log(`   ✅ Item: ${item.name} (${item.sku})`);
  }
  console.log("");

  // Seed Sales
  console.log("💰 Creating sales...");
  const sales = [
    {
      items: [
        {
          itemId: createdItems["RICE001"],
          name: "Basmati Rice 5kg",
          price: 1200,
          quantity: 2,
          total: 2400,
        },
        {
          itemId: createdItems["NOTE001"],
          name: "Notebook A4",
          price: 80,
          quantity: 5,
          total: 400,
        },
      ],
      subtotal: 2800,
      tax: 140,
      discount: 0,
      total: 2940,
      date: new Date("2024-06-01T10:30:00+05:00"),
      customerName: "Ahmed Khan",
    },
    {
      items: [
        {
          itemId: createdItems["COLA001"],
          name: "Coca Cola 1.5L",
          price: 150,
          quantity: 4,
          total: 600,
        },
        {
          itemId: createdItems["PEPSI001"],
          name: "Pepsi 250ml",
          price: 50,
          quantity: 6,
          total: 300,
        },
      ],
      subtotal: 900,
      tax: 45,
      discount: 50,
      total: 895,
      date: new Date("2024-06-01T14:15:00+05:00"),
      customerName: "Fatima Ali",
    },
    {
      items: [
        {
          itemId: createdItems["EARB001"],
          name: "Samsung Galaxy Earbuds",
          price: 15000,
          quantity: 1,
          total: 15000,
        },
      ],
      subtotal: 15000,
      tax: 750,
      discount: 500,
      total: 15250,
      date: new Date("2024-06-02T09:45:00+05:00"),
      customerName: "Usman Sheikh",
    },
    {
      items: [
        {
          itemId: createdItems["TSHI001"],
          name: "Cotton T-Shirt",
          price: 800,
          quantity: 3,
          total: 2400,
        },
        {
          itemId: createdItems["PEN001"],
          name: "Ball Point Pen",
          price: 25,
          quantity: 10,
          total: 250,
        },
      ],
      subtotal: 2650,
      tax: 132.5,
      discount: 100,
      total: 2682.5,
      date: new Date("2024-06-02T16:20:00+05:00"),
      customerName: "Sara Malik",
    },
    {
      items: [
        {
          itemId: createdItems["OIL001"],
          name: "Cooking Oil 1L",
          price: 350,
          quantity: 2,
          total: 700,
        },
        {
          itemId: createdItems["RICE001"],
          name: "Basmati Rice 5kg",
          price: 1200,
          quantity: 1,
          total: 1200,
        },
      ],
      subtotal: 1900,
      tax: 95,
      discount: 0,
      total: 1995,
      date: new Date("2024-06-03T11:10:00+05:00"),
      customerName: "Hassan Raza",
    },
  ];

  for (let i = 0; i < sales.length; i++) {
    const sale = sales[i];
    await prisma.sale.create({
      data: sale,
    });
    console.log(
      `   ✅ Sale #${i + 1}: ${sale.customerName} - Rs. ${sale.total}`,
    );
  }
  console.log("");

  // Summary
  console.log("=".repeat(50));
  console.log("📊 SEED SUMMARY");
  console.log("=".repeat(50));
  console.log(`   Users:      1`);
  console.log(`   Categories: ${categories.length}`);
  console.log(`   Items:      ${items.length}`);
  console.log(`   Sales:      ${sales.length}`);
  console.log("=".repeat(50));
  console.log("\n✅ Database seeded successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
