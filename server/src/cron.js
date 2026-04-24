const fs = require('fs');
const cron = require('node-cron');
const configSvc = require('./services/config');
const ffmpegSvc  = require('./services/ffmpeg');
const stitchState = require('./services/stitchState');
const storage    = require('./services/storage');

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function lastMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

async function runDailyCatchup(cameraId, date) {
  const photos = storage.listPhotos(cameraId, date);
  if (photos.length === 0) return;
  if (fs.existsSync(storage.dailyVideoPath(cameraId, date))) return;
  if (stitchState.isRunning(cameraId, 'daily', date)) return;

  stitchState.setRunning(cameraId, 'daily', date);
  ffmpegSvc.stitchDaily(cameraId, date)
    .then(p => {
      stitchState.setDone(cameraId, 'daily', date, p);
      if (configSvc.getGlobalSettings().deleteAfterStitch) storage.deleteRawPhotos(cameraId, date);
    })
    .catch(err => {
      stitchState.setError(cameraId, 'daily', date, err);
      console.error(`[cron] daily stitch failed ${cameraId}/${date}:`, err.message);
    });
}

function init() {
  // 3:30 AM daily — catch up on yesterday if auto-stitch was missed
  cron.schedule('30 3 * * *', () => {
    const date = yesterday();
    console.log(`[cron] daily catchup for ${date}`);
    configSvc.listCameras().forEach(cam => runDailyCatchup(cam.id, date));
  });

  // 00:05 on 1st of each month — stitch previous month
  cron.schedule('5 0 1 * *', () => {
    const { year, month } = lastMonth();
    const period = `${year}-${String(month).padStart(2, '0')}`;
    console.log(`[cron] monthly stitch for ${period}`);
    configSvc.listCameras().forEach(cam => {
      if (stitchState.isRunning(cam.id, 'monthly', period)) return;
      stitchState.setRunning(cam.id, 'monthly', period);
      ffmpegSvc.stitchMonthly(cam.id, year, month)
        .then(p => stitchState.setDone(cam.id, 'monthly', period, p))
        .catch(err => {
          stitchState.setError(cam.id, 'monthly', period, err);
          console.error(`[cron] monthly stitch failed ${cam.id}/${period}:`, err.message);
        });
    });
  });

  // 00:10 on Jan 1st — stitch previous year
  cron.schedule('10 0 1 1 *', () => {
    const year = new Date().getFullYear() - 1;
    const period = String(year);
    console.log(`[cron] yearly stitch for ${period}`);
    configSvc.listCameras().forEach(cam => {
      if (stitchState.isRunning(cam.id, 'yearly', period)) return;
      stitchState.setRunning(cam.id, 'yearly', period);
      ffmpegSvc.stitchYearly(cam.id, year)
        .then(p => stitchState.setDone(cam.id, 'yearly', period, p))
        .catch(err => {
          stitchState.setError(cam.id, 'yearly', period, err);
          console.error(`[cron] yearly stitch failed ${cam.id}/${period}:`, err.message);
        });
    });
  });

  console.log('[cron] scheduled jobs initialised');
}

module.exports = { init };
