/**
 * Integration tests for tasks API
 * Tests CRUD operations, task assignment, completion, and movement
 */

import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../ProjectSourceCode/src/express/app.js';
import {
  createTestUser,
  generateTestEmail,
  getCsrfToken,
  loginAsUser,
  prepareTestDb,
  setCsrfHeadersIfEnabled,
} from '../setup/helpers/index.js';

describe('Tasks API', () => {
  let managerCookies: string = '';
  let memberCookies: string = '';
  let teamId: string;
  let boardId: string;
  let listId: string;
  let userId: string;

  beforeAll(async () => {
    await prepareTestDb();

    // Create fresh users for this test file
    const managerEmail = generateTestEmail('tasks-manager');
    const memberEmail = generateTestEmail('tasks-member');

    const _manager = await createTestUser(managerEmail, 'password123', 'manager', 'Manager User');
    const member = await createTestUser(memberEmail, 'password123', 'member', 'Member User');

    userId = member.user.id;

    const { cookieHeader: managerCookieHeader } = await loginAsUser(managerEmail, 'password123');
    managerCookies = managerCookieHeader;

    const { cookieHeader: memberCookieHeader } = await loginAsUser(memberEmail, 'password123');
    memberCookies = memberCookieHeader;

    // Create team, board, and list for tasks
    const { token: csrfToken } = await getCsrfToken(managerCookies);
    let req = request(app).post('/api/teams').set('Cookie', managerCookies);
    req = setCsrfHeadersIfEnabled(req, csrfToken);
    const teamResponse = await req.send({ name: 'Test Team' });
    expect(teamResponse.status, `Team creation failed: ${JSON.stringify(teamResponse.body)}`).toBe(
      201
    );
    teamId = teamResponse.body.id;

    // Add member to team so RLS allows them to access team resources
    const { token: memberCsrfToken } = await getCsrfToken(managerCookies);
    const memberResponse = await request(app)
      .post(`/api/teams/${teamId}/members`)
      .set('Cookie', managerCookies)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ user_id: userId });
    expect(memberResponse.status, `Add member failed: ${JSON.stringify(memberResponse.body)}`).toBe(
      201
    );

    const { token: boardCsrfToken } = await getCsrfToken(managerCookies);
    const boardResponse = await request(app)
      .post('/api/boards')
      .set('Cookie', managerCookies)
      .set('X-CSRF-Token', boardCsrfToken)
      .send({
        name: 'Test Board',
        team_id: teamId,
      });
    expect(
      boardResponse.status,
      `Board creation failed: ${JSON.stringify(boardResponse.body)}`
    ).toBe(201);
    boardId = boardResponse.body.id;

    const { token: listCsrfToken } = await getCsrfToken(managerCookies);
    const listResponse = await request(app)
      .post('/api/lists')
      .set('Cookie', managerCookies)
      .set('X-CSRF-Token', listCsrfToken)
      .send({
        name: 'Test List',
        board_id: boardId,
      });
    expect(listResponse.status, `List creation failed: ${JSON.stringify(listResponse.body)}`).toBe(
      201
    );
    listId = listResponse.body.id;
  });

  describe('GET /api/tasks/lists/:listId/tasks', () => {
    it('should return tasks for a list', async () => {
      const response = await request(app)
        .get(`/api/tasks/lists/${listId}/tasks`)
        .set('Cookie', memberCookies);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should require authentication', async () => {
      const response = await request(app).get(`/api/tasks/lists/${listId}/tasks`);

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/tasks/lists/:listId/tasks', () => {
    it('should create task as manager', async () => {
      const { token: csrfToken } = await getCsrfToken(managerCookies);
      let req = request(app).post(`/api/tasks/lists/${listId}/tasks`).set('Cookie', managerCookies);
      req = setCsrfHeadersIfEnabled(req, csrfToken);
      const response = await req.send({
        title: 'New Task',
        description: 'Task Description',
        story_points: 3,
      });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('title', 'New Task');
      expect(response.body).toHaveProperty('list_id', listId);
    });

    it('should reject task creation by member', async () => {
      const { token: csrfToken } = await getCsrfToken(memberCookies);
      let req = request(app).post(`/api/tasks/lists/${listId}/tasks`).set('Cookie', memberCookies);
      req = setCsrfHeadersIfEnabled(req, csrfToken);
      const response = await req.send({
        title: 'Member Task',
      });

      expect(response.status).toBe(403);
    });

    it('should validate required fields', async () => {
      const { token: csrfToken } = await getCsrfToken(managerCookies);
      let req = request(app).post(`/api/tasks/lists/${listId}/tasks`).set('Cookie', managerCookies);
      req = setCsrfHeadersIfEnabled(req, csrfToken);
      const response = await req.send({});

      expect(response.status).toBe(400);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post(`/api/tasks/lists/${listId}/tasks`)
        .send({ title: 'Unauthorized Task' });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/tasks/:id', () => {
    let taskId: string;

    beforeEach(async () => {
      const { token: csrfToken } = await getCsrfToken(managerCookies);
      let req = request(app).post(`/api/tasks/lists/${listId}/tasks`).set('Cookie', managerCookies);
      req = setCsrfHeadersIfEnabled(req, csrfToken);
      const createResponse = await req.send({
        title: 'Test Task',
      });

      taskId = createResponse.body.id;
    });

    it('should return task by id', async () => {
      const response = await request(app).get(`/api/tasks/${taskId}`).set('Cookie', memberCookies);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', taskId);
      expect(response.body).toHaveProperty('title', 'Test Task');
    });

    it('should return 404 for non-existent task', async () => {
      const response = await request(app)
        .get('/api/tasks/00000000-0000-0000-0000-000000000000')
        .set('Cookie', memberCookies);

      expect(response.status).toBe(404);
    });

    it('should require authentication', async () => {
      const response = await request(app).get(`/api/tasks/${taskId}`);

      expect(response.status).toBe(401);
    });
  });

  describe('PUT /api/tasks/:id', () => {
    let taskId: string;

    beforeEach(async () => {
      const { token: csrfToken } = await getCsrfToken(managerCookies);
      let req = request(app).post(`/api/tasks/lists/${listId}/tasks`).set('Cookie', managerCookies);
      req = setCsrfHeadersIfEnabled(req, csrfToken);
      const createResponse = await req.send({
        title: 'Original Task',
      });

      taskId = createResponse.body.id;
    });

    it('should update task as manager', async () => {
      const { token: csrfToken } = await getCsrfToken(managerCookies);
      let req = request(app).put(`/api/tasks/${taskId}`).set('Cookie', managerCookies);
      req = setCsrfHeadersIfEnabled(req, csrfToken);
      const response = await req.send({
        title: 'Updated Task',
        description: 'Updated Description',
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('title', 'Updated Task');
    });

    it('should reject update by member', async () => {
      const { token: csrfToken } = await getCsrfToken(memberCookies);
      let req = request(app).put(`/api/tasks/${taskId}`).set('Cookie', memberCookies);
      req = setCsrfHeadersIfEnabled(req, csrfToken);
      const response = await req.send({ title: 'Hacked Task' });

      expect(response.status).toBe(403);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .put(`/api/tasks/${taskId}`)
        .send({ title: 'Unauthorized Update' });

      expect(response.status).toBe(401);
    });
  });

  describe('PATCH /api/tasks/:id/assign', () => {
    let taskId: string;

    beforeEach(async () => {
      const { token: csrfToken } = await getCsrfToken(managerCookies);
      let req = request(app).post(`/api/tasks/lists/${listId}/tasks`).set('Cookie', managerCookies);
      req = setCsrfHeadersIfEnabled(req, csrfToken);
      const createResponse = await req.send({
        title: 'Task to Assign',
      });

      taskId = createResponse.body.id;
    });

    it('should assign task as manager', async () => {
      const { token: csrfToken } = await getCsrfToken(managerCookies);
      let req = request(app).patch(`/api/tasks/${taskId}/assign`).set('Cookie', managerCookies);
      req = setCsrfHeadersIfEnabled(req, csrfToken);
      const response = await req.send({
        assigned_to: userId,
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('assigned_to', userId);
    });

    it('should reject assignment by member', async () => {
      const { token: csrfToken } = await getCsrfToken(memberCookies);
      let req = request(app).patch(`/api/tasks/${taskId}/assign`).set('Cookie', memberCookies);
      req = setCsrfHeadersIfEnabled(req, csrfToken);
      const response = await req.send({
        assigned_to: userId,
      });

      expect(response.status).toBe(403);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .patch(`/api/tasks/${taskId}/assign`)
        .send({ assigned_to: userId });

      expect(response.status).toBe(401);
    });
  });

  describe('PATCH /api/tasks/:id/complete', () => {
    let taskId: string;

    beforeEach(async () => {
      const { token: csrfToken } = await getCsrfToken(managerCookies);
      let req = request(app).post(`/api/tasks/lists/${listId}/tasks`).set('Cookie', managerCookies);
      req = setCsrfHeadersIfEnabled(req, csrfToken);
      const createResponse = await req.send({
        title: 'Task to Complete',
        story_points: 5,
      });

      taskId = createResponse.body.id;

      // Assign task to member so they can complete it
      const { token: assignCsrfToken } = await getCsrfToken(managerCookies);
      let assignReq = request(app)
        .patch(`/api/tasks/${taskId}/assign`)
        .set('Cookie', managerCookies);
      assignReq = setCsrfHeadersIfEnabled(assignReq, assignCsrfToken);
      await assignReq.send({ assigned_to: userId });
    });

    it('should complete task and award points', async () => {
      const { token: csrfToken } = await getCsrfToken(memberCookies);
      let req = request(app).patch(`/api/tasks/${taskId}/complete`).set('Cookie', memberCookies);
      req = setCsrfHeadersIfEnabled(req, csrfToken);
      const response = await req;

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('completed_at');
      expect(response.body.completed_at).not.toBeNull();
    });

    it('should require authentication', async () => {
      const response = await request(app).patch(`/api/tasks/${taskId}/complete`);

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent task', async () => {
      const { token: csrfToken } = await getCsrfToken(memberCookies);
      let req = request(app)
        .patch('/api/tasks/00000000-0000-0000-0000-000000000000/complete')
        .set('Cookie', memberCookies);
      req = setCsrfHeadersIfEnabled(req, csrfToken);
      const response = await req;

      expect(response.status).toBe(404);
    });

    it('should return 403 if task belongs to another user', async () => {
      // Create a task assigned to a different user (manager, not member)
      const { token: createCsrfToken } = await getCsrfToken(managerCookies);
      let createReq = request(app)
        .post(`/api/tasks/lists/${listId}/tasks`)
        .set('Cookie', managerCookies);
      createReq = setCsrfHeadersIfEnabled(createReq, createCsrfToken);
      const createResponse = await createReq.send({
        title: "Manager's Task",
        story_points: 3,
      });
      const managerTaskId = createResponse.body.id;

      // Try to complete it as member (not assigned)
      const { token: csrfToken } = await getCsrfToken(memberCookies);
      let req = request(app)
        .patch(`/api/tasks/${managerTaskId}/complete`)
        .set('Cookie', memberCookies);
      req = setCsrfHeadersIfEnabled(req, csrfToken);
      const response = await req;

      expect(response.status).toBe(403);
    });

    it('should be idempotent - completing twice works, points awarded once', async () => {
      // Complete the task first time
      const { token: csrfToken1 } = await getCsrfToken(memberCookies);
      let req1 = request(app).patch(`/api/tasks/${taskId}/complete`).set('Cookie', memberCookies);
      req1 = setCsrfHeadersIfEnabled(req1, csrfToken1);
      const response1 = await req1;

      expect(response1.status).toBe(200);
      expect(response1.body.completed_at).not.toBeNull();

      // Get initial points
      const pointsResponse1 = await request(app).get('/api/points').set('Cookie', memberCookies);
      const initialPoints = pointsResponse1.body.reduce(
        (sum: number, p: { points: number }) => sum + p.points,
        0
      );

      // Complete the same task again
      const { token: csrfToken2 } = await getCsrfToken(memberCookies);
      let req2 = request(app).patch(`/api/tasks/${taskId}/complete`).set('Cookie', memberCookies);
      req2 = setCsrfHeadersIfEnabled(req2, csrfToken2);
      const response2 = await req2;

      expect(response2.status).toBe(200);
      expect(response2.body.completed_at).toBe(response1.body.completed_at);

      // Verify points weren't awarded again
      const pointsResponse2 = await request(app).get('/api/points').set('Cookie', memberCookies);
      const finalPoints = pointsResponse2.body.reduce(
        (sum: number, p: { points: number }) => sum + p.points,
        0
      );

      expect(finalPoints).toBe(initialPoints);
    });
  });

  describe('PATCH /api/tasks/:id/move', () => {
    let taskId: string;
    let targetListId: string;

    beforeEach(async () => {
      const { token: csrfToken } = await getCsrfToken(managerCookies);
      let req = request(app).post(`/api/tasks/lists/${listId}/tasks`).set('Cookie', managerCookies);
      req = setCsrfHeadersIfEnabled(req, csrfToken);
      const taskResponse = await req.send({
        title: 'Task to Move',
      });

      taskId = taskResponse.body.id;

      const { token: listCsrfToken } = await getCsrfToken(managerCookies);
      const listResponse = await request(app)
        .post('/api/lists')
        .set('Cookie', managerCookies)
        .set('X-CSRF-Token', listCsrfToken)
        .send({
          name: 'Target List',
          board_id: boardId,
        });

      targetListId = listResponse.body.id;
    });

    it('should move task as manager', async () => {
      const { token: csrfToken } = await getCsrfToken(managerCookies);
      let req = request(app).patch(`/api/tasks/${taskId}/move`).set('Cookie', managerCookies);
      req = setCsrfHeadersIfEnabled(req, csrfToken);
      const response = await req.send({
        list_id: targetListId,
        position: 0,
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('list_id', targetListId);
    });

    it('should reject move by member', async () => {
      const { token: csrfToken } = await getCsrfToken(memberCookies);
      let req = request(app).patch(`/api/tasks/${taskId}/move`).set('Cookie', memberCookies);
      req = setCsrfHeadersIfEnabled(req, csrfToken);
      const response = await req.send({
        list_id: targetListId,
        position: 0,
      });

      expect(response.status).toBe(403);
    });

    it('should require authentication', async () => {
      const response = await request(app).patch(`/api/tasks/${taskId}/move`).send({
        list_id: targetListId,
        position: 0,
      });

      expect(response.status).toBe(401);
    });
  });

  describe('DELETE /api/tasks/:id', () => {
    let taskId: string;

    beforeEach(async () => {
      const { token: csrfToken } = await getCsrfToken(managerCookies);
      let req = request(app).post(`/api/tasks/lists/${listId}/tasks`).set('Cookie', managerCookies);
      req = setCsrfHeadersIfEnabled(req, csrfToken);
      const createResponse = await req.send({
        title: 'Task to Delete',
      });

      taskId = createResponse.body.id;
    });

    it('should delete task as manager', async () => {
      const { token: csrfToken } = await getCsrfToken(managerCookies);
      let req = request(app).delete(`/api/tasks/${taskId}`).set('Cookie', managerCookies);
      req = setCsrfHeadersIfEnabled(req, csrfToken);
      const response = await req;

      expect(response.status).toBe(204);
    });

    it('should reject delete by member', async () => {
      const { token: csrfToken } = await getCsrfToken(memberCookies);
      let req = request(app).delete(`/api/tasks/${taskId}`).set('Cookie', memberCookies);
      req = setCsrfHeadersIfEnabled(req, csrfToken);
      const response = await req;

      expect(response.status).toBe(403);
    });

    it('should require authentication', async () => {
      const response = await request(app).delete(`/api/tasks/${taskId}`);

      expect(response.status).toBe(401);
    });
  });
});
