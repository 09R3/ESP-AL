/* ── State ───────────────────────────────────────────────────────────────── */
const S = {
  cameras:    [],
  selectedId: null,
  section:    'status',
  photoDate:  null,
  videoType:  'daily',
  stitchPoll: null,
  previewPoll: null,
};

/* ── DOM helpers ─────────────────────────────────────────────────────────── */
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const $id = id => document.getElementById(id);

/* ── HTML escaping ───────────────────────────────────────────────────────── */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Time formatting ─────────────────────────────────────────────────────── */
function fmt(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d)) return String(ts);
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function ago(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - Number(new Date(ts))) / 1000);
  if (s < 5)     return 'just now';
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return fmt(ts);
}

function fmtBytes(n) {
  if (!n || n === 0) return '0 B';
  const k = 1024, sz = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return `${(n / Math.pow(k, i)).toFixed(1)} ${sz[i]}`;
}

function elapsed(startMs) {
  const s = Math.floor((Date.now() - startMs) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/* ── Toast notifications ─────────────────────────────────────────────────── */
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $id('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/* ── Section helpers ─────────────────────────────────────────────────────── */
function sectionEl(name) { return $id(`section-${name}`); }

function secHead(tag, title, sub = '') {
  return `
    <div class="sec-head">
      <div class="sec-head-left">
        <span class="sec-tag">[${esc(tag)}]</span>
        <span class="sec-title">${esc(title)}</span>
        ${sub ? `<span class="sec-sub">${esc(sub)}</span>` : ''}
      </div>
    </div>
    <div class="sec-divider"></div>`;
}

function noCam() {
  return `<div class="no-cam">Select a camera from the sidebar to continue.</div>`;
}

/* ── API client ──────────────────────────────────────────────────────────── */
const api = {
  async get(path) {
    const r = await fetch(path);
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || r.statusText);
    return body;
  },
  async post(path, data = {}) {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || r.statusText);
    return body;
  },
  async del(path) {
    const r = await fetch(path, { method: 'DELETE' });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || r.statusText);
    return body;
  },
};

/* ── Navigation ──────────────────────────────────────────────────────────── */
function navigate(section) {
  stopStitchPoll();
  stopPreviewPoll();

  // Hide all sections
  $$('.section').forEach(el => el.classList.remove('active'));
  sectionEl(section).classList.add('active');

  // Update nav links
  $$('.nav-link').forEach(a => {
    a.classList.toggle('active', a.dataset.section === section);
  });

  S.section = section;
  loadSection();
}

async function loadSection() {
  switch (S.section) {
    case 'status':   return loadStatus();
    case 'preview':  return loadPreview();
    case 'photos':   return loadPhotos();
    case 'videos':   return loadVideos(S.videoType);
    case 'stitch':   return loadStitch();
    case 'settings': return loadSettings();
    case 'cameras':  return loadCameraList();
    case 'storage':  return loadStorage();
  }
}

/* ── Camera selector ─────────────────────────────────────────────────────── */
async function loadCameras() {
  try {
    S.cameras = await api.get('/api/cameras');
  } catch (e) {
    S.cameras = [];
  }
  renderSelector();
  updateHeaderCam();
}

function renderSelector() {
  const sel = $id('camera-select');
  const prev = sel.value;
  sel.innerHTML = S.cameras.length
    ? S.cameras.map(c => `<option value="${esc(c.id)}">${esc(c.label || c.id)} (${esc(c.id)})</option>`).join('')
    : `<option value="">— no cameras —</option>`;

  if (S.cameras.find(c => c.id === prev)) {
    sel.value = prev;
    S.selectedId = prev;
  } else if (S.cameras.length) {
    sel.value = S.cameras[0].id;
    S.selectedId = S.cameras[0].id;
  } else {
    S.selectedId = null;
  }
}

function selectedCam() {
  return S.cameras.find(c => c.id === S.selectedId) || null;
}

function updateHeaderCam() {
  const cam = selectedCam();
  $id('hdr-cam-label').textContent = cam
    ? `${cam.id}${cam.label && cam.label !== cam.id ? ' — ' + cam.label : ''}`
    : '';
}

