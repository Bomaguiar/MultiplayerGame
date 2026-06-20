// Fastify app factory.
//
// Kept separate from server.js so tests can build an app instance and use
// `app.inject()` without binding a port. Routes registered here grow as the
// backlog is built (projects, logs, tasks, intake, brain, ...).

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import Fastify from 'fastify';
import { checkDb } from './db.js';
import { authDecorator } from './auth.js';
import { projectRoutes } from './routes/projects.js';
import { logRoutes } from './routes/logs.js';
import { taskRoutes } from './routes/tasks.js';
import { materialRoutes } from './routes/materials.js';
import { changeOrderRoutes } from './routes/changeOrders.js';
import { clickupRoutes } from './routes/clickup.js';

const here = dirname(fileURLToPath(import.meta.url));

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
  app.register(changeOrderRoutes);
  app.register(clickupRoutes);

  // Demo dashboard + demo-only routes (login-as-role, seed). Gated by env so
  // they never ship to production.
  const demoMode = opts.demoMode ?? process.env.DEMO_MODE === '1';
  if (demoMode) {
    // Register asynchronously inside a plugin so dynamic import resolves before
    // the server starts handling requests.
    app.register(async (instance) => {
      const [{ demoRoutes }, fastifyStatic] = await Promise.all([
        import('./demo-routes.js'),
        import('@fastify/static'),
      ]);
      await instance.register(fastifyStatic.default, {
        root: join(here, '..', 'public'),
        prefix: '/app/',
      });
      await instance.register(demoRoutes);
    });
  }

  return app;
}
