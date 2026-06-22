// WhatsApp webhook routes.
//
// The external WhatsApp watcher (Python process) calls POST /whatsapp/incoming
// when it receives a message. This endpoint authenticates via a shared secret
// (WATCHER_SECRET), looks up the sender, parses the command, executes it, and
// returns a reply for the watcher to send back.

import { findByPhone } from '../models/user.js';
import { listProjectsForUser } from '../models/project.js';
import { parseCommand, executeCommand } from '../whatsapp/router.js';
import { runAgent } from '../brain/agent.js';

const WATCHER_SECRET = process.env.WATCHER_SECRET || 'dev-watcher-secret';

export async function whatsappRoutes(app) {
  app.post('/whatsapp/incoming', async (req, reply) => {
    // Auth: check the shared watcher secret.
    const token = req.headers['x-watcher-token'];
    if (token !== WATCHER_SECRET) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const { from, body, mediaRefs, messageId, timestamp } = req.body || {};
    const media = Array.isArray(mediaRefs) ? mediaRefs : [];
    if (!from || (!body && !media.length)) {
      return reply.code(400).send({ error: 'missing from or body' });
    }

    // Look up user by phone.
    const user = await findByPhone(from);
    if (!user) {
      return {
        reply: 'Sorry, your number is not registered on the platform. Please contact the project manager to get set up.',
      };
    }

    // Find the user's project(s). Use the first one as context.
    const projects = await listProjectsForUser(user);
    const projectId = projects.length ? projects[0].id : null;

    if (!projectId) {
      return {
        reply: 'You are registered but not associated with any project yet.',
      };
    }

    // Explicit slash-commands stay on the deterministic command router; anything
    // else (natural language, photos) goes through the AI agent.
    const parsed = parseCommand(body || '');
    if (parsed.cmd !== 'unknown') {
      const result = await executeCommand(parsed, user, projectId);
      return { reply: result.text, ...(result.data ? { data: result.data } : {}) };
    }

    const agentResult = await runAgent({ user, projectId, text: body || '', mediaRefs: media });
    return {
      reply: agentResult.reply,
      ...(agentResult.tool ? { tool: agentResult.tool } : {}),
      ...(agentResult.action ? { action: agentResult.action } : {}),
      ...(agentResult.data ? { data: agentResult.data } : {}),
    };
  });
}
