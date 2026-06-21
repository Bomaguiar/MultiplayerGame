// Admin routes (T15). Founder/admin only: manage the people on the platform —
// list users, rename them, change their role, and add new ones. Project details
// (name/budget/address) are edited through the existing PATCH /projects/:id.
//
// Phone is identity and is never mutated here; only name and role are editable.

import { requireRole } from '../middleware/requireRole.js';
import { listUsers, createUser, updateUser, findByPhone } from '../models/user.js';

export async function adminRoutes(app) {
  // List everyone on the platform.
  app.get('/admin/users', { preHandler: requireRole('founder') },
    async () => listUsers());

  // Add a user.
  app.post('/admin/users', { preHandler: requireRole('founder') },
    async (req, reply) => {
      const { phone, name, role } = req.body || {};
      if (!phone || !role) {
        return reply.code(400).send({ error: 'phone and role are required' });
      }
      try {
        const user = await createUser({ phone, name, role });
        return reply.code(201).send(user);
      } catch (e) {
        return reply.code(400).send({ error: String(e.message || e) });
      }
    });

  // Rename / re-role an existing user (by phone).
  app.patch('/admin/users/:phone', { preHandler: requireRole('founder') },
    async (req, reply) => {
      const existing = await findByPhone(req.params.phone);
      if (!existing) return reply.code(404).send({ error: 'not_found' });
      try {
        const user = await updateUser(req.params.phone, req.body || {});
        return user;
      } catch (e) {
        return reply.code(400).send({ error: String(e.message || e) });
      }
    });
}
