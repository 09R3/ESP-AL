# ESP-AL

Multi-camera timelapse system — ESP32-S3 modules capture photos locally, push
nightly to a home server, and auto-stitch daily/monthly/yearly videos.

See [`timelapse-project-brief.md`](./timelapse-project-brief.md) for the full spec.

---

## Current state

| Component | Status |
|---|---|
| Server (Node.js / Express) | ✓ Complete |
| Web dashboard (Vanilla JS SPA) | ✓ Complete |
| Deploy script (Unraid) | ✓ Complete |
| ESP32-S3 firmware (PlatformIO) | ✓ Written — not yet tested on hardware |

---

## Stack

- **Server:** Node.js, Express, ffmpeg (Alpine Docker), node-cron
- **Dashboard:** Vanilla JS SPA, dark monospace UI (JetBrains Mono)
- **Firmware:** C++ / Arduino framework / PlatformIO — Freenove ESP32-S3-WROOM FNK0085 (N8R8)

---

## Key file locations

```
server/
  src/
    index.js                 — Express app entry, mounts all routes
    cron.js                  — Scheduled stitch jobs (daily/monthly/yearly)
    routes/
      cameras.js             — Camera CRUD, config sync, status, preview
      upload.js              — Photo upload (multipart + raw JPEG from ESP32)
      stitch.js              — Manual stitch triggers
      media.js               — Photo/video browsing and serving
      stats.js               — Storage stats
    services/
      config.js              — Read/write settings.json + per-camera JSON
      storage.js             — File path helpers, SD-style directory structure
      ffmpeg.js              — Daily/monthly/yearly stitch via ffmpeg shell exec
      stitchState.js         — In-memory stitch job tracker
      cameraState.js         — In-memory ESP32 runtime status
  public/                    — Dashboard SPA (index.html, css/main.css, js/app.js)
  Dockerfile                 — Node 20 Alpine + ffmpeg
  package.json

firmware/
  platformio.ini             — Board config (esp32s3dev, QIO flash, OPI PSRAM)
  src/
    config.h                 — WiFi credentials, server URL, camera ID, pin defs
    main.cpp                 — Full firmware (capture, sleep, push, config sync)

deploy.sh                    — Unraid deploy script
docker-compose.yml           — Local dev compose
nginx/nginx.conf             — Optional reverse proxy config
```

---

## Running locally

```bash
cd server
npm install
npm run dev        # nodemon, restarts on change
```

Server starts on `http://localhost:3070`. Data is written to `/app/data` inside
Docker, or wherever `DATA_DIR` env var points locally.

---

## Flashing firmware

1. Edit `firmware/src/config.h` — WiFi SSID/password, server LAN IP, camera ID
2. Register the camera in the dashboard first (it needs a config entry on the server)
3. Connect the Freenove board via USB-C and run:

```bash
cd firmware
pio run --target upload
pio device monitor
```

---

## Deploy (Unraid)

```bash
# Download and run — first run creates .env and exits
curl -fsSL "https://raw.githubusercontent.com/09r3/esp-al/main/deploy.sh" \
  -o /mnt/user/appdata/espal/deploy.sh && chmod +x /mnt/user/appdata/espal/deploy.sh
bash /mnt/user/appdata/espal/deploy.sh
```

Persistent data lives at `/mnt/user/timelapse-data` (survives redeploys).

---

## API — what the ESP32 calls

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/cameras/:id/config` | Fetch settings on each wake |
| `POST` | `/api/cameras/:id/upload?date=YYYY-MM-DD&seq=NNNN` | Upload photo (raw JPEG) |
| `POST` | `/api/cameras/:id/upload?preview=true` | Upload preview snapshot |
| `POST` | `/api/cameras/:id/status` | Report status + trigger auto-stitch |

Status body that triggers auto-stitch:
```json
{ "pushComplete": { "date": "2026-04-23", "photoCount": 1440 } }
```
