const express = require('express');
const router = express.Router();
const configSvc = require('../services/config');
const ffmpegSvc = require('../services/ffmpeg');
const stitchState = require('../services/stitchState');
const storage = require('../services/storage');

function launchStitch(cameraId, type, period, job) {
  if (stitchState.isRunning(cameraId, type, period)) {
    throw new Error('Stitch already running for this period');
  }
  stitchState.setRunning(cameraId, type, period);
  job()
    .then(outputPath => {
      stitchState.setDone(cameraId, type, period, outputPath);
      if (type === 'daily' && configSvc.getGlobalSettings().deleteAfterStitch) {
        storage.deleteRawPhotos(cameraId, period);
      }
    })
    .catch(err => {
      stitchState.setError(cameraId, type, period, err);
      console.error(`[stitch] ${cameraId}/${type}/${period} failed:`, err.message);
    });
}

// POST /api/cameras/:id/stitch/daily   body: { date: "YYYY-MM-DD" }
router.post('/:id/stitch/daily', (req, res) => {
  if (!configSvc.getCameraConfig(req.params.id)) return res.status(404).json({ error: 'Camera not found' });
  const { date } = req.body;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });

  try {
    launchStitch(req.params.id, 'daily', date, () => ffmpegSvc.stitchDaily(req.params.id, date));
    res.json({ ok: true, status: 'started', type: 'daily', period: date });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// POST /api/cameras/:id/stitch/monthly  body: { year, month }
router.post('/:id/stitch/monthly', (req, res) => {
  if (!configSvc.getCameraConfig(req.params.id)) return res.status(404).json({ error: 'Camera not found' });
  const { year, month } = req.body;
  if (!year || !month) return res.status(400).json({ error: 'year and month required' });

  const period = `${year}-${String(month).padStart(2, '0')}`;
  try {
    launchStitch(req.params.id, 'monthly', period, () => ffmpegSvc.stitchMonthly(req.params.id, Number(year), Number(month)));
    res.json({ ok: true, status: 'started', type: 'monthly', period });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// POST /api/cameras/:id/stitch/yearly   body: { year }
router.post('/:id/stitch/yearly', (req, res) => {
  if (!configSvc.getCameraConfig(req.params.id)) return res.status(404).json({ error: 'Camera not found' });
  const { year } = req.body;
  if (!year) return res.status(400).json({ error: 'year required' });

  const period = String(year);
  try {
    launchStitch(req.params.id, 'yearly', period, () => ffmpegSvc.stitchYearly(req.params.id, Number(year)));
    res.json({ ok: true, status: 'started', type: 'yearly', period });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// GET /api/cameras/:id/stitch/status
router.get('/:id/stitch/status', (req, res) => {
  if (!configSvc.getCameraConfig(req.params.id)) return res.status(404).json({ error: 'Camera not found' });
  res.json(stitchState.getAllForCamera(req.params.id));
});

module.exports = router;
