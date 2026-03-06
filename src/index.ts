import app from "./app";
import { ensureSuperAdminUser } from "./bootstrap/superAdmin";
import { ensureDefaultSiteContent } from "./bootstrap/siteContent";

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await ensureSuperAdminUser();
  await ensureDefaultSiteContent();

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
