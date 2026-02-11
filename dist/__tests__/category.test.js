"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const app_1 = __importDefault(require("../app"));
describe("Category API", () => {
    let createdCategoryId;
    const testCategoryName = `Test Category ${Date.now()}`;
    describe("POST /api/categories", () => {
        it("should create a new category", async () => {
            const response = await (0, supertest_1.default)(app_1.default)
                .post("/api/categories")
                .send({ name: testCategoryName });
            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty("id");
            expect(response.body.name).toBe(testCategoryName);
            createdCategoryId = response.body.id;
        });
        it("should fail to create duplicate category", async () => {
            const response = await (0, supertest_1.default)(app_1.default)
                .post("/api/categories")
                .send({ name: testCategoryName });
            expect(response.status).toBe(500); // Prisma unique constraint error
        });
    });
    describe("GET /api/categories", () => {
        it("should get all categories", async () => {
            const response = await (0, supertest_1.default)(app_1.default).get("/api/categories");
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
            expect(response.body.length).toBeGreaterThan(0);
        });
    });
    describe("DELETE /api/categories/:id", () => {
        it("should delete a category", async () => {
            const response = await (0, supertest_1.default)(app_1.default).delete(`/api/categories/${createdCategoryId}`);
            expect(response.status).toBe(204);
        });
        it("should fail to delete non-existent category", async () => {
            const response = await (0, supertest_1.default)(app_1.default).delete("/api/categories/000000000000000000000000");
            expect(response.status).toBe(500); // Prisma not found error
        });
    });
});
//# sourceMappingURL=category.test.js.map