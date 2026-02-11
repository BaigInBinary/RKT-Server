import app from './app';

const PORT = process.env.PORT || 3000;

// Only start the server in non-serverless environments
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Export for Vercel serverless
export default app;
