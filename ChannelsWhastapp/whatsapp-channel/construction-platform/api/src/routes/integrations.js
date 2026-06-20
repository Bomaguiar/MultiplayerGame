import { requireRole } from '../middleware/requireRole.js';
import { getProject } from '../models/project.js';
import { syncClickUpBatch, listClickUpTasks } from '../integrations/clickup.js';
import { getNotificationLog } from '../integrations/notifications.js';

export async function integrationRoutes(app) {
  app.post('/projects/:id/sync/clickup', { preHandler: requireRole('founder') },
    async (req, reply) => {
      const project = await getProject(req.params.id);
      if (!project) return reply.code(404).send({ error: 'not_found' });
      const tasks = req.body?.tasks;
      if (!Array.isArray(tasks)) return reply.code(400).send({ error: 'tasks array required' });
      const results = await syncClickUpBatch(project.id, tasks);
      return results;
    });

  app.get('/projects/:id/tasks/clickup', { preHandler: requireRole('customer', 'worker', 'founder') },
    async (req, reply) => {
      const project = await getProject(req.params.id);
      if (!project) return reply.code(404).send({ error: 'not_found' });
      return listClickUpTasks(project.id);
    });

  app.get('/notifications', { preHandler: requireRole('founder') },
    async () => getNotificationLog());
}
