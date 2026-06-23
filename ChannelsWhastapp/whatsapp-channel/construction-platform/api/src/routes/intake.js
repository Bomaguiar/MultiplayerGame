// Customer request intake (T11). Customers send a request by text or voice
// note; voice is transcribed through the pluggable transcriber. Each request is
// stored as a CustomerRequest, triaged by the brain (T12), and acknowledged.

import { requireRole } from '../middleware/requireRole.js';
import { getProject, canAccessProject } from '../models/project.js';
import { createCustomerRequest, listCustomerRequests } from '../models/customerRequest.js';
import { transcribe } from '../intake/transcriber.js';
import { triageRequest } from '../brain/triage.js';

export async function intakeRoutes(app) {
  // Customer submits a request (text or voice).
  app.post('/requests', { preHandler: requireRole('customer') },
    async (req, reply) => {
      const { projectId = null, channel = 'text', text, mediaRef = null } = req.body || {};

      // Project scoping: if a project is named, the customer must own it.
      let project = null;
      if (projectId != null) {
        project = await getProject(projectId);
        if (!project || !canAccessProject(req.user, project)) {
          return reply.code(404).send({ error: 'not_found' });
        }
      }

      // Resolve the raw text: voice notes are transcribed first.
      let rawText = text;
      if (channel === 'voice') {
        if (!mediaRef) return reply.code(400).send({ error: 'mediaRef required for voice' });
        rawText = await transcribe({ mediaRef });
      }
      if (!rawText || !String(rawText).trim()) {
        return reply.code(400).send({ error: 'text or voice mediaRef required' });
      }

      const request = await createCustomerRequest({
        projectId, customerPhone: req.user.phone, channel, rawText, mediaRef,
      });

      // Triage in the background path but await so the ack can reflect it; any
      // failure must not block the acknowledgement.
      const triage = await triageRequest(request, project).catch(() => null);

      return reply.code(201).send({
        request: triage?.request ?? request,
        ack: 'Recebemos o seu pedido. A nossa equipa vai analisar e responder em breve.',
        triage: triage ? { category: triage.category, urgency: triage.urgency } : null,
      });
    });

  // Customer lists their own requests; founders can list all (optionally scoped).
  app.get('/requests', { preHandler: requireRole('customer', 'founder') },
    async (req) => {
      const isFounder = req.user.role === 'founder' || req.user.role === 'admin';
      return listCustomerRequests({
        customerPhone: isFounder ? (req.query?.customer_phone ?? null) : req.user.phone,
        projectId: req.query?.project_id ? Number(req.query.project_id) : null,
        status: req.query?.status ?? null,
      });
    });
}
