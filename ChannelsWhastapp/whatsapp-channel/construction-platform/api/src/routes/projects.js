// Project / phase / milestone routes, role-gated.
//
// Founders write; customers read their own; workers read assigned. Reads on a
// project the caller can't access return 404 (don't leak existence).

import { requireRole } from '../middleware/requireRole.js';
import {
  createProject, getProject, listProjectsForUser, updateProject,
  createPhase, listPhases, createMilestone, listMilestones, canAccessProject,
} from '../models/project.js';

export async function projectRoutes(app) {
  // Create a project — founders/admin only.
  app.post('/projects', { preHandler: requireRole('founder') }, async (req, reply) => {
    const { name, clientPhone } = req.body || {};
    if (!name || !clientPhone) {
      return reply.code(400).send({ error: 'name and clientPhone are required' });
    }
    const project = await createProject(req.body);
    return reply.code(201).send(project);
  });

  // List projects visible to the caller.
  app.get('/projects', { preHandler: requireRole('customer', 'worker', 'founder') },
    async (req) => listProjectsForUser(req.user));

  // Read one project — scoped.
  app.get('/projects/:id', { preHandler: requireRole('customer', 'worker', 'founder') },
    async (req, reply) => {
      const project = await getProject(req.params.id);
      if (!project || !canAccessProject(req.user, project)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return project;
    });

  // Update a project — founders/admin only.
  app.patch('/projects/:id', { preHandler: requireRole('founder') }, async (req, reply) => {
    const updated = await updateProject(req.params.id, req.body || {});
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return updated;
  });

  // Phases.
  app.post('/projects/:id/phases', { preHandler: requireRole('founder') }, async (req, reply) => {
    const project = await getProject(req.params.id);
    if (!project) return reply.code(404).send({ error: 'not_found' });
    const phase = await createPhase({ projectId: project.id, ...req.body });
    return reply.code(201).send(phase);
  });

  app.get('/projects/:id/phases', { preHandler: requireRole('customer', 'worker', 'founder') },
    async (req, reply) => {
      const project = await getProject(req.params.id);
      if (!project || !canAccessProject(req.user, project)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return listPhases(project.id);
    });

  // Milestones (nested under a phase).
  app.post('/phases/:phaseId/milestones', { preHandler: requireRole('founder') },
    async (req, reply) => {
      const ms = await createMilestone({ phaseId: req.params.phaseId, ...req.body });
      return reply.code(201).send(ms);
    });

  app.get('/phases/:phaseId/milestones', { preHandler: requireRole('customer', 'worker', 'founder') },
    async (req) => listMilestones(req.params.phaseId));
}
