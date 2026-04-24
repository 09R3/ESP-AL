const express = require('express');
const router = express.Router();
const configSvc = require('../services/config');
const storage = require('../services/storage');

// GET /api/storage
router.get('/', async (req, res) => {
  try {
    const cameras = configSvc.listCameras();
    const stats = await Promise.all(
      cameras.map(async cam => {
        const rawBytes = await storage.getDirSizeBytes(storage.rawBaseDir(cam.id));
        const videoBytes = await storage.getDirSizeBytes(storage.videosBaseDir(cam.id));
        return {
          id: cam.id,
          label: cam.label || cam.id,
          rawBytes,
          videoBytes,
          totalBytes: rawBytes + videoBytes,
          rawFormatted: storage.formatBytes(rawBytes),
          videoFormatted: storage.formatBytes(videoBytes),
          totalFormatted: storage.formatBytes(rawBytes + videoBytes),
        };
      })
    );
    const totalBytes = stats.reduce((s, c) => s + c.totalBytes, 0);
    res.json({ cameras: stats, totalBytes, totalFormatted: storage.formatBytes(totalBytes) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
