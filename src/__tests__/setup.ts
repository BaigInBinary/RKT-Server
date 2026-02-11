import prisma from "../config/prisma";

beforeAll(async () => {
  // Connect to the database
  await prisma.$connect();
});

afterAll(async () => {
  // Disconnect from the database
  await prisma.$disconnect();
});
