import { signToken } from './auth.js';
import {
  createProject, getProject, listProjectsForUser, createPhase, createMilestone,
} from './models/project.js';
import { createLog } from './models/dailyLog.js';
import { createTask, setStatus } from './models/task.js';
import { createRequest } from './models/material.js';
import { createUser } from './models/user.js';
import { createChangeOrder } from './models/changeOrder.js';
import { createSelection } from './models/selection.js';
import { syncClickUpBatch } from './integrations/clickup.js';

const ACTORS = {
  founder:  { phone: '351900000001', name: 'Pedro Aguiar' },
  worker:   { phone: '351900000009', name: 'Franek' },
  customer: { phone: '351900000002', name: 'Ilya Bourim' },
};

const SANTA_RITA_CLICKUP_TASKS = [
  { id: '86ca3vr8t', name: 'Get AL License', status: 'in progress', priority: 'urgent', url: 'https://app.clickup.com/t/86ca3vr8t',
    assignees: [{ username: 'Bernardo jose d\'Aguiar' }], tags: [{ name: 'admin' }], due_date: '1780628400000', list: { id: '901523727534', name: 'Santa Rita Admin' } },
  { id: '86ca3vr38', name: 'Open Bank Account', status: 'in progress', priority: 'urgent', url: 'https://app.clickup.com/t/86ca3vr38',
    assignees: [{ username: 'pedro Aguiar' }], tags: [{ name: 'admin' }], due_date: '1780455600000', list: { id: '901523727534', name: 'Santa Rita Admin' } },
  { id: '86c9n5ayr', name: 'Garden fence - gate - paint', status: 'in progress', url: 'https://app.clickup.com/t/86c9n5ayr',
    assignees: [{ username: 'Franek' }], tags: [{ name: 'house exterior' }], due_date: '1780369200000', list: { id: '901523175096', name: 'Santa Rita - House Exterior' } },
  { id: '86c9n5ahk', name: 'Vehicle gate - paint', status: 'in progress', url: 'https://app.clickup.com/t/86c9n5ahk',
    assignees: [{ username: 'Franek' }], tags: [{ name: 'house exterior' }], due_date: '1780369200000', list: { id: '901523175096', name: 'Santa Rita - House Exterior' } },
  { id: '86c9n59rp', name: 'Metal stair gate and fence - paint', status: 'in progress', url: 'https://app.clickup.com/t/86c9n59rp',
    assignees: [{ username: 'Franek' }], tags: [{ name: 'house exterior' }], due_date: '1780369200000', list: { id: '901523175096', name: 'Santa Rita - House Exterior' } },
  { id: '86c9n0frz', name: 'Remove bars from windows', status: 'in progress', priority: 'normal', url: 'https://app.clickup.com/t/86c9n0frz',
    assignees: [{ username: 'Franek' }], tags: [{ name: 'house exterior' }], due_date: '1780628400000', list: { id: '901523175096', name: 'Santa Rita - House Exterior' } },
  { id: '86c9mqd8m', name: 'Replace all outlets / light switches with new', status: 'in progress', url: 'https://app.clickup.com/t/86c9mqd8m',
    assignees: [{ username: 'Franek' }], tags: [{ name: 'main living room' }], due_date: '1780542000000', list: { id: '901521189505', name: 'Main Living Room' } },
  { id: '86c9mqcej', name: 'Install electric shutter motors on all exterior openings (9)', status: 'in progress', url: 'https://app.clickup.com/t/86c9mqcej',
    assignees: [{ username: 'Franek' }], tags: [{ name: 'main living room' }], due_date: '1783306800000', list: { id: '901521189505', name: 'Main Living Room' } },
  { id: '86c9mqbzr', name: 'Fix the light switches to be controlled near main door', status: 'in progress', url: 'https://app.clickup.com/t/86c9mqbzr',
    assignees: [{ username: 'Franek' }], tags: [{ name: 'main living room' }], due_date: '1780542000000', list: { id: '901521189505', name: 'Main Living Room' } },
  { id: '86c9mqbwx', name: 'Wood: Sand, Clean and Seal the wood trim and doors', status: 'in progress', url: 'https://app.clickup.com/t/86c9mqbwx',
    assignees: [{ username: 'Franek' }], tags: [{ name: 'main living room' }], due_date: '1780887600000', list: { id: '901521189505', name: 'Main Living Room' } },
  { id: '86c883mng', name: 'Wall Lights - Replace', status: 'in progress', url: 'https://app.clickup.com/t/86c883mng',
    assignees: [{ username: 'Franek' }], tags: [{ name: 'toilet 1' }], due_date: '1780628400000', list: { id: '901521185144', name: 'Santa Rita - Main Floor Toilet WC' } },
  { id: '86c883mkg', name: 'Faucet Replace', status: 'in progress', url: 'https://app.clickup.com/t/86c883mkg',
    assignees: [{ username: 'Franek' }], tags: [{ name: 'toilet 1' }], due_date: '1780628400000', list: { id: '901521185144', name: 'Santa Rita - Main Floor Toilet WC' } },
  { id: '86c8820ac', name: 'Cabinets Doors - Sand, Clean - Paint or Seal', status: 'in progress', url: 'https://app.clickup.com/t/86c8820ac',
    assignees: [{ username: 'Franek' }], tags: [{ name: 'main kitchen' }], due_date: '1781665200000', list: { id: '901521185143', name: 'Santa Rita - Main Kitchen' } },
  { id: '86c882472', name: 'Sewage - Check Drains', status: 'in progress', url: 'https://app.clickup.com/t/86c882472',
    assignees: [{ username: 'Franek' }], tags: [{ name: 'building system' }], due_date: '1781233200000', list: { id: '901521185897', name: 'Santa Rita - Building Systems' } },
  { id: '86c882423', name: 'Electrical - Repair meter to panel connection', status: 'in progress', url: 'https://app.clickup.com/t/86c882423',
    assignees: [{ username: 'Franek' }], tags: [{ name: 'building system' }], due_date: '1783047600000', list: { id: '901521185897', name: 'Santa Rita - Building Systems' } },
  { id: '86c881rcf', name: 'Toilet - Modernize Flush Button', status: 'in progress', url: 'https://app.clickup.com/t/86c881rcf',
    assignees: [{ username: 'Franek' }], tags: [{ name: 'toilet 1' }], due_date: '1780628400000', list: { id: '901521185144', name: 'Santa Rita - Main Floor Toilet WC' } },
  { id: '86c883dtn', name: 'Shutters power (9)', status: 'in progress', url: 'https://app.clickup.com/t/86c883dtn',
    assignees: [{ username: 'Franek' }], tags: [{ name: 'main living room' }], due_date: '1780455600000', list: { id: '901521189505', name: 'Main Living Room' } },
  { id: '86c9mqcnm', name: 'Install new outlet / data wire / HDMI for Projector', status: 'in progress', url: 'https://app.clickup.com/t/86c9mqcnm',
    assignees: [{ username: 'Franek' }], tags: [{ name: 'main living room' }], due_date: '1780974000000', list: { id: '901521189505', name: 'Main Living Room' } },
  { id: '86c9mqd2d', name: 'Install 2 exterior lights + 3 outlets', status: 'in progress', url: 'https://app.clickup.com/t/86c9mqd2d',
    assignees: [], tags: [{ name: 'main living room' }], due_date: '1780369200000', list: { id: '901521189505', name: 'Main Living Room' } },
];

