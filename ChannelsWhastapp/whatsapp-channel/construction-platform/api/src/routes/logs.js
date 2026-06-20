// Daily log routes. Workers (assigned) and founders post; customers, assigned
// workers, and founders read. All access is project-scoped.

import { requireRole } from '../middleware/requireRole.js';
import { getProject, canAccessProject } from '../models/project.js';
import { createLog, listLogs } from '../models/dailyLog.js';

export async function logRoutes(app) {
  // Post a daily log — worker (assigned) or founder.
  app.post('/projects/:id/logs', { preHandler: requireRole('worker', 'founder') },
    async (req, reply) => {
      const project = await getProject(req.params.id);
      if (!project || !canAccessProject(req.user, project)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const log = await createLog({
        projectId: project.id,
        authorPhone: req.user.phone,
        ...req.body,
      });
      return reply.code(201).send(log);
    });

  // Read logs — customer/worker/founder, scoped to projects they can access.
  app.get('/projects/:id/logs', { preHandler: requireRole('customer', 'worker', 'founder') },
    async (req, reply) => {
      const project = await getProject(req.params.id);
      if (!project || !canAccessProject(req.user, project)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return listLogs(project.id);
    });
}
