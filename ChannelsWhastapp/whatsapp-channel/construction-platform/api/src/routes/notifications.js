// Notification routes. All authenticated users can view their own notifications.

import { requireRole } from '../middleware/requireRole.js';
import { listNotifications, countUnread, markRead } from '../models/notification.js';

export async function notificationRoutes(app) {
  // List my notifications (filtered by recipient phone from auth token).
  app.get('/notifications', { preHandler: requireRole('customer', 'worker', 'founder') },
    async (req) => {
      const { status, type, project_id: projectId, limit } = req.query || {};
      return listNotifications({
        recipientPhone: req.user.phone,
        projectId: projectId ? Number(projectId) : null,
        status: status || null,
        type: type || null,
        limit: limit ? Number(limit) : 50,
      });
    });

  // Unread count for the current user.
  app.get('/notifications/unread/count', { preHandler: requireRole('customer', 'worker', 'founder') },
    async (req) => {
      const count = await countUnread(req.user.phone);
      return { count };
    });

  // Mark a single notification as read.
  app.patch('/notifications/:id/read', { preHandler: requireRole('customer', 'worker', 'founder') },
    async (req, reply) => {
      const notif = await markRead(req.params.id);
      if (!notif) return reply.code(404).send({ error: 'not_found' });
      // Only the recipient can mark their own notification as read.
      if (notif.recipient_phone !== req.user.phone) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      return notif;
    });
}