const REAL_MATERIALS = [
  { item: 'Monomando lava mão (Single-lever faucet)', qty: 2, unit: 'pcs', urgency: 'high' },
  { item: 'Monomando ducha (Shower faucet)', qty: 3, unit: 'pcs', urgency: 'high' },
  { item: 'Motores de estore (Roller motors)', qty: 14, unit: 'pcs', urgency: 'normal' },
  { item: 'Interruptor simples (Single switch)', qty: 30, unit: 'pcs', urgency: 'normal' },
  { item: 'Interruptor duplo (Double switch)', qty: 13, unit: 'pcs', urgency: 'normal' },
  { item: 'Tomada (Outlet)', qty: 36, unit: 'pcs', urgency: 'normal' },
  { item: 'Aplique quarto (Bedroom wall light)', qty: 7, unit: 'pcs', urgency: 'low' },
  { item: 'Aplique da sala (Living room wall light)', qty: 11, unit: 'pcs', urgency: 'low' },
  { item: 'Led de teto sala (Living room ceiling LED)', qty: 15, unit: 'pcs', urgency: 'low' },
  { item: 'Tinta exterior parede - área piscina', qty: 360, unit: 'm²', urgency: 'normal' },
  { item: 'Primário branco (White primer)', qty: 20, unit: 'litros', urgency: 'high' },
  { item: 'Silicone pintável', qty: 10, unit: 'pcs', urgency: 'normal' },
  { item: 'Impermeabilizante Sika Guard 570 W', qty: 1, unit: 'balde 15L', urgency: 'high' },
];

