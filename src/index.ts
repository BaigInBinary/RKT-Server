import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../.env") });

import app from "./app";
import { ensureSuperAdminUser } from "./bootstrap/superAdmin";
import { ensureDefaultSiteContent } from "./bootstrap/siteContent";
import prisma from "./config/prisma";

const PORT = process.env.PORT || 5000;
const isServerlessRuntime =
  process.env.VERCEL === "1" ||
  process.env.VERCEL === "true" ||
  !!process.env.AWS_LAMBDA_FUNCTION_NAME;

const startServer = async () => {
  try {
    const dbUrl = process.env.DATABASE_URL || "";
    const dbName = dbUrl.split("/").pop()?.split("?")[0] || "unknown_db";
    const itemCount = await prisma.item.count();
    console.log(`[startup] DB: ${dbName}, items: ${itemCount}`);
  } catch (error) {
    console.warn("[startup] Could not read item count:", error);
  }

  const bootstrapJobs = [
    { label: "super admin user", run: ensureSuperAdminUser() },
    { label: "default site content", run: ensureDefaultSiteContent() },
  ];

  const bootstrapResults = await Promise.allSettled(
    bootstrapJobs.map(({ run }) => run),
  );

  bootstrapResults.forEach((result, index) => {
    if (result.status === "rejected") {
      console.warn(
        `Bootstrap skipped for ${bootstrapJobs[index]?.label ?? "unknown step"}:`,
        result.reason,
      );
    }
  });

  if (isServerlessRuntime) {
    console.log("[startup] Serverless runtime detected, skipping app.listen");
    return;
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

void startServer();

// Export the Express app for Vercel serverless 
export default app;
