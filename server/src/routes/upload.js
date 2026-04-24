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
// Accepts either:
//   multipart/form-data  with field "photo"  (dashboard / curl)
//   image/jpeg           raw bytes            (ESP32 HTTPClient)
router.post('/:id/upload', (req, res) => {
  const existing = configSvc.getCameraConfig(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Camera not found' });

  const ct = req.headers['content-type'] || '';

  // ── Raw binary upload from ESP32 ──────────────────────────────────────────
  if (ct.startsWith('image/')) {
    const isPreview = req.query.preview === 'true';
    const date      = req.query.date || new Date().toISOString().slice(0, 10);

    if (!isPreview && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    const filename = isPreview
      ? 'preview.jpg'
      : `${String(req.query.seq || Date.now()).padStart(4, '0')}.jpg`;

    const dir = isPreview ? storage.cameraDir(req.params.id) : storage.rawDir(req.params.id, date);
    storage.ensureDir(dir);

    const filePath = path.join(dir, filename);
    const chunks   = [];

    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      require('fs').writeFileSync(filePath, buf);

      if (isPreview) {
        configSvc.saveCameraConfig(req.params.id, { ...existing, previewRequested: false });
      }

      res.json({ ok: true, preview: isPreview, filename, size: buf.length });
    });
    req.on('error', err => res.status(500).json({ error: err.message }));
    return;
  }

  // ── Multipart upload (dashboard / curl) ───────────────────────────────────
  upload.single('photo')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const isPreview = req.query.preview === 'true';
    if (isPreview) {
      configSvc.saveCameraConfig(req.params.id, { ...existing, previewRequested: false });
    }

    res.json({ ok: true, preview: isPreview, filename: req.file.filename, size: req.file.size });
  });
});

module.exports = router;
