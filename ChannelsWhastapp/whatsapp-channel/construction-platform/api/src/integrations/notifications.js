const NOTIFICATIONS_LOG = [];

export function getNotificationLog() {
  return NOTIFICATIONS_LOG.slice(-50);
}

export function clearNotificationLog() {
  NOTIFICATIONS_LOG.length = 0;
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
  return notification;
}
