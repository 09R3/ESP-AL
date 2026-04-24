const fs = require('fs');
const path = require('path');

const GLOBAL_DEFAULTS = {
  defaultIntervalMinutes: 1,
  defaultQuality: 'full',
  defaultPushTime: '02:00',
  deleteAfterStitch: true,
};

function configDir() {
  return path.join(process.env.DATA_DIR || '/app/data', 'config');
}

function ensureConfigDir() {
  fs.mkdirSync(configDir(), { recursive: true });
}

function getGlobalSettings() {
  ensureConfigDir();
  const file = path.join(configDir(), 'settings.json');
  if (!fs.existsSync(file)) return { ...GLOBAL_DEFAULTS };
  try {
    return { ...GLOBAL_DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return { ...GLOBAL_DEFAULTS };
  }
}

function saveGlobalSettings(settings) {
  ensureConfigDir();
  fs.writeFileSync(path.join(configDir(), 'settings.json'), JSON.stringify(settings, null, 2));
}

function getCameraConfig(cameraId) {
  const file = path.join(configDir(), `${cameraId}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function saveCameraConfig(cameraId, config) {
  ensureConfigDir();
  fs.writeFileSync(path.join(configDir(), `${cameraId}.json`), JSON.stringify(config, null, 2));
}

function deleteCameraConfig(cameraId) {
  const file = path.join(configDir(), `${cameraId}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function listCameras() {
  ensureConfigDir();
  return fs.readdirSync(configDir())
    .filter(f => f !== 'settings.json' && f.endsWith('.json'))
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(configDir(), f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function getCameraConfigMerged(cameraId) {
  const global = getGlobalSettings();
  const cam = getCameraConfig(cameraId);
  if (!cam) return null;
  return {
    intervalMinutes: global.defaultIntervalMinutes,
    quality: global.defaultQuality,
    pushTime: global.defaultPushTime,
    captureEnabled: true,
    ...cam,
  };
}

module.exports = {
  getGlobalSettings,
  saveGlobalSettings,
  getCameraConfig,
  saveCameraConfig,
  deleteCameraConfig,
  listCameras,
  getCameraConfigMerged,
};
