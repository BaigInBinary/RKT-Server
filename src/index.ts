import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../.env") });

import app from "./app";
import { ensureSuperAdminUser } from "./bootstrap/superAdmin";
import { ensureDefaultSiteContent } from "./bootstrap/siteContent";

const PORT = process.env.PORT || 5000;

const startServer = async () => {
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

  // For local development
  if (process.env.NODE_ENV !== "production") {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  }
};

void startServer();

// Export the Express app for Vercel serverless 
export default app;