export async function demoRoutes(app) {
  app.post('/demo/token', async (req, reply) => {
    const role = req.body?.role;
    if (!ACTORS[role]) return reply.code(400).send({ error: 'unknown role' });
    const { phone, name } = ACTORS[role];
    return { token: signToken({ phone, role }), role, phone, name };
  });

  app.post('/demo/seed', async () => {
    const founder = { role: 'founder', phone: ACTORS.founder.phone };
    const existing = await listProjectsForUser(founder);
    if (existing.length) return { seeded: false, projectId: existing[0].id };

    for (const [role, a] of Object.entries(ACTORS)) {
      try { await createUser({ phone: a.phone, name: a.name, role }); } catch { /* upsert */ }
    }

    const project = await createProject({
      name: 'Santa Rita - Summer 2026', address: 'Santa Rita, Torres Vedras',
      clientPhone: ACTORS.customer.phone, workerPhones: [ACTORS.worker.phone],
      budget: 85000,
    });

    const phaseExterior = await createPhase({ projectId: project.id, name: 'Exterior & Painting', position: 1 });
    const phaseInterior = await createPhase({ projectId: project.id, name: 'Interior & Electrical', position: 2 });
    const phaseSystems = await createPhase({ projectId: project.id, name: 'Building Systems', position: 3 });

    await createMilestone({ phaseId: phaseExterior.id, name: 'All exterior gates painted', dueOn: '2026-07-01', pctComplete: 40 });
    await createMilestone({ phaseId: phaseExterior.id, name: 'Window bars removed', dueOn: '2026-07-15', pctComplete: 10 });
    await createMilestone({ phaseId: phaseInterior.id, name: 'All outlets/switches replaced', dueOn: '2026-07-08', pctComplete: 30 });
    await createMilestone({ phaseId: phaseInterior.id, name: 'Shutter motors installed (9)', dueOn: '2026-08-15', pctComplete: 5 });
    await createMilestone({ phaseId: phaseSystems.id, name: 'Electrical panel connection repaired', dueOn: '2026-08-01', pctComplete: 0 });
    await createMilestone({ phaseId: phaseSystems.id, name: 'Sewage drains checked', dueOn: '2026-07-20', pctComplete: 0 });

    await createLog({
      projectId: project.id, authorPhone: ACTORS.worker.phone,
      note: 'Started painting garden fence and vehicle gate. Sanded metal stair gate. Weather clear.',
      weather: 'sunny', crewCount: 2, hours: 8,
      photoRefs: ['wa-media/fence-1.jpg', 'wa-media/gate-1.jpg'],
    });
    await createLog({
      projectId: project.id, authorPhone: ACTORS.worker.phone,
      note: 'Replaced 12 outlets in main living room. Started wiring for projector HDMI. Kitchen cabinets sanding underway.',
      weather: 'cloudy', crewCount: 2, hours: 9,
      photoRefs: ['wa-media/outlets-1.jpg', 'wa-media/kitchen-1.jpg'],
    });

    const syncResult = await syncClickUpBatch(project.id, SANTA_RITA_CLICKUP_TASKS);

    for (const mat of REAL_MATERIALS) {
      await createRequest({
        projectId: project.id, requestedBy: ACTORS.worker.phone, ...mat,
      });
    }

    await createChangeOrder({
      projectId: project.id, title: 'Upgrade to polished concrete floor',
      description: 'Client requested polished concrete instead of standard screed. Adds 3 days.',
      costDelta: 4500, daysDelta: 3, proposedBy: ACTORS.founder.phone,
    });
    await createChangeOrder({
      projectId: project.id, title: 'Add electric shutters to all 9 openings',
      description: 'Originally manual shutters. Electric motors + wiring for 9 windows/doors.',
      costDelta: 6200, daysDelta: 5, proposedBy: ACTORS.founder.phone,
    });

    await createSelection({
      projectId: project.id, room: 'Cozinha', name: 'Bancada',
      description: 'Escolha do material da bancada da cozinha.',
      options: ['Granito preto', 'Quartzo branco', 'Betão polido'],
      price: 3200, dueOn: '2026-07-05', proposedBy: ACTORS.founder.phone,
    });
    await createSelection({
      projectId: project.id, room: 'Sala', name: 'Pavimento',
      description: 'Acabamento do pavimento da sala principal.',
      options: ['Madeira de carvalho', 'Microcimento', 'Porcelânico'],
      price: 5400, dueOn: '2026-07-12', proposedBy: ACTORS.founder.phone,
    });

    return { seeded: true, projectId: project.id, clickupSync: syncResult };
  });
}
