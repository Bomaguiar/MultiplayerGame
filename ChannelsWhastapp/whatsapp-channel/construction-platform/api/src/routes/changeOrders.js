import { requireRole } from '../middleware/requireRole.js';
import { getProject, canAccessProject } from '../models/project.js';
import {
  createChangeOrder, getChangeOrder, listChangeOrders,
  decideChangeOrder, cancelChangeOrder, budgetSummary,
} from '../models/changeOrder.js';

export async function changeOrderRoutes(app) {
  app.post('/projects/:id/change-orders', { preHandler: requireRole('founder') },
    async (req, reply) => {
      const project = await getProject(req.params.id);
      if (!project) return reply.code(404).send({ error: 'not_found' });
      if (!req.body?.title) return reply.code(400).send({ error: 'title required' });
      const co = await createChangeOrder({
        projectId: project.id, proposedBy: req.user.phone, ...req.body,
      });
      return reply.code(201).send(co);
    });

  app.get('/projects/:id/change-orders', { preHandler: requireRole('customer', 'worker', 'founder') },
    async (req, reply) => {
      const project = await getProject(req.params.id);
      if (!project || !canAccessProject(req.user, project)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return listChangeOrders({ projectId: project.id, status: req.query?.status ?? null });
    });

  app.get('/projects/:id/budget', { preHandler: requireRole('customer', 'founder') },
    async (req, reply) => {
      const project = await getProject(req.params.id);
      if (!project || !canAccessProject(req.user, project)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const summary = await budgetSummary(project.id);
      return summary || { current_budget: 0, approved_changes: 0, pending_changes: 0, pending_count: 0, approved_count: 0 };
    });

  app.patch('/change-orders/:coId/decision', { preHandler: requireRole('customer') },
    async (req, reply) => {
      const co = await getChangeOrder(req.params.coId);
      if (!co) return reply.code(404).send({ error: 'not_found' });
      const project = await getProject(co.project_id);
      if (!project || !canAccessProject(req.user, project)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      try {
        const updated = await decideChangeOrder(co.id, req.body?.decision, req.user.phone);
        return updated;
      } catch (e) {
        return reply.code(400).send({ error: String(e.message || e) });
      }
    });

  app.patch('/change-orders/:coId/cancel', { preHandler: requireRole('founder') },
    async (req, reply) => {
      const co = await cancelChangeOrder(req.params.coId);
      if (!co) return reply.code(404).send({ error: 'not_found' });
      return co;
    });
}
