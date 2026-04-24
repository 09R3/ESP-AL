const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const configSvc = require('../services/config');
const storage = require('../services/storage');

function guardCamera(req, res) {
  if (!configSvc.getCameraConfig(req.params.id)) {
    res.status(404).json({ error: 'Camera not found' });
    return false;
  }
  return true;
}

function guardPath(filePath, baseDir, res) {
  const resolved = path.resolve(filePath);
  const base = path.resolve(baseDir);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  if (!fs.existsSync(resolved)) {
    res.status(404).json({ error: 'File not found' });
    return false;
  }
  return true;
}

// GET /api/cameras/:id/photos  — list dates
router.get('/:id/photos', (req, res) => {
  if (!guardCamera(req, res)) return;
  const dates = storage.listDates(req.params.id);
  res.json(dates.reverse().map(date => ({
    date,
    count: storage.listPhotos(req.params.id, date).length,
  })));
});

// GET /api/cameras/:id/photos/:date  — list filenames
router.get('/:id/photos/:date', (req, res) => {
  if (!guardCamera(req, res)) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) return res.status(400).json({ error: 'Invalid date' });
  res.json(storage.listPhotos(req.params.id, req.params.date));
});

// GET /api/cameras/:id/photos/:date/:filename  — serve photo
router.get('/:id/photos/:date/:filename', (req, res) => {
  if (!guardCamera(req, res)) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) return res.status(400).json({ error: 'Invalid date' });
  const filePath = path.join(storage.rawDir(req.params.id, req.params.date), req.params.filename);
  if (!guardPath(filePath, storage.rawBaseDir(req.params.id), res)) return;
  res.sendFile(path.resolve(filePath));
});

// GET /api/cameras/:id/videos  — all video types combined
router.get('/:id/videos', (req, res) => {
  if (!guardCamera(req, res)) return;
  res.json({
    daily: storage.listVideos(req.params.id, 'daily'),
    monthly: storage.listVideos(req.params.id, 'monthly'),
    yearly: storage.listVideos(req.params.id, 'yearly'),
  });
});

// GET /api/cameras/:id/videos/:type  — list by type
router.get('/:id/videos/:type', (req, res) => {
  if (!guardCamera(req, res)) return;
  if (!['daily', 'monthly', 'yearly'].includes(req.params.type)) return res.status(400).json({ error: 'Invalid type' });
  res.json(storage.listVideos(req.params.id, req.params.type));
});

// GET /api/cameras/:id/videos/:type/:filename  — serve video
router.get('/:id/videos/:type/:filename', (req, res) => {
  if (!guardCamera(req, res)) return;
  const { id, type, filename } = req.params;
  if (!['daily', 'monthly', 'yearly'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
  const filePath = path.join(storage.videosDir(id, type), filename);
  if (!guardPath(filePath, storage.videosBaseDir(id), res)) return;
  res.sendFile(path.resolve(filePath));
});

module.exports = router;
