// AI agent endpoint (in-app / demo). Authenticated with the internal token like
// the rest of the API, so the WhatsApp simulator artifact and any in-app UI can
// talk to the same construction agent the webhook uses.

import { requireRole } from '../middleware/requireRole.js';
import { listProjectsForUser, getProject, canAccessProject } from '../models/project.js';
import { runAgent } from '../brain/agent.js';
import { scanProject, enqueueAlerts } from '../brain/proactive.js';

export async function agentRoutes(app) {
  // Preview the proactive alerts that are currently due for a project (no writes).
  app.get('/projects/:id/proactive', { preHandler: requireRole('founder') },
    async (req, reply) => {
      const project = await getProject(req.params.id);
      if (!project || !canAccessProject(req.user, project)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const alerts = await scanProject(project, { includeDailySummary: req.query?.daily === '1' });
      return { alerts };
    });

  // Enqueue due alerts as pending whatsapp messages for the bridge to deliver.
  // A scheduler (cron / the bridge poller) can hit this hourly or at 18:00.
  app.post('/projects/:id/proactive/run', { preHandler: requireRole('founder') },
    async (req, reply) => {
      const project = await getProject(req.params.id);
      if (!project || !canAccessProject(req.user, project)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const created = await enqueueAlerts(project, { includeDailySummary: req.body?.daily === true || req.query?.daily === '1' });
      return { queued: created.length, messages: created.map((n) => ({ id: n.id, to: n.recipient_phone, title: n.title })) };
    });

  // Convenience for the simulator/UI: run proactive alerts for the founder's
  // first project without needing an explicit id (mirrors /agent/message).
  app.post('/agent/proactive', { preHandler: requireRole('founder') },
    async (req) => {
      const projects = await listProjectsForUser(req.user);
      if (!projects.length) return { queued: 0, messages: [] };
      const created = await enqueueAlerts(projects[0], { includeDailySummary: true });
      return { queued: created.length, messages: created.map((n) => ({ id: n.id, to: n.recipient_phone, title: n.title, body: n.body })) };
    });

  app.post('/agent/message', { preHandler: requireRole('customer', 'worker', 'founder', 'admin') },
    async (req, reply) => {
      const text = req.body?.text ?? '';
      const mediaRefs = Array.isArray(req.body?.mediaRefs) ? req.body.mediaRefs : [];
      const audioRef = req.body?.audioRef ?? null;
      if (!String(text).trim() && !mediaRefs.length && !audioRef) {
        return reply.code(400).send({ error: 'text, mediaRefs or audioRef required' });
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

      return runAgent({ user: req.user, projectId, text, mediaRefs, audioRef });
    });
}
