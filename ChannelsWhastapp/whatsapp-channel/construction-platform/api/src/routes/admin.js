// Admin routes (T15). Founder/admin only: manage the people on the platform —
// list users, rename them, change their role/phone, and add new ones. Project
// details (name/budget/address) are edited through the existing
// PATCH /projects/:id.
//
// Phone can now be edited: a change cascades through every table that references
// it (see changeUserPhone), so a corrected number keeps all the person's
// history, tasks and notifications.

import { requireRole } from '../middleware/requireRole.js';
import {
  listUsers, createUser, updateUser, findByPhone, changeUserPhone,
} from '../models/user.js';

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

  // Rename / re-role / re-number an existing user (by phone). A `newPhone`
  // different from the path phone triggers the cascading rename first, then
  // name/role are applied to the (possibly new) phone.
  app.patch('/admin/users/:phone', { preHandler: requireRole('founder') },
    async (req, reply) => {
      const existing = await findByPhone(req.params.phone);
      if (!existing) return reply.code(404).send({ error: 'not_found' });
      const { name, role, newPhone } = req.body || {};
      try {
        let phone = req.params.phone;
        const next = String(newPhone ?? '').trim();
        if (next && next !== phone) {
          const moved = await changeUserPhone(phone, next);
          phone = moved.phone;
        }
        const user = await updateUser(phone, { name, role });
        return user;
      } catch (e) {
        return reply.code(400).send({ error: String(e.message || e) });
      }
    });
}