/* ── Lightbox ────────────────────────────────────────────────────────────── */
function openLightbox(src) {
  $id('lb-img').src = src;
  $id('lightbox').classList.add('active');
}

function closeLightbox() {
  $id('lightbox').classList.remove('active');
  $id('lb-img').src = '';
}

/* ── Preview section ─────────────────────────────────────────────────────── */
async function loadPreview() {
  const cam = selectedCam();
  const el  = sectionEl('preview');
  if (!cam) { el.innerHTML = secHead('PREVIEW', 'Live Preview') + noCam(); return; }

  el.innerHTML = secHead('PREVIEW', 'Live Preview', cam.label || cam.id) + `
    <div class="flex-between mb-2">
      <button id="btn-req-preview" class="btn btn-primary">⊙ Request Snapshot</button>
      <span id="preview-status" class="text-dim" style="font-size:12px"></span>
    </div>
    <div id="preview-area" class="preview-area">
      <div class="preview-placeholder">
        <div class="ph-icon">⊙</div>
        <div>Click "Request Snapshot" to capture a live frame.</div>
        <div style="font-size:11px;margin-top:6px;color:var(--dim)">ESP32 takes the photo on its next config poll.</div>
      </div>
    </div>`;

  $id('btn-req-preview').addEventListener('click', requestPreview);
  tryLoadExistingPreview(cam.id);
}

async function requestPreview() {
  const cam = selectedCam();
  if (!cam) return;
  const btn = $id('btn-req-preview');
  btn.disabled = true;
  $id('preview-status').textContent = 'Requested — waiting for ESP32…';
  try {
    await api.get(`/api/cameras/${cam.id}/preview`);
    toast('Preview requested. Polling for image…', 'info');
    startPreviewPoll(cam.id);
  } catch (e) {
    toast(`Preview request failed: ${e.message}`, 'error');
    btn.disabled = false;
    $id('preview-status').textContent = '';
  }
}

async function tryLoadExistingPreview(camId) {
  try {
    const r = await fetch(`/api/cameras/${camId}/preview/latest`, { method: 'HEAD' });
    if (r.ok) showPreviewImage(camId);
  } catch {}
}

function showPreviewImage(camId) {
  const area = $id('preview-area');
  if (!area) return;
  const ts = Date.now();
  area.innerHTML = `<img src="/api/cameras/${esc(camId)}/preview/latest?t=${ts}" alt="preview" style="max-width:100%;max-height:600px;display:block;">`;
  const btn = $id('btn-req-preview');
  const st  = $id('preview-status');
  if (btn) btn.disabled = false;
  if (st)  st.textContent = `Last snapshot: ${new Date().toLocaleTimeString()}`;
}

function startPreviewPoll(camId) {
  stopPreviewPoll();
  let attempts = 0;
  S.previewPoll = setInterval(async () => {
    attempts++;
    try {
      const r = await fetch(`/api/cameras/${camId}/preview/latest`, { method: 'HEAD' });
      if (r.ok) {
        stopPreviewPoll();
        showPreviewImage(camId);
      }
    } catch {}
    if (attempts > 60) { // give up after ~2 min
      stopPreviewPoll();
      const btn = $id('btn-req-preview');
      const st  = $id('preview-status');
      if (btn) btn.disabled = false;
      if (st)  st.textContent = 'No response from camera.';
    }
  }, 2000);
}

function stopPreviewPoll() {
  if (S.previewPoll) { clearInterval(S.previewPoll); S.previewPoll = null; }
}

