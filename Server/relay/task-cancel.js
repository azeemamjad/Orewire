/** Cooperative stop signals for in-process Relay tasks (no child PID to kill). */

class TaskStoppedError extends Error {
  constructor(message = 'Task stopped by user') {
    super(message);
    this.name = 'TaskStoppedError';
  }
}

/** @type {Map<string, { workerId: string|null, taskSlug: string|null }>} */
const activeSessions = new Map();
/** @type {Set<string>} */
const stopFlags = new Set();

function registerSession(cancelKey, meta = {}) {
  if (!cancelKey) return;
  activeSessions.set(cancelKey, {
    workerId: meta.workerId || null,
    taskSlug: meta.taskSlug || null,
  });
  stopFlags.delete(cancelKey);
}

function unregisterSession(cancelKey) {
  if (!cancelKey) return;
  activeSessions.delete(cancelKey);
  stopFlags.delete(cancelKey);
}

function isStopRequested(cancelKey) {
  return cancelKey ? stopFlags.has(cancelKey) : false;
}

function getActiveWorkerId(cancelKey) {
  return activeSessions.get(cancelKey)?.workerId || null;
}

function interruptWorker(workerId) {
  if (!workerId) return;
  const { pool } = require('./pool');
  const w = pool.getWorker(workerId);
  if (!w) return;
  if (typeof w._humanResume === 'function') {
    try { w._humanResume('stopped'); } catch { /* ignore */ }
  }
  try { w.cdp?.send('Page.stopLoading'); } catch { /* ignore */ }
}

function requestStop(cancelKey) {
  if (!cancelKey) return;
  stopFlags.add(cancelKey);
  const session = activeSessions.get(cancelKey);
  if (session?.workerId) interruptWorker(session.workerId);
}

function clearStop(cancelKey) {
  if (!cancelKey) return;
  stopFlags.delete(cancelKey);
}

module.exports = {
  TaskStoppedError,
  registerSession,
  unregisterSession,
  isStopRequested,
  requestStop,
  clearStop,
  getActiveWorkerId,
  interruptWorker,
};
