import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { newDb } from 'pg-mem';
import { setPool, query } from '../src/db.js';
import { runMigrations } from '../migrations/run.js';
import { createProject } from '../src/models/project.js';
import { createLog } from '../src/models/dailyLog.js';
import { setModelClient, resetModelClient } from '../src/brain/model.js';
import {
  collectDay, plainDailySummary, summarizeDay, dailyClientUpdate,
} from '../src/brain/dailySummary.js';

beforeAll(async () => {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  setPool(new Pool());
  await runMigrations();
});

let project;
beforeEach(async () => {
  await query('DELETE FROM daily_logs');
  await query('DELETE FROM projects');
  project = await createProject({
    name: 'Santa Rita', clientPhone: '3519001', workerPhones: ['3519009'], budget: 85000,
  });
});
afterEach(() => resetModelClient());

describe('daily summary — metrics collection', () => {
  it('aggregates crew, hours and photos for the latest day', async () => {
    await createLog({
      projectId: project.id, authorPhone: '3519009', note: 'Pintura dos portões.',
      weather: 'sol', crewCount: 2, hours: 8, photoRefs: ['a.jpg', 'b.jpg'],
    });
    const day = await collectDay(project.id);
    expect(day.metrics.entries).toBe(1);
    expect(day.metrics.crew).toBe(2);
    expect(day.metrics.hours).toBe(8);
    expect(day.metrics.photos).toBe(2);
    expect(day.metrics.notes).toContain('Pintura dos portões.');
  });

  it('returns empty metrics when there are no logs', async () => {
    const day = await collectDay(project.id);
    expect(day.metrics.entries).toBe(0);
  });
});

describe('daily summary — deterministic fallback', () => {
  it('builds a client-readable sentence from notes and facts', () => {
    const text = plainDailySummary('Santa Rita', {
      date: '2026-06-22',
      metrics: { entries: 1, crew: 3, hours: 9, photos: 4, weather: 'nublado', notes: ['Avançámos na cozinha.'] },
    });
    expect(text).toContain('Santa Rita');
    expect(text).toContain('Avançámos na cozinha.');
    expect(text).toContain('3 pessoa');
    expect(text).toContain('4 foto');
  });

  it('notes when a day has no activity', () => {
    const text = plainDailySummary('Santa Rita', {
      date: '2026-06-22', metrics: { entries: 0, crew: 0, hours: 0, photos: 0, weather: null, notes: [] },
    });
    expect(text).toContain('sem registos');
  });
});

describe('daily summary — model degradation', () => {
  it('uses the model output when a client is installed', async () => {
    setModelClient(async () => 'Olá! Hoje avançámos bem com a pintura exterior. Tudo a correr conforme planeado.');
    await createLog({ projectId: project.id, authorPhone: '3519009', note: 'Pintura.', crewCount: 2, hours: 8 });
    const day = await collectDay(project.id);
    const out = await summarizeDay('Santa Rita', day);
    expect(out).toContain('pintura exterior');
  });

  it('falls back to deterministic text when the model returns nothing', async () => {
    setModelClient(async () => null);
    await createLog({ projectId: project.id, authorPhone: '3519009', note: 'Pintura.', crewCount: 2, hours: 8 });
    const day = await collectDay(project.id);
    const out = await summarizeDay('Santa Rita', day);
    expect(out).toContain('Santa Rita');
    expect(out).toContain('Pintura.');
  });

  it('does not call the model for an empty day (returns fallback)', async () => {
    let called = false;
    setModelClient(async () => { called = true; return 'should not be used'; });
    const day = await collectDay(project.id);
    const out = await summarizeDay('Santa Rita', day);
    expect(called).toBe(false);
    expect(out).toContain('sem registos');
  });
});

describe('daily summary — end to end', () => {
  it('returns date, summary and metrics', async () => {
    await createLog({ projectId: project.id, authorPhone: '3519009', note: 'Dia produtivo.', crewCount: 2, hours: 8, photoRefs: ['x.jpg'] });
    const res = await dailyClientUpdate(project);
    expect(res.summary).toContain('Santa Rita');
    expect(res.metrics.photos).toBe(1);
    expect(res.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
