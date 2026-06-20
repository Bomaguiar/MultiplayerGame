// Materials rollup route (T13). Founder-only consolidated view of pending
// material requests across all projects, with an AI-phrased summary.

import { requireRole } from '../middleware/requireRole.js';
import { materialsRollup, summarizeMaterials } from '../brain/materialsRollup.js';

export async function materialsRollupRoutes(app) {
  app.get('/materials/rollup', { preHandler: requireRole('founder') },
    async (req) => {
      const rollup = await materialsRollup({
        projectId: req.query?.project_id ? Number(req.query.project_id) : null,
        urgency: req.query?.urgency ?? null,
      });
      const summary = await summarizeMaterials(rollup);
      return { ...rollup, summary };
    });
}
