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
import { interactiveToText } from '../brain/agentTools.js';
import { listOutbox, markSent } from '../models/notification.js';

const WATCHER_SECRET = process.env.WATCHER_SECRET || 'dev-watcher-secret';

export async function whatsappRoutes(app) {
  const checkWatcher = (req, reply) => {
    if (req.headers['x-watcher-token'] !== WATCHER_SECRET) {
      reply.code(401).send({ error: 'unauthorized' });
      return false;
    }
    return true;
  };

  // Outbound queue: the delivery bridge polls pending proactive messages and
  // marks each sent once delivered via send_message.
  app.get('/whatsapp/outbox', async (req, reply) => {
    if (!checkWatcher(req, reply)) return;
    const limit = Math.min(Number(req.query?.limit) || 50, 200);
    const rows = await listOutbox({ limit });
    return {
      messages: rows.map((n) => ({
        id: n.id,
        to: n.recipient_phone,
        text: n.body ? `*${n.title}*\n${n.body}` : n.title,
      })),
    };
  });

  app.post('/whatsapp/outbox/:id/sent', async (req, reply) => {
    if (!checkWatcher(req, reply)) return;
    const updated = await markSent(req.params.id);
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return { ok: true, id: updated.id };
  });

  app.post('/whatsapp/incoming', async (req, reply) => {
    // Auth: check the shared watcher secret.
    if (!checkWatcher(req, reply)) return;

    const { from, body, mediaRefs, audioRef, messageId, timestamp } = req.body || {};
    const media = Array.isArray(mediaRefs) ? mediaRefs : [];
    if (!from || (!body && !media.length && !audioRef)) {
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

    const agentResult = await runAgent({ user, projectId, text: body || '', mediaRefs: media, audioRef: audioRef || null });
    // The webhook's consumer is the WhatsApp bridge, which sends plain text and
    // can't render native buttons — fold the interactive options into the reply
    // as command hints. `interactive` is still returned for richer clients.
    const replyText = agentResult.reply + interactiveToText(agentResult.interactive);
    return {
      reply: replyText,
      ...(agentResult.tool ? { tool: agentResult.tool } : {}),
      ...(agentResult.action ? { action: agentResult.action } : {}),
      ...(agentResult.interactive ? { interactive: agentResult.interactive } : {}),
      ...(agentResult.transcript ? { transcript: agentResult.transcript } : {}),
      ...(agentResult.data ? { data: agentResult.data } : {}),
    };
  });
}
