// Process entrypoint: build the app, listen, and shut down cleanly.

import { buildApp } from './app.js';
import { closePool } from './db.js';
import { initBrainModel } from './brain/claudeClient.js';

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';

// Opt-in: wire Claude into the brain if ANTHROPIC_API_KEY is set; otherwise the
// deterministic fallbacks stay in effect.
const aiOn = initBrainModel();

const app = buildApp({ logger: true });
app.log?.info?.(`brain model: ${aiOn ? 'Claude (live)' : 'deterministic fallback'}`);

async function start() {
  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`construction-whatsapp-api listening on ${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

async function shutdown(signal) {
  app.log.info(`${signal} received — shutting down`);
  await app.close();
  await closePool();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
