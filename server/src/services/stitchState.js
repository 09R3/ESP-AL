// In-memory stitch job tracker. Resets on server restart (acceptable — jobs are short-lived).
const state = new Map();

function key(cameraId, type, period) {
  return `${cameraId}:${type}:${period}`;
}

function setRunning(cameraId, type, period) {
  state.set(key(cameraId, type, period), {
    cameraId, type, period,
    status: 'running',
    startedAt: Date.now(),
  });
}

function setDone(cameraId, type, period, outputPath) {
  const existing = state.get(key(cameraId, type, period)) || {};
  state.set(key(cameraId, type, period), {
    ...existing,
    status: 'done',
    completedAt: Date.now(),
    outputPath,
  });
}

function setError(cameraId, type, period, err) {
  const existing = state.get(key(cameraId, type, period)) || {};
  state.set(key(cameraId, type, period), {
    ...existing,
    status: 'error',
    completedAt: Date.now(),
    error: err.message || String(err),
  });
}

function getStatus(cameraId, type, period) {
  return state.get(key(cameraId, type, period)) || null;
}

function getAllForCamera(cameraId) {
  const results = [];
  for (const v of state.values()) {
    if (v.cameraId === cameraId) results.push(v);
  }
  return results.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

function isRunning(cameraId, type, period) {
  const s = getStatus(cameraId, type, period);
  return s != null && s.status === 'running';
}

function hasAnyRunning() {
  for (const v of state.values()) {
    if (v.status === 'running') return true;
  }
  return false;
}

module.exports = { setRunning, setDone, setError, getStatus, getAllForCamera, isRunning, hasAnyRunning };
