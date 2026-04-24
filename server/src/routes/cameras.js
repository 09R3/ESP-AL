const express = require('express');
const fs = require('fs');
const router = express.Router();
const configSvc = require('../services/config');
const cameraState = require('../services/cameraState');
const storage = require('../services/storage');
const ffmpegSvc = require('../services/ffmpeg');
const stitchState = require('../services/stitchState');

// GET /api/cameras
router.get('/', (req, res) => {
  try {
    const cameras = configSvc.listCameras();
    res.json(cameras.map(cam => ({ ...cam, status: cameraState.get(cam.id) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cameras
router.post('/', (req, res) => {
  try {
    const { id, label } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) return res.status(400).json({ error: 'id may only contain letters, numbers, hyphens, underscores' });
    if (configSvc.getCameraConfig(id)) return res.status(409).json({ error: 'Camera already exists' });

    const global = configSvc.getGlobalSettings();
    const config = {
      id,
      label: label || id,
      intervalMinutes: global.defaultIntervalMinutes,
      quality: global.defaultQuality,
      pushTime: global.defaultPushTime,
      captureEnabled: true,
      registeredAt: new Date().toISOString(),
    };
    configSvc.saveCameraConfig(id, config);

    storage.ensureDir(storage.rawBaseDir(id));
    storage.ensureDir(storage.videosDir(id, 'daily'));
    storage.ensureDir(storage.videosDir(id, 'monthly'));
    storage.ensureDir(storage.videosDir(id, 'yearly'));

    res.status(201).json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cameras/:id
router.delete('/:id', (req, res) => {
  try {
    if (!configSvc.getCameraConfig(req.params.id)) return res.status(404).json({ error: 'Camera not found' });
    configSvc.deleteCameraConfig(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cameras/:id/config  (consumed by ESP32 on wake)
router.get('/:id/config', (req, res) => {
  try {
    const config = configSvc.getCameraConfigMerged(req.params.id);
    if (!config) return res.status(404).json({ error: 'Camera not found' });

    // Clear preview flag once served to ESP32
    if (config.previewRequested) {
      const raw = configSvc.getCameraConfig(req.params.id);
      configSvc.saveCameraConfig(req.params.id, { ...raw, previewRequested: false });
    }

    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cameras/:id/config  (from dashboard)
router.post('/:id/config', (req, res) => {
  try {
    const existing = configSvc.getCameraConfig(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Camera not found' });

    const allowed = ['label', 'intervalMinutes', 'quality', 'pushTime', 'captureEnabled'];
    const updates = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }

    const updated = { ...existing, ...updates };
    configSvc.saveCameraConfig(req.params.id, updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cameras/:id/status  (from ESP32)
router.post('/:id/status', (req, res) => {
  try {
    const existing = configSvc.getCameraConfig(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Camera not found' });

    cameraState.update(req.params.id, req.body);

    // Auto-trigger daily stitch when ESP32 reports push complete
    if (req.body.pushComplete && req.body.pushComplete.date) {
      const { date } = req.body.pushComplete;
      if (!stitchState.isRunning(req.params.id, 'daily', date)) {
        stitchState.setRunning(req.params.id, 'daily', date);
        ffmpegSvc.stitchDaily(req.params.id, date)
          .then(outputPath => {
            stitchState.setDone(req.params.id, 'daily', date, outputPath);
            if (configSvc.getGlobalSettings().deleteAfterStitch) {
              storage.deleteRawPhotos(req.params.id, date);
            }
          })
          .catch(err => {
            stitchState.setError(req.params.id, 'daily', date, err);
            console.error(`[auto-stitch] ${req.params.id}/${date} failed:`, err.message);
          });
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cameras/:id/preview  (dashboard requests a snapshot)
router.get('/:id/preview', (req, res) => {
  try {
    const existing = configSvc.getCameraConfig(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Camera not found' });

    configSvc.saveCameraConfig(req.params.id, {
      ...existing,
      previewRequested: true,
      previewRequestedAt: Date.now(),
    });

    res.json({ status: 'requested' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cameras/:id/preview/latest  (serves the most recent preview image)
router.get('/:id/preview/latest', (req, res) => {
  try {
    const imgPath = storage.previewPath(req.params.id);
    if (!fs.existsSync(imgPath)) return res.status(404).json({ error: 'No preview available' });
    res.set('Cache-Control', 'no-store');
    res.sendFile(imgPath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
