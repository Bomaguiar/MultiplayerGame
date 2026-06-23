// AI-phrased daily site summary for clients (WhatsApp-ready).
//
// Turns a day's raw site logs — notes, crew, hours, photo counts — into one
// short, warm, client-friendly paragraph in Portuguese. Follows the brain seam
// pattern: a deterministic fallback always works, and the model only upgrades
// the phrasing when ANTHROPIC_API_KEY is wired in. Built so partner firms can
// keep clients informed in seconds instead of writing updates by hand.

import { listLogs } from '../models/dailyLog.js';
import { callModel } from './model.js';

// Normalize a timestamp (ISO string or pg Date object) to a YYYY-MM-DD key.
const dayKey = (ts) => {
  if (!ts) return '';
  if (ts instanceof Date) return ts.toISOString().slice(0, 10);
  const s = String(ts);
  // Already an ISO-ish string starting with the date.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s.slice(0, 10) : d.toISOString().slice(0, 10);
};

/** Collect the logs for one calendar day (defaults to the most recent day). */
export async function collectDay(projectId, date = null) {
  const logs = await listLogs(projectId, 50).catch(() => []);
  if (!logs.length) return { date: date || dayKey(new Date().toISOString()), logs: [], metrics: emptyMetrics() };

  const target = date || dayKey(logs[0].logged_at);
  const dayLogs = logs.filter((l) => dayKey(l.logged_at) === target);

  return { date: target, logs: dayLogs, metrics: summarizeMetrics(dayLogs) };
}

function emptyMetrics() {
  return { entries: 0, crew: 0, hours: 0, photos: 0, weather: null, notes: [] };
}

function summarizeMetrics(logs) {
  const m = emptyMetrics();
  for (const l of logs) {
    m.entries += 1;
    m.crew = Math.max(m.crew, Number(l.crew_count || 0));
    m.hours += Number(l.hours || 0);
    m.photos += (l.photo_refs || []).length;
    if (!m.weather && l.weather) m.weather = l.weather;
    if (l.note) m.notes.push(l.note);
  }
  return m;
}

/** Deterministic client update used as the fallback (and the model's source). */
export function plainDailySummary(projectName, { date, metrics }) {
  if (!metrics.entries) {
    return `${projectName} — ${date}: sem registos de obra neste dia.`;
  }
  const parts = [];
  if (metrics.notes.length) parts.push(metrics.notes.join(' '));
  const facts = [];
  if (metrics.crew) facts.push(`${metrics.crew} pessoa(s) em obra`);
  if (metrics.hours) facts.push(`${metrics.hours}h trabalhadas`);
  if (metrics.photos) facts.push(`${metrics.photos} foto(s)`);
  if (metrics.weather) facts.push(metrics.weather);
  let text = `${projectName} — ${date}. ${parts.join(' ')}`.trim();
  if (facts.length) text += ` (${facts.join(', ')}).`;
  return text;
}

/** AI-phrased client update, degrading to plainDailySummary() with no model. */
export async function summarizeDay(projectName, day) {
  const fallback = plainDailySummary(projectName, day);
  if (!day.metrics.entries) return fallback;
  const out = await callModel({
    system: 'És o gestor de obra da Pedra & Luz. Escreve uma atualização curta, calorosa e profissional '
      + 'para o cliente (2-3 frases, em português de Portugal). Não inventes factos; usa apenas os dados fornecidos. '
      + 'Tom: tranquilizador e claro, como um arquiteto que cuida do projeto. Não uses emojis em excesso (no máximo um).',
    prompt: `Escreve a atualização do dia para o cliente.\nProjeto: ${projectName}\nDia: ${day.date}\n`
      + `Dados: ${JSON.stringify(day.metrics)}`,
  });
  return out || fallback;
}

/** End-to-end: collect a project's day and return a client-ready summary. */
export async function dailyClientUpdate(project, date = null) {
  const day = await collectDay(project.id, date);
  const summary = await summarizeDay(project.name, day);
  return { date: day.date, summary, metrics: day.metrics };
}
