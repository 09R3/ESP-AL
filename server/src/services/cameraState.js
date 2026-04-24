// In-memory per-camera runtime state reported by ESP32 devices.
const state = new Map();

function update(cameraId, data) {
  state.set(cameraId, {
    ...(state.get(cameraId) || {}),
    ...data,
    updatedAt: Date.now(),
  });
}

function get(cameraId) {
  return state.get(cameraId) || null;
}

function getAll() {
  return Object.fromEntries(state);
}

module.exports = { update, get, getAll };
