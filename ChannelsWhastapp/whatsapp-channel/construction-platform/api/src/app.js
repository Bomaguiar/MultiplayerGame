// Fastify app factory.
//
// Kept separate from server.js so tests can build an app instance and use
// `app.inject()` without binding a port. Routes registered here grow as the
// backlog is built (projects, logs, tasks, intake, brain, ...).

import Fastify from 'fastify';
import { checkDb } from './db.js';
import { authDecorator } from './auth.js';
import { projectRoutes } from './routes/projects.js';
import { logRoutes } from './routes/logs.js';
import { taskRoutes } from './routes/tasks.js';
import { materialRoutes } from './routes/materials.js';

export function buildApp(opts = {}) {
  const app = Fastify({ logger: opts.logger ?? false });

  // Decorate every request with req.user from the internal token (if present).
  app.addHook('preHandler', authDecorator);

  // Liveness + DB connectivity. Always 200 so liveness probes stay green even
  // when the DB is down; the `db` flag carries the connectivity signal.
  app.get('/health', async () => {
    const db = await checkDb();
    return { status: 'ok', db, ts: new Date().toISOString() };
  });

  // Domain routes.
  app.register(projectRoutes);
  app.register(logRoutes);
  app.register(taskRoutes);
  app.register(materialRoutes);

  return app;
}
