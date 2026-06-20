// Real Claude model client for the brain (T10/T12/T13).
//
// This wires the Anthropic SDK into the pluggable `brain/model.js` seam. It is
// OPT-IN: nothing here runs unless ANTHROPIC_API_KEY is set and initBrainModel()
// is called at boot. With no key the platform keeps using the deterministic
// fallbacks, so tests and offline/demo runs are unaffected.
//
// Cheap by design: dashboard rollups, request triage, and material summaries are
// short classification/phrasing calls, so we default to Haiku 4.5 — the fastest,
// most cost-effective model — with a tight max_tokens.

import Anthropic from '@anthropic-ai/sdk';
import { setModelClient } from './model.js';

// Haiku 4.5: cheapest/fastest tier, ample for one-sentence summaries and
// JSON classification. Override with BRAIN_MODEL if a task needs more.
const DEFAULT_MODEL = process.env.BRAIN_MODEL || 'claude-haiku-4-5';
const MAX_TOKENS = Number(process.env.BRAIN_MAX_TOKENS || 512);

/**
 * Install the Claude-backed model client if an API key is present.
 * Returns true if installed, false if left on the deterministic fallback.
 */
export function initBrainModel() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return false;

  const client = new Anthropic({ apiKey });

  // The seam's contract: async ({ system, prompt }) => string | null.
  setModelClient(async ({ system, prompt }) => {
    const res = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      system: system || undefined,
      messages: [{ role: 'user', content: prompt }],
    });
    // Concatenate text blocks; ignore any non-text content.
    return res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
  });

  return true;
}
