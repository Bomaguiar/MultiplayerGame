// AI agent endpoint (in-app / demo). Authenticated with the internal token like
// the rest of the API, so the WhatsApp simulator artifact and any in-app UI can
// talk to the same construction agent the webhook uses.

import { requireRole } from '../middleware/requireRole.js';
import { listProjectsForUser } from '../models/project.js';
import { runAgent } from '../brain/agent.js';

export async function agentRoutes(app) {
  app.post('/agent/message', { preHandler: requireRole('customer', 'worker', 'founder', 'admin') },
    async (req, reply) => {
      const text = req.body?.text ?? '';
      const mediaRefs = Array.isArray(req.body?.mediaRefs) ? req.body.mediaRefs : [];
      if (!String(text).trim() && !mediaRefs.length) {
        return reply.code(400).send({ error: 'text or mediaRefs required' });
      }

      // Project context: explicit projectId (if the caller can see it) or the first visible.
      const projects = await listProjectsForUser(req.user);
      if (!projects.length) {
        return { reply: 'Ainda não está associado a nenhum projeto.', tool: null };
      }
      let projectId = projects[0].id;
      if (req.body?.projectId && projects.some((p) => String(p.id) === String(req.body.projectId))) {
        projectId = req.body.projectId;
      }

      return runAgent({ user: req.user, projectId, text, mediaRefs });
    });
}
