// Request classifier (T12). Classifies a customer request into a category and
// urgency. Tries the model interface first; falls back to a deterministic
// keyword classifier when no model is installed (or it fails), so the brain
// always returns a usable result.

import { callModel } from './model.js';
import { REQUEST_CATEGORIES } from '../models/customerRequest.js';

const URGENCIES = ['low', 'normal', 'high', 'urgent'];

// Keyword tables (Portuguese + English) for the deterministic fallback.
const CATEGORY_KEYWORDS = [
  ['change_request', ['mudar', 'alterar', 'trocar', 'adicionar', 'change', 'add', 'instead', 'upgrade', 'extra']],
  ['scheduling',     ['quando', 'data', 'agendar', 'marcar', 'horário', 'schedule', 'when', 'reschedule', 'visit']],
  ['complaint',      ['mau', 'péssimo', 'insatisfeito', 'reclam', 'inaceitável', 'complaint', 'unhappy', 'terrible', 'unacceptable']],
  ['issue',         ['problema', 'avaria', 'fuga', 'rachadura', 'partido', 'não funciona', 'broken', 'leak', 'crack', 'issue', 'fault', 'not working']],
  ['question',      ['?', 'como', 'porque', 'pode', 'será', 'how', 'why', 'can you', 'what', 'is it']],
];

const URGENT_KEYWORDS = ['urgente', 'emergência', 'agora', 'imediato', 'urgent', 'emergency', 'asap', 'now', 'immediately'];
const HIGH_KEYWORDS   = ['hoje', 'rápido', 'importante', 'today', 'soon', 'important', 'leak', 'fuga', 'water', 'água'];

/** Deterministic keyword classifier — the always-available fallback. */
export function keywordClassify(text) {
  const lower = String(text || '').toLowerCase();

  let category = 'question';
  for (const [cat, words] of CATEGORY_KEYWORDS) {
    if (words.some((w) => lower.includes(w))) { category = cat; break; }
  }

  let urgency = 'normal';
  if (URGENT_KEYWORDS.some((w) => lower.includes(w))) urgency = 'urgent';
  else if (HIGH_KEYWORDS.some((w) => lower.includes(w))) urgency = 'high';
  else if (category === 'complaint' || category === 'issue') urgency = 'high';

  return { category, urgency };
}

function normalize(result, text) {
  const fallback = keywordClassify(text);
  if (!result || typeof result !== 'object') return fallback;
  const category = REQUEST_CATEGORIES.includes(result.category) ? result.category : fallback.category;
  const urgency  = URGENCIES.includes(result.urgency) ? result.urgency : fallback.urgency;
  return { category, urgency };
}

/**
 * Classify a request. Uses the model when available (expects strict JSON back),
 * otherwise the keyword fallback. Always returns { category, urgency }.
 */
export async function classifyRequest(text) {
  const out = await callModel({
    system: 'Classify the construction customer message. Reply with ONLY JSON: ' +
      '{"category": one of [issue,question,change_request,scheduling,complaint], ' +
      '"urgency": one of [low,normal,high,urgent]}.',
    prompt: String(text || ''),
  });

  if (!out) return keywordClassify(text);

  try {
    const match = out.match(/\{[\s\S]*\}/);
    return normalize(JSON.parse(match ? match[0] : out), text);
  } catch {
    return keywordClassify(text);
  }
}
