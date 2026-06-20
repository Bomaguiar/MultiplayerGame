// Request triage (T12). Classifies a customer request, records the result, and
// emits a notification to the role that should handle it. The classifier and
// notifier are both mockable, so triage is fully testable offline.

import { classifyRequest } from './classifier.js';
import { setTriage } from '../models/customerRequest.js';
import { usersByRole } from '../models/user.js';
import { createNotification } from '../models/notification.js';

// Which role should be alerted for each category.
const CATEGORY_ROLE = Object.freeze({
  issue:          'worker',   // field problem → the crew
  question:       'founder',
  change_request: 'founder',  // money/scope → the founder
  scheduling:     'founder',
  complaint:      'founder',  // trust-sensitive → the founder
});

/** Resolve the role responsible for a category (founder is the safe default). */
export function routeRole(category) {
  return CATEGORY_ROLE[category] ?? 'founder';
}

/** Best-effort recipient resolution: project members first, then role holders. */
async function recipientsFor(role, project) {
  const phones = new Set();
  if (role === 'worker' && project && Array.isArray(project.worker_phones)) {
    project.worker_phones.forEach((p) => phones.add(p));
  }
  // Always also alert the role holders (e.g. founders) registered in the system.
  try {
    (await usersByRole(role)).forEach((u) => phones.add(u.phone));
  } catch {
    // user lookup unavailable — fall back to whatever we have.
  }
  return [...phones];
}

/**
 * Triage a stored customer request:
 *  1. classify → { category, urgency }
 *  2. persist the triage onto the request
 *  3. notify the responsible role
 * Returns { request, category, urgency, role, notified }.
 */
export async function triageRequest(request, project = null) {
  const { category, urgency } = await classifyRequest(request.raw_text);
  const updated = await setTriage(request.id, { category, urgency }).catch(() => null);
  const role = routeRole(category);

  const recipients = await recipientsFor(role, project);
  let notified = 0;
  for (const phone of recipients) {
    const ok = await createNotification({
      projectId: request.project_id ?? null,
      recipientPhone: phone,
      type: 'system',
      title: `Pedido de cliente (${category}) — urgência ${urgency}`,
      body: request.raw_text,
      channel: 'in_app',
      metadata: { customerRequestId: request.id, category, urgency, role },
    }).then(() => true).catch(() => false);
    if (ok) notified += 1;
  }

  return { request: updated ?? request, category, urgency, role, notified };
}
