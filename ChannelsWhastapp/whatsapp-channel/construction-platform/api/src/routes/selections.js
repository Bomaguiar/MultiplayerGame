// Client selection routes (T16). Founder proposes; client (and team) can view;
// client approves with an e-signature or declines.

import { requireRole } from '../middleware/requireRole.js';
import { getProject, canAccessProject } from '../models/project.js';
import {
  createSelection, getSelection, listSelections, decideSelection,
} from '../models/selection.js';

export async function selectionRoutes(app) {
  // Founder proposes a selection for the client to decide.
  app.post('/projects/:id/selections', { preHandler: requireRole('founder') },
    async (req, reply) => {
      const project = await getProject(req.params.id);
      if (!project) return reply.code(404).send({ error: 'not_found' });
      if (!req.body?.name) return reply.code(400).send({ error: 'name required' });
      const sel = await createSelection({
        projectId: project.id, proposedBy: req.user.phone, ...req.body,
      });
      return reply.code(201).send(sel);
    });

  // List selections for a project — scoped. Optional ?status= filter.
  app.get('/projects/:id/selections', { preHandler: requireRole('customer', 'worker', 'founder') },
    async (req, reply) => {
      const project = await getProject(req.params.id);
      if (!project || !canAccessProject(req.user, project)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return listSelections({ projectId: project.id, status: req.query?.status ?? null });
    });

  // Client approves (with e-signature) or declines a selection.
  app.patch('/selections/:selId/decision', { preHandler: requireRole('customer') },
    async (req, reply) => {
      const sel = await getSelection(req.params.selId);
      if (!sel) return reply.code(404).send({ error: 'not_found' });
      const project = await getProject(sel.project_id);
      if (!project || !canAccessProject(req.user, project)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      try {
        const updated = await decideSelection(sel.id, req.body || {}, req.user.phone);
        return updated;
      } catch (e) {
        return reply.code(400).send({ error: String(e.message || e) });
      }
    });
}
