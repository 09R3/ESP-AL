const express = require('express');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const configSvc = require('../services/config');
const storage = require('../services/storage');

function buildStorage() {
  return multer.diskStorage({
    destination(req, file, cb) {
      const { id } = req.params;
      const isPreview = req.query.preview === 'true';
      if (isPreview) {
        const dir = storage.cameraDir(id);
        storage.ensureDir(dir);
        cb(null, dir);
      } else {
        const date = req.query.date || new Date().toISOString().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return cb(new Error('Invalid date format'));
        const dir = storage.rawDir(id, date);
        storage.ensureDir(dir);
        cb(null, dir);
      }
    },
    filename(req, file, cb) {
      if (req.query.preview === 'true') return cb(null, 'preview.jpg');
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      const seq = req.query.seq ? String(req.query.seq).padStart(4, '0') : String(Date.now());
      cb(null, `${seq}${ext}`);
    },
  });
}

const upload = multer({
  storage: buildStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (/image\/(jpeg|png|jpg)/i.test(file.mimetype) || /\.(jpg|jpeg|png)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG/PNG images allowed'));
    }
  },
});

// POST /api/cameras/:id/upload
router.post('/:id/upload', (req, res) => {
  const existing = configSvc.getCameraConfig(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Camera not found' });

  upload.single('photo')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const isPreview = req.query.preview === 'true';
    if (isPreview) {
      configSvc.saveCameraConfig(req.params.id, { ...existing, previewRequested: false });
    }

    res.json({
      ok: true,
      preview: isPreview,
      filename: req.file.filename,
      size: req.file.size,
    });
  });
});

module.exports = router;