/* ── Photos section ──────────────────────────────────────────────────────── */
async function loadPhotos() {
  const cam = selectedCam();
  const el  = sectionEl('photos');
  if (!cam) { el.innerHTML = secHead('PHOTOS', 'Photo Browser') + noCam(); return; }

  el.innerHTML = secHead('PHOTOS', 'Photo Browser', cam.label || cam.id) + `
    <div class="split">
      <div class="split-left" id="date-list"><div class="loading"><span class="spinner"></span></div></div>
      <div class="split-right" id="photo-grid-wrap">
        <div class="empty">Select a date to browse photos.</div>
      </div>
    </div>`;

  try {
    const dates = await api.get(`/api/cameras/${cam.id}/photos`);
    const list  = $id('date-list');
    if (!dates.length) {
      list.innerHTML = `<div class="empty">No photos yet.</div>`;
      return;
    }
    list.innerHTML = dates.map(d => `
      <div class="list-item${S.photoDate === d.date ? ' active' : ''}" data-date="${esc(d.date)}">
        <span>${esc(d.date)}</span>
        <span class="list-count">${d.count}</span>
      </div>`).join('');

    list.addEventListener('click', e => {
      const item = e.target.closest('[data-date]');
      if (!item) return;
      S.photoDate = item.dataset.date;
      $$('#date-list .list-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      loadPhotoGrid(cam.id, S.photoDate);
    });

    if (S.photoDate && dates.find(d => d.date === S.photoDate)) {
      loadPhotoGrid(cam.id, S.photoDate);
    } else if (dates.length) {
      S.photoDate = dates[0].date;
      $('[data-date]', list)?.classList.add('active');
      loadPhotoGrid(cam.id, S.photoDate);
    }
  } catch (e) {
    $id('date-list').innerHTML = `<div class="empty text-red">${esc(e.message)}</div>`;
  }
}

async function loadPhotoGrid(camId, date) {
  const wrap = $id('photo-grid-wrap');
  wrap.innerHTML = `<div class="loading"><span class="spinner"></span></div>`;
  try {
    const files = await api.get(`/api/cameras/${camId}/photos/${date}`);
    if (!files.length) {
      wrap.innerHTML = `<div class="empty">No photos for ${esc(date)}.</div>`;
      return;
    }
    wrap.innerHTML = `
      <div style="margin-bottom:10px;font-size:12px;color:var(--dim)">${esc(date)} — ${files.length} photos</div>
      <div class="photo-grid">
        ${files.map(f => `
          <img src="/api/cameras/${esc(camId)}/photos/${esc(date)}/${esc(f)}"
               loading="lazy"
               alt="${esc(f)}"
               data-lightbox="/api/cameras/${esc(camId)}/photos/${esc(date)}/${esc(f)}">`
        ).join('')}
      </div>`;
    wrap.addEventListener('click', e => {
      const src = e.target.dataset.lightbox;
      if (src) openLightbox(src);
    });
  } catch (e) {
    wrap.innerHTML = `<div class="empty text-red">${esc(e.message)}</div>`;
  }
}

/* ── Videos section ──────────────────────────────────────────────────────── */
async function loadVideos(type = 'daily') {
  S.videoType = type;
  const cam = selectedCam();
  const el  = sectionEl('videos');
  if (!cam) { el.innerHTML = secHead('VIDEOS', 'Video Playback') + noCam(); return; }

  const tabs = ['daily', 'monthly', 'yearly'];
  el.innerHTML = secHead('VIDEOS', 'Video Playback', cam.label || cam.id) + `
    <div class="video-tabs">
      ${tabs.map(t => `<button class="video-tab${t === type ? ' active' : ''}" data-vtype="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</button>`).join('')}
    </div>
    <div class="video-split">
      <div class="video-list-panel" id="video-list"><div class="loading"><span class="spinner"></span></div></div>
      <div class="video-player-wrap" id="video-player-wrap">
        <div class="video-empty">Select a video to play.</div>
      </div>
    </div>`;

  el.querySelectorAll('.video-tab').forEach(btn => {
    btn.addEventListener('click', () => loadVideos(btn.dataset.vtype));
  });

  try {
    const files = await api.get(`/api/cameras/${cam.id}/videos/${type}`);
    const list  = $id('video-list');
    if (!files.length) {
      list.innerHTML = `<div class="video-empty">No ${type} videos yet.</div>`;
      return;
    }
    list.innerHTML = files.map(f => `
      <div class="video-item" data-file="${esc(f)}">
        <span class="video-item-name">${esc(f.replace('.mp4', ''))}</span>
        <span class="video-play-icon">▶</span>
      </div>`).join('');

    list.addEventListener('click', e => {
      const item = e.target.closest('[data-file]');
      if (!item) return;
      $$('#video-list .video-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      playVideo(cam.id, type, item.dataset.file);
    });
  } catch (e) {
    $id('video-list').innerHTML = `<div class="video-empty text-red">${esc(e.message)}</div>`;
  }
}

function playVideo(camId, type, filename) {
  const wrap = $id('video-player-wrap');
  const src  = `/api/cameras/${encodeURIComponent(camId)}/videos/${type}/${encodeURIComponent(filename)}`;
  wrap.innerHTML = `
    <div style="margin-bottom:8px;font-size:12px;color:var(--dim)">${esc(filename)}</div>
    <video controls autoplay>
      <source src="${esc(src)}" type="video/mp4">
      Your browser does not support HTML5 video.
    </video>`;
}

/* ── Stitch section ──────────────────────────────────────────────────────── */
async function loadStitch() {
  const cam = selectedCam();
  const el  = sectionEl('stitch');
  if (!cam) { el.innerHTML = secHead('STITCH', 'Stitch Controls') + noCam(); return; }

  const today = new Date().toISOString().slice(0, 10);
  const now   = new Date();
  const ym    = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  el.innerHTML = secHead('STITCH', 'Stitch Controls', cam.label || cam.id) + `
    <div class="stitch-grid">
      <div class="stitch-card">
        <div class="stitch-card-title">Daily Stitch</div>
        <div class="form-group">
          <label class="form-label">Date</label>
          <input id="stitch-daily-date" class="input" type="date" value="${today}">
        </div>
        <button id="btn-stitch-daily" class="btn btn-primary btn-full">⟳ Stitch Day</button>
      </div>
      <div class="stitch-card">
        <div class="stitch-card-title">Monthly Stitch</div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Year</label>
            <input id="stitch-monthly-year" class="input" type="number" value="${now.getFullYear()}" min="2020" max="2099">
          </div>
          <div class="form-group">
            <label class="form-label">Month</label>
            <input id="stitch-monthly-month" class="input" type="number" value="${now.getMonth() + 1}" min="1" max="12">
          </div>
        </div>
        <button id="btn-stitch-monthly" class="btn btn-primary btn-full">⟳ Stitch Month</button>
      </div>
      <div class="stitch-card">
        <div class="stitch-card-title">Yearly Stitch</div>
        <div class="form-group">
          <label class="form-label">Year</label>
          <input id="stitch-yearly-year" class="input" type="number" value="${now.getFullYear()}" min="2020" max="2099">
        </div>
        <button id="btn-stitch-yearly" class="btn btn-primary btn-full">⟳ Stitch Year</button>
      </div>
    </div>
    <div class="card-title" style="margin-top:8px">RECENT JOBS</div>
    <div id="stitch-jobs"><div class="loading"><span class="spinner"></span></div></div>`;

  $id('btn-stitch-daily').addEventListener('click', () => triggerStitch('daily', cam.id));
  $id('btn-stitch-monthly').addEventListener('click', () => triggerStitch('monthly', cam.id));
  $id('btn-stitch-yearly').addEventListener('click', () => triggerStitch('yearly', cam.id));

  await refreshStitchJobs(cam.id);
  startStitchPoll(cam.id);
}

async function triggerStitch(type, camId) {
  let body = {};
  if (type === 'daily') {
    const date = $id('stitch-daily-date').value;
    if (!date) { toast('Pick a date first.', 'error'); return; }
    body = { date };
  } else if (type === 'monthly') {
    body = { year: Number($id('stitch-monthly-year').value), month: Number($id('stitch-monthly-month').value) };
  } else {
    body = { year: Number($id('stitch-yearly-year').value) };
  }
  try {
    await api.post(`/api/cameras/${camId}/stitch/${type}`, body);
    toast(`${type} stitch started.`, 'ok');
    await refreshStitchJobs(camId);
  } catch (e) {
    toast(`Stitch failed: ${e.message}`, 'error');
  }
}

async function refreshStitchJobs(camId) {
  const el = $id('stitch-jobs');
  if (!el) return;
  try {
    const jobs = await api.get(`/api/cameras/${camId}/stitch/status`);
    if (!jobs.length) { el.innerHTML = `<div class="empty">No recent jobs.</div>`; return; }
    el.innerHTML = `<div class="job-list">${jobs.map(renderJob).join('')}</div>`;
  } catch (e) {
    el.innerHTML = `<div class="empty text-red">${esc(e.message)}</div>`;
  }
}

function renderJob(job) {
  const icons = { running: '<span class="spinner"></span>', done: '✓', error: '✗' };
  const icon  = icons[job.status] || '?';
  const tstr  = job.status === 'running'
    ? elapsed(job.startedAt)
    : fmt(job.completedAt);

  return `
    <div class="job-item ${job.status}">
      <span class="job-icon">${job.status !== 'running' ? icon : ''}</span>
      ${job.status === 'running' ? icon : ''}
      <div class="job-info">
        <div class="job-period">${esc(job.type)} — ${esc(job.period)}</div>
        ${job.error ? `<div class="job-msg text-red">${esc(job.error)}</div>` : ''}
        ${job.outputPath && job.status === 'done' ? `<div class="job-msg text-green">Completed</div>` : ''}
      </div>
      <span class="job-time">${esc(tstr)}</span>
    </div>`;
}

function startStitchPoll(camId) {
  stopStitchPoll();
  S.stitchPoll = setInterval(() => refreshStitchJobs(camId), 2000);
}

function stopStitchPoll() {
  if (S.stitchPoll) { clearInterval(S.stitchPoll); S.stitchPoll = null; }
}

/* ── Status section ──────────────────────────────────────────────────────── */
async function loadStatus() {
  const el = sectionEl('status');
  el.innerHTML = secHead('STATUS', 'System Overview') + `<div id="status-body"><div class="loading"><span class="spinner"></span></div></div>`;
  try {
    S.cameras = await api.get('/api/cameras');
    renderSelector();
    updateHeaderCam();
    $id('status-body').innerHTML = renderStatusCards(S.cameras);
  } catch (e) {
    $id('status-body').innerHTML = `<div class="empty text-red">Failed to load cameras: ${esc(e.message)}</div>`;
  }
}

function renderStatusCards(cameras) {
  if (!cameras.length) {
    return `<div class="empty">No cameras registered. Go to <strong>Cameras</strong> to add one.</div>`;
  }
  return `<div class="status-grid">${cameras.map(renderStatusCard).join('')}</div>`;
}

/* ── Settings section ────────────────────────────────────────────────────── */
async function loadSettings() {
  const cam = selectedCam();
  const el  = sectionEl('settings');
  if (!cam) { el.innerHTML = secHead('SETTINGS', 'Camera Settings') + noCam(); return; }

  el.innerHTML = secHead('SETTINGS', 'Camera Settings', cam.label || cam.id) + `
    <div class="card" style="max-width:480px">
      <form id="settings-form">
        <div class="form-group">
          <label class="form-label">Camera Label</label>
          <input class="input" name="label" value="${esc(cam.label || '')}" placeholder="e.g. Front Yard">
        </div>
        <div class="form-group">
          <label class="form-label">Capture Interval (minutes)</label>
          <input class="input" name="intervalMinutes" type="number" min="1" max="60" value="${esc(cam.intervalMinutes ?? 1)}">
        </div>
        <div class="form-group">
          <label class="form-label">Image Quality</label>
          <select class="select" name="quality">
            <option value="full" ${cam.quality === 'full' ? 'selected' : ''}>Full</option>
            <option value="high" ${cam.quality === 'high' ? 'selected' : ''}>High</option>
            <option value="medium" ${cam.quality === 'medium' ? 'selected' : ''}>Medium</option>
            <option value="low" ${cam.quality === 'low' ? 'selected' : ''}>Low</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Nightly Push Time (HH:MM)</label>
          <input class="input" name="pushTime" type="time" value="${esc(cam.pushTime || '02:00')}">
        </div>
        <div class="form-group">
          <label class="form-label">Capture Enabled</label>
          <div class="flex-center gap-1">
            <input class="toggle" type="checkbox" name="captureEnabled" id="tog-capture" ${cam.captureEnabled !== false ? 'checked' : ''}>
            <label for="tog-capture" style="font-size:12px;color:var(--dim);cursor:pointer">Enable photo capture</label>
          </div>
        </div>
        <div style="margin-top:20px">
          <button type="submit" class="btn btn-primary">Save Settings</button>
        </div>
      </form>
    </div>`;

  $id('settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd  = new FormData(e.target);
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const updated = await api.post(`/api/cameras/${cam.id}/config`, {
        label:           fd.get('label'),
        intervalMinutes: Number(fd.get('intervalMinutes')),
        quality:         fd.get('quality'),
        pushTime:        fd.get('pushTime'),
        captureEnabled:  fd.has('captureEnabled'),
      });
      const idx = S.cameras.findIndex(c => c.id === cam.id);
      if (idx !== -1) S.cameras[idx] = { ...S.cameras[idx], ...updated };
      renderSelector();
      toast('Settings saved.', 'ok');
    } catch (err) {
      toast(`Save failed: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

/* ── Cameras section ─────────────────────────────────────────────────────── */
async function loadCameraList() {
  const el = sectionEl('cameras');
  el.innerHTML = secHead('CAMERAS', 'Camera Management') + `
    <div id="cam-list-wrap"><div class="loading"><span class="spinner"></span></div></div>
    <div class="card" style="max-width:400px;margin-top:20px">
      <div class="card-title">REGISTER CAMERA</div>
      <form id="add-cam-form">
        <div class="form-group">
          <label class="form-label">Camera ID <span class="text-dim">(letters, numbers, hyphens)</span></label>
          <input class="input" name="id" placeholder="cam-01" required>
        </div>
        <div class="form-group">
          <label class="form-label">Label</label>
          <input class="input" name="label" placeholder="Front Yard">
        </div>
        <button type="submit" class="btn btn-primary">⊕ Register</button>
      </form>
    </div>`;

  await refreshCameraTable();

  $id('add-cam-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd  = new FormData(e.target);
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      await api.post('/api/cameras', { id: fd.get('id'), label: fd.get('label') });
      toast(`Camera "${fd.get('id')}" registered.`, 'ok');
      e.target.reset();
      await loadCameras();
      await refreshCameraTable();
    } catch (err) {
      toast(`Registration failed: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

async function refreshCameraTable() {
  const wrap = $id('cam-list-wrap');
  if (!wrap) return;
  try {
    const cameras = await api.get('/api/cameras');
    if (!cameras.length) {
      wrap.innerHTML = `<div class="empty">No cameras registered yet.</div>`;
      return;
    }
    wrap.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>ID</th><th>Label</th><th>Interval</th><th>Push Time</th><th>Registered</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${cameras.map(c => `
            <tr>
              <td class="text-bright">${esc(c.id)}</td>
              <td>${esc(c.label || '—')}</td>
              <td>${esc(c.intervalMinutes ?? '—')} min</td>
              <td>${esc(c.pushTime || '—')}</td>
              <td class="text-dim">${c.registeredAt ? new Date(c.registeredAt).toLocaleDateString() : '—'}</td>
              <td><button class="btn btn-danger btn-sm" data-del="${esc(c.id)}">Remove</button></td>
            </tr>`).join('')}
        </tbody>
      </table>`;

    wrap.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Remove camera "${btn.dataset.del}"? Config will be deleted (photos/videos remain).`)) return;
        try {
          await api.del(`/api/cameras/${btn.dataset.del}`);
          toast(`Camera "${btn.dataset.del}" removed.`, 'ok');
          await loadCameras();
          await refreshCameraTable();
        } catch (err) {
          toast(`Remove failed: ${err.message}`, 'error');
        }
      });
    });
  } catch (e) {
    wrap.innerHTML = `<div class="empty text-red">${esc(e.message)}</div>`;
  }
}

/* ── Storage section ─────────────────────────────────────────────────────── */
async function loadStorage() {
  const el = sectionEl('storage');
  el.innerHTML = secHead('STORAGE', 'Storage Stats') + `<div id="storage-body"><div class="loading"><span class="spinner"></span></div></div>`;
  try {
    const data = await api.get('/api/storage');
    if (!data.cameras.length) {
      $id('storage-body').innerHTML = `<div class="empty">No cameras registered.</div>`;
      return;
    }
    $id('storage-body').innerHTML = `
      <table class="table" style="max-width:700px">
        <thead>
          <tr><th>Camera</th><th>Raw Photos</th><th>Videos</th><th>Total</th></tr>
        </thead>
        <tbody>
          ${data.cameras.map(c => `
            <tr>
              <td><span class="text-bright">${esc(c.id)}</span><br><span class="text-dim" style="font-size:11px">${esc(c.label)}</span></td>
              <td>${esc(c.rawFormatted)}</td>
              <td>${esc(c.videoFormatted)}</td>
              <td class="text-bright">${esc(c.totalFormatted)}</td>
            </tr>`).join('')}
          <tr style="border-top:1px solid var(--border2)">
            <td class="text-dim" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">Total</td>
            <td></td><td></td>
            <td class="text-acc" style="font-weight:700">${esc(data.totalFormatted)}</td>
          </tr>
        </tbody>
      </table>`;
  } catch (e) {
    $id('storage-body').innerHTML = `<div class="empty text-red">${esc(e.message)}</div>`;
  }
}

function renderStatusCard(cam) {
  const st = cam.status || {};
  const isOnline = st.updatedAt && (Date.now() - st.updatedAt) < 5 * 60 * 1000;
  const sdPct = st.sdUsage ? Math.round((st.sdUsage.used / st.sdUsage.total) * 100) : null;
  const selected = cam.id === S.selectedId;

  return `
    <div class="status-card${selected ? ' selected' : ''}" data-cam-select="${esc(cam.id)}">
      <div class="status-card-head">
        <div>
          <div class="status-card-id">${esc(cam.id)}</div>
          <div class="status-card-label">${esc(cam.label || '—')}</div>
        </div>
        <span class="badge ${isOnline ? 'badge-green' : 'badge-dim'}">
          <span class="dot ${isOnline ? 'green' : ''}"></span>
          ${isOnline ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>
      <div class="status-card-body">
        <div class="status-row">
          <span class="status-key">Last photo</span>
          <span class="status-val">${ago(st.lastPhoto)}</span>
        </div>
        <div class="status-row">
          <span class="status-key">Last push</span>
          <span class="status-val">${ago(st.lastPush)}</span>
        </div>
        <div class="status-row">
          <span class="status-key">SD usage</span>
          <span class="status-val">${
            st.sdUsage
              ? `${fmtBytes(st.sdUsage.used)} / ${fmtBytes(st.sdUsage.total)} (${sdPct}%)`
              : '—'
          }</span>
        </div>
        <div class="status-row">
          <span class="status-key">Photos today</span>
          <span class="status-val">${st.photosToday ?? '—'}</span>
        </div>
        <div class="status-row">
          <span class="status-key">Capture</span>
          <span class="status-val ${cam.captureEnabled !== false ? 'text-green' : 'text-red'}">
            ${cam.captureEnabled !== false ? '● Enabled' : '● Disabled'}
          </span>
        </div>
        <div class="status-row">
          <span class="status-key">Interval</span>
          <span class="status-val">${cam.intervalMinutes ?? '—'} min</span>
        </div>
        <div class="status-row">
          <span class="status-key">Push time</span>
          <span class="status-val">${cam.pushTime ?? '—'}</span>
        </div>
      </div>
    </div>`;
}

/* ── Event wiring ────────────────────────────────────────────────────────── */
function wireEvents() {
  // Sidebar nav links
  document.addEventListener('click', e => {
    const link = e.target.closest('[data-section]');
    if (link && link.classList.contains('nav-link')) {
      e.preventDefault();
      navigate(link.dataset.section);
    }

    // Click a status card to select that camera
    const card = e.target.closest('[data-cam-select]');
    if (card) {
      const id = card.dataset.camSelect;
      $id('camera-select').value = id;
      S.selectedId = id;
      updateHeaderCam();
    }
  });

  // Camera selector dropdown
  $id('camera-select').addEventListener('change', e => {
    S.selectedId = e.target.value || null;
    updateHeaderCam();
    if (!['status', 'cameras', 'storage'].includes(S.section)) {
      loadSection();
    }
  });

  // Header refresh button
  $id('btn-refresh').addEventListener('click', () => {
    loadCameras().then(loadSection);
  });

  // Lightbox close
  $id('lb-bg').addEventListener('click', closeLightbox);
  $id('lb-close').addEventListener('click', closeLightbox);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeLightbox();
  });
}

/* ── Init ────────────────────────────────────────────────────────────────── */
async function init() {
  wireEvents();
  await loadCameras();
  navigate('status');
}

document.addEventListener('DOMContentLoaded', init);
