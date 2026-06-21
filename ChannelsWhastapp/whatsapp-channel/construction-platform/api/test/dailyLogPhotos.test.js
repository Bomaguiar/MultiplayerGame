import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import { setPool, query } from '../src/db.js';
import { runMigrations } from '../migrations/run.js';
import { createProject } from '../src/models/project.js';
import { createLog, listLogs } from '../src/models/dailyLog.js';

// The photo gallery is built entirely from each log's photo_refs array, so the
// model must round-trip refs (URLs or storage keys) faithfully and newest-first.
beforeAll(async () => {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  setPool(new Pool());
  await runMigrations();
});

let projectId;
beforeEach(async () => {
  await query('DELETE FROM daily_logs');
  await query('DELETE FROM projects');
  const p = await createProject({
    name: 'Casa', clientPhone: '3519001', workerPhones: ['3519009'], budget: 0,
  });
  projectId = p.id;
});

describe('daily log photo refs (gallery contract)', () => {
  it('stores and returns photo refs (urls and keys) intact', async () => {
    await createLog({
      projectId, authorPhone: '3519009', note: 'dia 1',
      photoRefs: ['wa-media/fence-1.jpg', 'https://cdn.example.com/a.jpg'],
    });
    const [log] = await listLogs(projectId);
    expect(log.photo_refs).toEqual(['wa-media/fence-1.jpg', 'https://cdn.example.com/a.jpg']);
  });

  it('defaults to an empty array when no photos are attached', async () => {
    await createLog({ projectId, authorPhone: '3519009', note: 'sem fotos' });
    const [log] = await listLogs(projectId);
    expect(log.photo_refs).toEqual([]);
  });

  it('returns logs newest-first so the gallery is chronological', async () => {
    await createLog({ projectId, authorPhone: '3519009', note: 'first', photoRefs: ['a.jpg'] });
    await createLog({ projectId, authorPhone: '3519009', note: 'second', photoRefs: ['b.jpg'] });
    const logs = await listLogs(projectId);
    expect(logs[0].note).toBe('second');
  });
});
