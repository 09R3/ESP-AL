const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

function dataDir() {
  return process.env.DATA_DIR || '/app/data';
}

function camerasDir() {
  return path.join(dataDir(), 'cameras');
}

function cameraDir(cameraId) {
  return path.join(camerasDir(), cameraId);
}

function rawBaseDir(cameraId) {
  return path.join(cameraDir(cameraId), 'raw');
}

function rawDir(cameraId, date) {
  return path.join(rawBaseDir(cameraId), date);
}

function videosBaseDir(cameraId) {
  return path.join(cameraDir(cameraId), 'videos');
}

function videosDir(cameraId, type) {
  return path.join(videosBaseDir(cameraId), type);
}

function dailyVideoPath(cameraId, date) {
  return path.join(videosDir(cameraId, 'daily'), `${date}.mp4`);
}

function monthlyVideoPath(cameraId, yearMonth) {
  return path.join(videosDir(cameraId, 'monthly'), `${yearMonth}.mp4`);
}

function yearlyVideoPath(cameraId, year) {
  return path.join(videosDir(cameraId, 'yearly'), `${year}.mp4`);
}

function previewPath(cameraId) {
  return path.join(cameraDir(cameraId), 'preview.jpg');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function listDates(cameraId) {
  const dir = rawBaseDir(cameraId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f) && fs.statSync(path.join(dir, f)).isDirectory())
    .sort();
}

function listPhotos(cameraId, date) {
  const dir = rawDir(cameraId, date);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .sort();
}

function listVideos(cameraId, type) {
  const dir = videosDir(cameraId, type);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.mp4'))
    .sort()
    .reverse();
}

function deleteRawPhotos(cameraId, date) {
  const dir = rawDir(cameraId, date);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

async function getDirSizeBytes(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  try {
    const { stdout } = await execAsync(`du -sb "${dirPath}" 2>/dev/null`);
    return parseInt(stdout.split('\t')[0], 10) || 0;
  } catch {
    return 0;
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

module.exports = {
  dataDir,
  camerasDir,
  cameraDir,
  rawBaseDir,
  rawDir,
  videosBaseDir,
  videosDir,
  dailyVideoPath,
  monthlyVideoPath,
  yearlyVideoPath,
  previewPath,
  ensureDir,
  listDates,
  listPhotos,
  listVideos,
  deleteRawPhotos,
  getDirSizeBytes,
  formatBytes,
};
