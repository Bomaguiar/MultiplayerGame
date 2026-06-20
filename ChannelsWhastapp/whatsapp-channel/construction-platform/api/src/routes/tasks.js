// Task routes. Founders create/assign; the assignee or a founder can change
// status. All project-scoped.

import { requireRole } from '../middleware/requireRole.js';
import { getProject, canAccessProject } from '../models/project.js';
import { createTask, getTask, listTasks, assignTask, setStatus, listHistory } from '../models/task.js';

export async function taskRoutes(app) {
  // Create + (optionally) assign a task — founder only.
  app.post('/projects/:id/tasks', { preHandler: requireRole('founder') }, async (req, reply) => {
    const project = await getProject(req.params.id);
    if (!project) return reply.code(404).send({ error: 'not_found' });
    if (!req.body || !req.body.title) return reply.code(400).send({ error: 'title required' });
    const task = await createTask({ projectId: project.id, ...req.body });
    return reply.code(201).send(task);
  });

  // List tasks for a project — scoped.
  app.get('/projects/:id/tasks', { preHandler: requireRole('customer', 'worker', 'founder') },
    async (req, reply) => {
      const project = await getProject(req.params.id);
      if (!project || !canAccessProject(req.user, project)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return listTasks(project.id);
    });

  // Reassign — founder only.
  app.patch('/tasks/:taskId/assign', { preHandler: requireRole('founder') }, async (req, reply) => {
    const updated = await assignTask(req.params.taskId, req.body?.assigneePhone ?? null);
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return updated;
  });

  // Change status — only the assignee or a founder/admin.
  app.patch('/tasks/:taskId/status', { preHandler: requireRole('worker', 'founder') },
    async (req, reply) => {
      const task = await getTask(req.params.taskId);
      if (!task) return reply.code(404).send({ error: 'not_found' });
      const isFounder = req.user.role === 'founder' || req.user.role === 'admin';
      if (!isFounder && task.assignee_phone !== req.user.phone) {
        return reply.code(403).send({ error: 'not_your_task' });
      }
      const { status } = req.body || {};
      try {
        const updated = await setStatus(task.id, status, req.user.phone);
        return updated;
      } catch (e) {
        return reply.code(400).send({ error: String(e.message || e) });
      }
    });

  // Audit trail.
  app.get('/tasks/:taskId/history', { preHandler: requireRole('worker', 'founder') },
    async (req) => listHistory(req.params.taskId));
}
