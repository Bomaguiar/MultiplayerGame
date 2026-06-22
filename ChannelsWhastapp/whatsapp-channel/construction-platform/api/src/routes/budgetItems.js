import { requireRole } from '../middleware/requireRole.js';
import { getProject, canAccessProject } from '../models/project.js';
import {
  createBudgetItem, updateBudgetItem, listBudgetItems,
  deleteBudgetItem, budgetBreakdown,
} from '../models/budgetItem.js';

export async function budgetItemRoutes(app) {
  app.post('/projects/:id/budget-items', { preHandler: requireRole('founder') },
    async (req, reply) => {
      const project = await getProject(req.params.id);
      if (!project) return reply.code(404).send({ error: 'not_found' });
      const { category, description } = req.body || {};
      if (!category || !description) {
        return reply.code(400).send({ error: 'category and description are required' });
      }
      const item = await createBudgetItem({ projectId: project.id, ...req.body });
      return reply.code(201).send(item);
    });

  app.get('/projects/:id/budget-items', { preHandler: requireRole('customer', 'founder') },
    async (req, reply) => {
      const project = await getProject(req.params.id);
      if (!project || !canAccessProject(req.user, project)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return listBudgetItems(project.id);
    });

  app.get('/projects/:id/budget-breakdown', { preHandler: requireRole('customer', 'founder') },
    async (req, reply) => {
      const project = await getProject(req.params.id);
      if (!project || !canAccessProject(req.user, project)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return budgetBreakdown(project.id);
    });

  app.patch('/budget-items/:itemId', { preHandler: requireRole('founder') },
    async (req, reply) => {
      const updated = await updateBudgetItem(req.params.itemId, req.body || {});
      if (!updated) return reply.code(404).send({ error: 'not_found' });
      return updated;
    });

  app.delete('/budget-items/:itemId', { preHandler: requireRole('founder') },
    async (req, reply) => {
      const deleted = await deleteBudgetItem(req.params.itemId);
      if (!deleted) return reply.code(404).send({ error: 'not_found' });
      return deleted;
    });
}
