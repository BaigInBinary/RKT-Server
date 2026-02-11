"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const app_1 = __importDefault(require("../app"));
describe("Health Check API", () => {
    it("should return status OK", async () => {
        const response = await (0, supertest_1.default)(app_1.default).get("/api/health");
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            status: "OK",
            message: "Server is running",
        });
    });
});
describe("Auth API", () => {
    const testUser = {
        email: `test-${Date.now()}@example.com`,
        password: "testpassword123",
        name: "Test User",
    };
    describe("POST /api/auth/register", () => {
        it("should register a new user", async () => {
            const response = await (0, supertest_1.default)(app_1.default)
                .post("/api/auth/register")
                .send(testUser);
            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty("id");
            expect(response.body.email).toBe(testUser.email);
            expect(response.body.name).toBe(testUser.name);
        });
        it("should fail to register duplicate user", async () => {
            const response = await (0, supertest_1.default)(app_1.default)
                .post("/api/auth/register")
                .send(testUser);
            expect(response.status).toBe(400);
            expect(response.body.message).toBe("User already exists");
        });
    });
    describe("POST /api/auth/login", () => {
        it("should login with valid credentials", async () => {
            const response = await (0, supertest_1.default)(app_1.default).post("/api/auth/login").send({
                email: testUser.email,
                password: testUser.password,
            });
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty("id");
            expect(response.body.email).toBe(testUser.email);
        });
        it("should fail with invalid credentials", async () => {
            const response = await (0, supertest_1.default)(app_1.default).post("/api/auth/login").send({
                email: testUser.email,
                password: "wrongpassword",
            });
            expect(response.status).toBe(401);
            expect(response.body.message).toBe("Invalid credentials");
        });
        it("should fail with non-existent user", async () => {
            const response = await (0, supertest_1.default)(app_1.default).post("/api/auth/login").send({
                email: "nonexistent@example.com",
                password: "password123",
            });
            expect(response.status).toBe(401);
            expect(response.body.message).toBe("Invalid credentials");
        });
    });
});
//# sourceMappingURL=auth.test.js.map