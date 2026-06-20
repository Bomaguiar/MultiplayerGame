// Demo-only routes — gated by DEMO_MODE=1. NEVER enable in production: the
// token endpoint mints an identity for any role, which is exactly what you do
// NOT want outside a sandbox. In production, tokens come only from the watcher.

import { signToken } from './auth.js';
import {
  createProject, getProject, listProjectsForUser, createPhase, createMilestone,
} from './models/project.js';
import { createLog } from './models/dailyLog.js';
import { createTask, setStatus } from './models/task.js';
import { createRequest } from './models/material.js';
import { createUser } from './models/user.js';
import { createChangeOrder } from './models/changeOrder.js';

const ACTORS = {
  founder:  { phone: '351900000001', name: 'Pedro' },
  worker:   { phone: '351900000009', name: 'João' },
  customer: { phone: '351900000002', name: 'Maria' },
};

export async function demoRoutes(app) {
  // "Log in" as a role → returns an internal token the dashboard uses.
  app.post('/demo/token', async (req, reply) => {
    const role = req.body?.role;
    if (!ACTORS[role]) return reply.code(400).send({ error: 'unknown role' });
    const { phone, name } = ACTORS[role];
    return { token: signToken({ phone, role }), role, phone, name };
  });

  // Idempotently seed the "Vila Sol" scenario so the dashboard has data.
  app.post('/demo/seed', async () => {
    // Skip if already seeded.
    const founder = { role: 'founder', phone: ACTORS.founder.phone };
    const existing = await listProjectsForUser(founder);
    if (existing.length) return { seeded: false, projectId: existing[0].id };

    for (const [role, a] of Object.entries(ACTORS)) {
      try { await createUser({ phone: a.phone, name: a.name, role }); } catch { /* upsert */ }
    }

    const project = await createProject({
      name: 'Vila Sol', address: 'Rua das Oliveiras 12',
      clientPhone: ACTORS.customer.phone, workerPhones: [ACTORS.worker.phone],
      budget: 85000,
    });
    const phase = await createPhase({ projectId: project.id, name: 'Foundations', position: 1 });
    await createMilestone({ phaseId: phase.id, name: 'Slab poured', dueOn: '2026-07-15', pctComplete: 20 });

    await createLog({
      projectId: project.id, authorPhone: ACTORS.worker.phone,
      note: 'Excavation done, formwork started.', weather: 'sunny', crewCount: 4, hours: 8,
      photoRefs: ['wa-media/3EB0-1.jpg', 'wa-media/3EB0-2.jpg'],
    });

    const task = await createTask({
      projectId: project.id, title: 'Tie rebar grid',
      assigneePhone: ACTORS.worker.phone, priority: 'high', dueOn: '2026-07-10',
    });
    await setStatus(task.id, 'doing', ACTORS.worker.phone);

    await createRequest({
      projectId: project.id, requestedBy: ACTORS.worker.phone,
      item: 'Cement', qty: 20, unit: 'bags', urgency: 'high',
    });

    await createChangeOrder({
      projectId: project.id, title: 'Upgrade to polished concrete floor',
      description: 'Client requested polished concrete instead of standard screed. Adds 3 days.',
      costDelta: 4500, daysDelta: 3, proposedBy: ACTORS.founder.phone,
    });

    return { seeded: true, projectId: project.id };
  });
}
