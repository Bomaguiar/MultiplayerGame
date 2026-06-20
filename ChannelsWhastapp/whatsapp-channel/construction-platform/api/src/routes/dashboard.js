// Founder dashboard routes (T10). Founder-only: an AI-phrased health rollup
// across all projects, plus a per-project deep view.

import { requireRole } from '../middleware/requireRole.js';
import { listProjectsForUser, getProject, canAccessProject } from '../models/project.js';
import { projectMetrics, summarizeProject, dashboardRollup } from '../brain/dashboard.js';

export async function dashboardRoutes(app) {
  // 'painel' — rollup across every project the founder can see.
  app.get('/dashboard', { preHandler: requireRole('founder') },
    async (req) => {
      const projects = await listProjectsForUser(req.user);
      const projectSummaries = await dashboardRollup(projects);
      const totals = projectSummaries.reduce((acc, p) => {
        acc.overdueTasks += p.overdueTasks;
        acc.pendingApprovals += p.pendingApprovals;
        return acc;
      }, { overdueTasks: 0, pendingApprovals: 0 });
      return { projects: projectSummaries, totals: { ...totals, projectCount: projects.length } };
    });

  // 'painel <projeto>' — deep view of one project.
  app.get('/projects/:id/dashboard', { preHandler: requireRole('founder') },
    async (req, reply) => {
      const project = await getProject(req.params.id);
      if (!project || !canAccessProject(req.user, project)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const metrics = await projectMetrics(project);
      const summary = await summarizeProject(metrics);
      return { ...metrics, summary };
    });
}
