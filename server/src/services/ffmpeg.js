const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const storage = require('./storage');

const execAsync = promisify(exec);

async function stitchDaily(cameraId, date) {
  const inputDir = storage.rawDir(cameraId, date);
  const outputPath = storage.dailyVideoPath(cameraId, date);
  storage.ensureDir(path.dirname(outputPath));

  const photos = storage.listPhotos(cameraId, date);
  if (photos.length === 0) throw new Error(`No photos found for ${cameraId} on ${date}`);

  // Write a filelist for deterministic ordering
  const fileListPath = path.join(inputDir, '.ffmpeg-list.txt');
  const content = photos.map(f => `file '${path.join(inputDir, f).replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(fileListPath, content);

  try {
    const cmd = `ffmpeg -y -f concat -safe 0 -i '${fileListPath}' -r 30 -c:v libx264 -pix_fmt yuv420p -movflags +faststart '${outputPath}' 2>&1`;
    const { stdout } = await execAsync(cmd);
    console.log(`[ffmpeg] daily stitch ${cameraId}/${date}: ${photos.length} frames → ${outputPath}`);
    return outputPath;
  } finally {
    if (fs.existsSync(fileListPath)) fs.unlinkSync(fileListPath);
  }
}

async function stitchMonthly(cameraId, year, month) {
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const outputPath = storage.monthlyVideoPath(cameraId, yearMonth);
  storage.ensureDir(path.dirname(outputPath));

  const dailyVideos = storage.listVideos(cameraId, 'daily')
    .filter(f => f.startsWith(yearMonth))
    .sort();

  if (dailyVideos.length === 0) throw new Error(`No daily videos for ${cameraId} in ${yearMonth}`);

  const dailyDir = storage.videosDir(cameraId, 'daily');
  const fileListPath = path.join(path.dirname(outputPath), `.ffmpeg-list-${yearMonth}.txt`);
  const content = dailyVideos.map(f => `file '${path.join(dailyDir, f).replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(fileListPath, content);

  try {
    await execAsync(`ffmpeg -y -f concat -safe 0 -i '${fileListPath}' -c copy '${outputPath}' 2>&1`);
    console.log(`[ffmpeg] monthly stitch ${cameraId}/${yearMonth}: ${dailyVideos.length} days → ${outputPath}`);
    return outputPath;
  } finally {
    if (fs.existsSync(fileListPath)) fs.unlinkSync(fileListPath);
  }
}

async function stitchYearly(cameraId, year) {
  const outputPath = storage.yearlyVideoPath(cameraId, String(year));
  storage.ensureDir(path.dirname(outputPath));

  const monthlyVideos = storage.listVideos(cameraId, 'monthly')
    .filter(f => f.startsWith(String(year)))
    .sort();

  if (monthlyVideos.length === 0) throw new Error(`No monthly videos for ${cameraId} in ${year}`);

  const monthlyDir = storage.videosDir(cameraId, 'monthly');
  const fileListPath = path.join(path.dirname(outputPath), `.ffmpeg-list-${year}.txt`);
  const content = monthlyVideos.map(f => `file '${path.join(monthlyDir, f).replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(fileListPath, content);

  try {
    await execAsync(`ffmpeg -y -f concat -safe 0 -i '${fileListPath}' -c copy '${outputPath}' 2>&1`);
    console.log(`[ffmpeg] yearly stitch ${cameraId}/${year}: ${monthlyVideos.length} months → ${outputPath}`);
    return outputPath;
  } finally {
    if (fs.existsSync(fileListPath)) fs.unlinkSync(fileListPath);
  }
}

module.exports = { stitchDaily, stitchMonthly, stitchYearly };
