// Pluggable AI model interface for the "brain" features (dashboard rollups,
// request triage, materials summaries).
//
// The whole platform must run — and be fully testable — without any external
// model service. So the model client is OFF by default: callModel() returns
// null, and every caller falls back to deterministic phrasing/logic. Tests (and
// production, once a real client is wired) inject a client via setModelClient().
//
//   setModelClient(async ({ system, prompt }) => '...text...');  // enable
//   resetModelClient();                                          // disable

let client = null;

/** Install a model client: an async ({ system, prompt }) => string. */
export function setModelClient(fn) {
  client = typeof fn === 'function' ? fn : null;
}

/** Remove any installed client (back to deterministic-only mode). */
export function resetModelClient() {
  client = null;
}

/** True when a model client is available. */
export function modelAvailable() {
  return client !== null;
}

/**
 * Call the model. Returns the generated text, or null when no client is
 * installed or the client throws — callers MUST handle null with a fallback.
 */
export async function callModel({ system = '', prompt }) {
  if (!client) return null;
  try {
    const out = await client({ system, prompt });
    return (typeof out === 'string' && out.trim()) ? out.trim() : null;
  } catch {
    return null;
  }
}
