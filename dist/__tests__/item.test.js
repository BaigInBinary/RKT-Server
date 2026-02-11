"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const app_1 = __importDefault(require("../app"));
describe("Item API", () => {
    let createdItemId;
    const testItem = {
        name: `Test Item ${Date.now()}`,
        sku: `SKU-${Date.now()}`,
        category: "Electronics",
        price: 99.99,
        costPrice: 50.0,
        quantity: 100,
        minStock: 10,
        supplier: "Test Supplier",
    };
    describe("POST /api/items", () => {
        it("should create a new item", async () => {
            const response = await (0, supertest_1.default)(app_1.default).post("/api/items").send(testItem);
            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty("id");
            expect(response.body.name).toBe(testItem.name);
            expect(response.body.sku).toBe(testItem.sku);
            expect(response.body.price).toBe(testItem.price);
            expect(response.body.quantity).toBe(testItem.quantity);
            createdItemId = response.body.id;
        });
        it("should fail to create item with duplicate SKU", async () => {
            const response = await (0, supertest_1.default)(app_1.default).post("/api/items").send(testItem);
            expect(response.status).toBe(500); // Prisma unique constraint error
        });
    });
    describe("GET /api/items", () => {
        it("should get all items", async () => {
            const response = await (0, supertest_1.default)(app_1.default).get("/api/items");
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
            expect(response.body.length).toBeGreaterThan(0);
        });
    });
    describe("GET /api/items/:id", () => {
        it("should get a single item by id", async () => {
            const response = await (0, supertest_1.default)(app_1.default).get(`/api/items/${createdItemId}`);
            expect(response.status).toBe(200);
            expect(response.body.id).toBe(createdItemId);
            expect(response.body.name).toBe(testItem.name);
        });
        it("should return 404 for non-existent item", async () => {
            const response = await (0, supertest_1.default)(app_1.default).get("/api/items/000000000000000000000000");
            expect(response.status).toBe(404);
            expect(response.body.message).toBe("Item not found");
        });
    });
    describe("PUT /api/items/:id", () => {
        it("should update an item", async () => {
            const updatedData = {
                name: "Updated Test Item",
                price: 149.99,
                quantity: 200,
            };
            const response = await (0, supertest_1.default)(app_1.default)
                .put(`/api/items/${createdItemId}`)
                .send(updatedData);
            expect(response.status).toBe(200);
            expect(response.body.name).toBe(updatedData.name);
            expect(response.body.price).toBe(updatedData.price);
            expect(response.body.quantity).toBe(updatedData.quantity);
        });
    });
    describe("GET /api/items/alerts", () => {
        it("should get stock alerts", async () => {
            const response = await (0, supertest_1.default)(app_1.default).get("/api/items/alerts");
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
        });
    });
    describe("DELETE /api/items/:id", () => {
        it("should delete an item", async () => {
            const response = await (0, supertest_1.default)(app_1.default).delete(`/api/items/${createdItemId}`);
            expect(response.status).toBe(204);
        });
    });
});
//# sourceMappingURL=item.test.js.map