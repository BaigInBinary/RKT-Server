import request from 'supertest';
import app from '../app';

describe('Sub-Category API', () => {
  let createdCategoryId: string;
  let createdSubCategoryId: string;
  const testCategoryName = `Test Category ${Date.now()}`;
  const testSubCategoryName = `Test Sub Category ${Date.now()}`;

  beforeAll(async () => {
    const categoryResponse = await request(app)
      .post('/api/categories')
      .send({ name: testCategoryName });

    createdCategoryId = categoryResponse.body.id;
  });

  describe('POST /api/sub-categories', () => {
    it('should create a new sub-category linked to a category', async () => {
      const response = await request(app).post('/api/sub-categories').send({
        name: testSubCategoryName,
        categoryId: createdCategoryId,
      });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe(testSubCategoryName);
      expect(response.body.categoryId).toBe(createdCategoryId);
      createdSubCategoryId = response.body.id;
    });

    it('should fail to create duplicate sub-category in same category', async () => {
      const response = await request(app).post('/api/sub-categories').send({
        name: testSubCategoryName,
        categoryId: createdCategoryId,
      });

      expect(response.status).toBe(409);
    });
  });

  describe('GET /api/sub-categories', () => {
    it('should get all sub-categories', async () => {
      const response = await request(app).get('/api/sub-categories');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('should filter sub-categories by categoryId', async () => {
      const response = await request(app).get(
        `/api/sub-categories?categoryId=${createdCategoryId}`,
      );

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(
        response.body.every(
          (subCategory: { categoryId: string }) =>
            subCategory.categoryId === createdCategoryId,
        ),
      ).toBe(true);
    });
  });

  describe('GET /api/sub-categories/:id', () => {
    it('should get a single sub-category by id', async () => {
      const response = await request(app).get(
        `/api/sub-categories/${createdSubCategoryId}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(createdSubCategoryId);
      expect(response.body.name).toBe(testSubCategoryName);
    });

    it('should return 404 for non-existent sub-category', async () => {
      const response = await request(app).get(
        '/api/sub-categories/000000000000000000000000',
      );

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Sub-category not found');
    });
  });

  describe('PUT /api/sub-categories/:id', () => {
    it('should update a sub-category', async () => {
      const updatedData = {
        name: `Updated Sub Category ${Date.now()}`,
      };

      const response = await request(app)
        .put(`/api/sub-categories/${createdSubCategoryId}`)
        .send(updatedData);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(createdSubCategoryId);
      expect(response.body.name).toBe(updatedData.name);
    });
  });

  describe('DELETE /api/sub-categories/:id', () => {
    it('should delete a sub-category', async () => {
      const response = await request(app).delete(
        `/api/sub-categories/${createdSubCategoryId}`,
      );

      expect(response.status).toBe(204);
    });

    it('should fail to delete non-existent sub-category', async () => {
      const response = await request(app).delete(
        '/api/sub-categories/000000000000000000000000',
      );

      expect(response.status).toBe(404);
    });
  });

  afterAll(async () => {
    if (createdCategoryId) {
      await request(app).delete(`/api/categories/${createdCategoryId}`);
    }
  });
});
