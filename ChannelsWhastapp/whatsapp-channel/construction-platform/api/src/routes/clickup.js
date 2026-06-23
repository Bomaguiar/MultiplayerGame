import { requireRole } from '../middleware/requireRole.js';
import { saveMapping, getMapping, listMappings } from '../models/clickupSync.js';

export async function clickupRoutes(app) {
  app.post('/clickup/sync', { preHandler: requireRole('founder') },
    async (req, reply) => {
      const { entityType, entityId, clickupTaskId, clickupListId } = req.body || {};
      if (!entityType || !entityId || !clickupTaskId) {
        return reply.code(400).send({ error: 'entityType, entityId, clickupTaskId required' });
      }
      const mapping = await saveMapping({ entityType, entityId, clickupTaskId, clickupListId });
      return reply.code(201).send(mapping);
    });

  app.get('/clickup/sync/:entityType/:entityId', { preHandler: requireRole('founder') },
    async (req) => {
      const mapping = await getMapping(req.params.entityType, Number(req.params.entityId));
      return mapping || { linked: false };
    });

  app.get('/clickup/sync/:entityType', { preHandler: requireRole('founder') },
    async (req) => listMappings(req.params.entityType));
}
