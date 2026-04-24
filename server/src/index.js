const express = require('express');
const path = require('path');
const cors = require('cors');

const camerasRouter = require('./routes/cameras');
const uploadRouter  = require('./routes/upload');
const stitchRouter  = require('./routes/stitch');
const mediaRouter   = require('./routes/media');
const statsRouter   = require('./routes/stats');
const cron          = require('./cron');

const app  = express();
const PORT = process.env.PORT || 3070;

app.use(cors());
app.use(express.json());

app.use('/api/cameras', camerasRouter);
app.use('/api/cameras', uploadRouter);
app.use('/api/cameras', stitchRouter);
app.use('/api/cameras', mediaRouter);
app.use('/api/storage',  statsRouter);

app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback — never intercept /api paths
app.get(/^(?!\/api)/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ESP-AL running on port ${PORT}`);
  cron.init();
});
