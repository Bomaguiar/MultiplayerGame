// Material request routes. Workers (assigned) raise requests; founders decide
// and track procurement.

import { requireRole } from '../middleware/requireRole.js';
import { getProject, canAccessProject } from '../models/project.js';
import { createRequest, getRequest, decideRequest, markDelivered, listRequests } from '../models/material.js';

export async function materialRoutes(app) {
  // Raise a request — assigned worker (or founder).
  app.post('/projects/:id/materials', { preHandler: requireRole('worker', 'founder') },
    async (req, reply) => {
      const project = await getProject(req.params.id);
      if (!project || !canAccessProject(req.user, project)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (!req.body?.item) return reply.code(400).send({ error: 'item required' });
      const r = await createRequest({ projectId: project.id, requestedBy: req.user.phone, ...req.body });
      return reply.code(201).send(r);
    });

  // List requests for a project — scoped. Optional ?status= filter.
  app.get('/projects/:id/materials', { preHandler: requireRole('customer', 'worker', 'founder') },
    async (req, reply) => {
      const project = await getProject(req.params.id);
      if (!project || !canAccessProject(req.user, project)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return listRequests({ projectId: project.id, status: req.query?.status ?? null });
    });

  // Approve/deny — founder only. Approval moves it to 'ordered'.
  app.patch('/materials/:reqId/decision', { preHandler: requireRole('founder') },
    async (req, reply) => {
      const existing = await getRequest(req.params.reqId);
      if (!existing) return reply.code(404).send({ error: 'not_found' });
      try {
        const r = await decideRequest(existing.id, req.body?.decision, req.user.phone);
        return r;
      } catch (e) {
        return reply.code(400).send({ error: String(e.message || e) });
      }
    });

  // Mark delivered — founder only.
  app.patch('/materials/:reqId/delivered', { preHandler: requireRole('founder') },
    async (req, reply) => {
      const r = await markDelivered(req.params.reqId);
      if (!r) return reply.code(404).send({ error: 'not_found' });
      return r;
    });
}
