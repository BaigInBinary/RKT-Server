import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { errorHandler } from './middlewares/errorMiddleware';

import authRoutes from './routes/authRoutes';
import itemRoutes from './routes/itemRoutes';
import categoryRoutes from './routes/categoryRoutes';
import saleRoutes from './routes/saleRoutes';

dotenv.config();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health Check
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/sales', saleRoutes);

// Error Handler
app.use(errorHandler);


export default app;
