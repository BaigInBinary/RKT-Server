"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const app_1 = __importDefault(require("../app"));
describe('Sale API', () => {
    let createdItemId;
    let createdSaleId;
    // First, create an item to use in sales
    beforeAll(async () => {
        const itemResponse = await (0, supertest_1.default)(app_1.default)
            .post('/api/items')
            .send({
            name: `Sale Test Item ${Date.now()}`,
            sku: `SALE-SKU-${Date.now()}`,
            category: 'Electronics',
            price: 50.00,
            costPrice: 25.00,
            quantity: 100,
            minStock: 10,
            supplier: 'Test Supplier',
        });
        createdItemId = itemResponse.body.id;
    });
    describe('POST /api/sales', () => {
        it('should create a new sale and update stock', async () => {
            const saleData = {
                items: [
                    {
                        itemId: createdItemId,
                        name: 'Sale Test Item',
                        price: 50.00,
                        quantity: 2,
                        total: 100.00,
                    },
                ],
                subtotal: 100.00,
                tax: 10.00,
                discount: 5.00,
                total: 105.00,
                customerName: 'Test Customer',
            };
            const response = await (0, supertest_1.default)(app_1.default)
                .post('/api/sales')
                .send(saleData);
            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty('id');
            expect(response.body.total).toBe(saleData.total);
            expect(response.body.items).toHaveLength(1);
            createdSaleId = response.body.id;
            // Verify stock was updated
            const itemResponse = await (0, supertest_1.default)(app_1.default).get(`/api/items/${createdItemId}`);
            expect(itemResponse.body.quantity).toBe(98); // 100 - 2
        });
    });
    describe('GET /api/sales', () => {
        it('should get all sales', async () => {
            const response = await (0, supertest_1.default)(app_1.default).get('/api/sales');
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
            expect(response.body.length).toBeGreaterThan(0);
        });
    });
    describe('GET /api/sales/analytics', () => {
        it('should get sales analytics for a date range', async () => {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 1);
            const response = await (0, supertest_1.default)(app_1.default)
                .get('/api/sales/analytics')
                .query({
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
            });
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('totalSales');
            expect(response.body).toHaveProperty('totalRevenue');
            expect(response.body).toHaveProperty('sales');
            expect(response.body.totalSales).toBeGreaterThan(0);
        });
        it('should return empty analytics for future date range', async () => {
            const startDate = new Date();
            startDate.setFullYear(startDate.getFullYear() + 1);
            const endDate = new Date();
            endDate.setFullYear(endDate.getFullYear() + 2);
            const response = await (0, supertest_1.default)(app_1.default)
                .get('/api/sales/analytics')
                .query({
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
            });
            expect(response.status).toBe(200);
            expect(response.body.totalSales).toBe(0);
            expect(response.body.totalRevenue).toBe(0);
        });
    });
    // Cleanup
    afterAll(async () => {
        // Delete the test item
        if (createdItemId) {
            await (0, supertest_1.default)(app_1.default).delete(`/api/items/${createdItemId}`);
        }
    });
});
//# sourceMappingURL=sale.test.js.map