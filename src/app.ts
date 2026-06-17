import express, { type Application } from 'express';
import cors from 'cors';
import { errorHandler } from './middlewares/errorMiddleware';

import itemRoutes from './routes/itemRoutes';
import authRoutes from './routes/authRoutes';
import categoryRoutes from './routes/categoryRoutes';
import subCategoryRoutes from './routes/subCategoryRoutes';
import saleRoutes from './routes/saleRoutes';
import favoriteRoutes from './routes/favoriteRoutes';
import discountRoutes from "./routes/discountRoutes";
import siteContentRoutes from "./routes/siteContentRoutes";
import collectionRoutes from "./routes/collectionRoutes";
import deliveryRateRoutes from "./routes/deliveryRateRoutes";
import paymentRoutes from "./routes/paymentRoutes";
import deliveryRoutes from "./routes/deliveryRoutes";
import courierRoutes from "./routes/courierRoutes";
import leopardsRoutes from "./routes/leopardsRoutes";
import leopardsConfigRoutes from "./routes/leopardsConfigRoutes";
import mnpRoutes from "./routes/mnpRoutes";
import mnpConfigRoutes from "./routes/mnpConfigRoutes";
import mediaRoutes from "./routes/mediaRoutes";

const app: Application = express();

// Middlewares
app.use(cors());
// Variant-heavy items can produce larger payloads than Express's default 100kb cap.
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// Health Check
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/sub-categories', subCategoryRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use("/api/discounts", discountRoutes);
app.use("/api/site-content", siteContentRoutes);
app.use("/api/collections", collectionRoutes);
app.use("/api/delivery-rate", deliveryRateRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/delivery", deliveryRoutes);
app.use("/api/courier", courierRoutes);
app.use("/api/leopards", leopardsRoutes);
app.use("/api/leopards-config", leopardsConfigRoutes);
app.use("/api/mnp", mnpRoutes);
app.use("/api/mnp-config", mnpConfigRoutes);
app.use("/api/media", mediaRoutes);

// Error Handler
app.use(errorHandler);


export default app;
