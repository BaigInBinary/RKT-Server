import request from "supertest";
import app from "../app";

describe("Category API", () => {
  let createdCategoryId: string;
  const testCategoryName = `Test Category ${Date.now()}`;

  describe("POST /api/categories", () => {
    it("should create a new category", async () => {
      const response = await request(app)
        .post("/api/categories")
        .send({ name: testCategoryName });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("id");
      expect(response.body.name).toBe(testCategoryName);
      createdCategoryId = response.body.id;
    });

    it("should fail to create duplicate category", async () => {
      const response = await request(app)
        .post("/api/categories")
        .send({ name: testCategoryName });

      expect(response.status).toBe(409);
    });
  });

  describe("GET /api/categories", () => {
    it("should get all categories", async () => {
      const response = await request(app).get("/api/categories");

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });
  });

  describe("GET /api/categories/:id", () => {
    it("should get a single category by id", async () => {
      const response = await request(app).get(
        `/api/categories/${createdCategoryId}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(createdCategoryId);
      expect(response.body.name).toBe(testCategoryName);
    });

    it("should return 404 for non-existent category", async () => {
      const response = await request(app).get(
        "/api/categories/000000000000000000000000",
      );

      expect(response.status).toBe(404);
      expect(response.body.message).toBe("Category not found");
    });
  });

  describe("PUT /api/categories/:id", () => {
    it("should update a category", async () => {
      const updatedData = {
        name: `Updated Category ${Date.now()}`,
      };

      const response = await request(app)
        .put(`/api/categories/${createdCategoryId}`)
        .send(updatedData);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(createdCategoryId);
      expect(response.body.name).toBe(updatedData.name);
    });
  });

  describe("DELETE /api/categories/:id", () => {
    it("should delete a category", async () => {
      const response = await request(app).delete(
        `/api/categories/${createdCategoryId}`,
      );

      expect(response.status).toBe(204);
    });

    it("should fail to delete non-existent category", async () => {
      const response = await request(app).delete(
        "/api/categories/000000000000000000000000",
      );

      expect(response.status).toBe(404);
    });
  });
});
