// Notification dispatcher. Creates DB-backed notifications and keeps the
// legacy in-memory log for backwards compatibility.

import { createNotification } from '../models/notification.js';

const NOTIFICATIONS_LOG = [];

export function getNotificationLog() {
  return NOTIFICATIONS_LOG.slice(-50);
}

export function clearNotificationLog() {
  NOTIFICATIONS_LOG.length = 0;
}

/** Persist a notification to the DB, swallowing errors so callers are not
 *  disrupted if the notifications table is unavailable. */
async function persist(opts) {
  try {
    return await createNotification(opts);
  } catch {
    // DB may not have the notifications table yet (pre-migration). Silently
    // degrade to in-memory only.
    return null;
  }
}

export async function notifyChangeOrderDecision(changeOrder, project, decision) {
  const notification = {
    type: 'change_order_decision',
    timestamp: new Date().toISOString(),
    projectName: project.name,
    changeOrderTitle: changeOrder.title,
    decision,
    costDelta: changeOrder.cost_delta,
    decidedBy: changeOrder.decided_by,
    message: `Change order "${changeOrder.title}" was ${decision} for project ${project.name}. ` +
      `Cost impact: €${Number(changeOrder.cost_delta).toLocaleString('pt-PT')}`,
  };
  NOTIFICATIONS_LOG.push(notification);

  // Notify the founder about the customer's decision.
  await persist({
    projectId: project.id,
    recipientPhone: project.founder_phone || project.client_phone,
    type: 'change_order',
    title: `Alteração ${decision === 'approved' ? 'aprovada' : 'rejeitada'}: ${changeOrder.title}`,
    body: notification.message,
    channel: 'in_app',
    metadata: { changeOrderId: changeOrder.id, decision, costDelta: changeOrder.cost_delta },
  });

  return notification;
}

export async function notifyMaterialRequest(material, project) {
  const notification = {
    type: 'material_request',
    timestamp: new Date().toISOString(),
    projectName: project.name,
    item: material.item,
    qty: material.qty,
    urgency: material.urgency,
    requestedBy: material.requested_by,
    message: `New material request: ${material.qty}x ${material.item} (${material.urgency}) for project ${project.name}`,
  };
  NOTIFICATIONS_LOG.push(notification);

  // Notify the founder about the new material request.
  await persist({
    projectId: project.id,
    recipientPhone: project.founder_phone || project.client_phone,
    type: 'material_decision',
    title: `Pedido de material: ${material.item}`,
    body: notification.message,
    channel: 'in_app',
    metadata: { materialId: material.id, item: material.item, qty: material.qty, urgency: material.urgency },
  });

  return notification;
}

export async function notifyTaskStatusChange(task, fromStatus, toStatus, project) {
  const notification = {
    type: 'task_status_change',
    timestamp: new Date().toISOString(),
    projectName: project?.name ?? 'Unknown',
    taskTitle: task.title,
    fromStatus,
    toStatus,
    message: `Task "${task.title}" moved from ${fromStatus} to ${toStatus}`,
  };
  NOTIFICATIONS_LOG.push(notification);

  // Notify relevant parties: if the task has an assignee and the status change
  // was made by someone else, notify the assignee. Also notify the founder.
  const recipients = new Set();
  if (task.assignee_phone) recipients.add(task.assignee_phone);
  if (project?.founder_phone) recipients.add(project.founder_phone);
  if (project?.client_phone) recipients.add(project.client_phone);

  for (const phone of recipients) {
    await persist({
      projectId: project?.id ?? null,
      recipientPhone: phone,
      type: 'task_update',
      title: `Tarefa ${toStatus}: ${task.title}`,
      body: notification.message,
      channel: 'in_app',
      metadata: { taskId: task.id, fromStatus, toStatus },
    });
  }

  return notification;
}
