# ESP-AL (Lapse Backwards) — Full Project Brief

## Project Overview

A multi-camera timelapse system using ESP32-S3 modules that capture photos locally, push them nightly to a home server, and automatically stitch daily/monthly/yearly timelapse videos. Managed through a single web dashboard hosted on the server.

**Project Name:** ESP-AL (stylized as "Lapse" backwards)
**Aesthetic:** Utilitarian dark UI — functional first, but polished and enjoyable to use. Animations welcome where they add to the experience without getting in the way.

---

## Hardware

- **Camera Module:** Freenove ESP32-S3-WROOM Board (N8R8) — FNK0085
  - 8MB Flash + 8MB PSRAM
  - Built-in USB-to-serial chip — flash directly via USB-C, **no FTDI programmer needed**
  - More capable than a standard ESP32-CAM — handles buffering well
- **Local Storage:** SD card on ESP32-CAM (no size constraint, space is not an issue)
- **Server:** Unraid home server running Docker containers
- **Network:** Local IP access (HTTPS + certificates planned for future)

---

## Capture Behavior (ESP32-CAM Firmware)

- **Default interval:** 1 photo per minute (adjustable via dashboard)
- **Resolution:** Full resolution (adjustable via dashboard)
- **Storage:** Save every photo to SD card locally throughout the day
- **Sleep:** Deep sleep between shots to conserve power
- **Nightly push:** At a configurable time (default: 2:00 AM), ESP32-CAM connects to WiFi and pushes all photos from the SD card to the home server via HTTP
- **Cleanup:** After confirmed successful push, photos are deleted from SD card
- **Config sync:** On wake/push cycle, ESP32-CAM checks server for updated settings (interval, quality, push time, etc.)

---

## Server Behavior

- **Receives** photos from ESP32-CAM via HTTP POST endpoint
- **Stores** photos in organized folder structure by date
- **Stitches** daily timelapse video automatically after nightly push completes (using FFmpeg)
- **Triggers** monthly stitch on the 1st of each month (stitches all daily videos from previous month)
- **Triggers** yearly stitch on January 1st (stitches all monthly videos from previous year)
- **Deletes** raw photos after successful video stitch to save space
- **Serves** web dashboard for management and playback

---

## File Structure (Server)

Each camera gets its own namespace — photos and videos are fully separated.

```
/timelapse-data/
  /cameras/
    /cam-01/
      /raw/
        /2026-04-23/
          0001.jpg
          0002.jpg
          ...
      /videos/
        /daily/
          2026-04-23.mp4
        /monthly/
          2026-04.mp4
        /yearly/
          2026.mp4
    /cam-02/
      /raw/
        ...
      /videos/
        ...
  /config/
    settings.json       ← global defaults
    cam-01.json         ← per-camera overrides
    cam-02.json
```

---

## Web Dashboard

One unified dashboard hosted on the server. The ESP32-CAM has a minimal API to receive config and send status/photos. The server is the "brain."

**Style:** Utilitarian dark UI. Clean, dense, information-rich. Animations used purposefully (status updates, progress indicators, transitions). Think mission control, not consumer app.

### Features

- **Camera Selector** — switch between registered cameras, each with its own view
- **Live Preview** — request a live snapshot from the selected ESP32 for placement/framing
- **Settings Panel** — per-camera config pushed to each ESP32:
  - Capture interval (minutes)
  - Image quality / resolution
  - Nightly push time
  - Enable/disable capture
  - Camera name/label
- **Photo Browser** — browse raw photos by camera and date
- **Video Playback** — watch daily, monthly, yearly timelapses per camera in browser
- **Stitch Controls** — manually trigger a stitch for any camera/day/month/year
- **Status Panel** — per camera: last photo taken, last push time, SD card usage, photos pending
- **Camera Registration** — add a new camera by name/ID, generates config it will poll
- **Storage Stats** — total server storage, per-camera breakdown

---

## Tech Stack

### ESP32-CAM Firmware
- Language: C++ (Arduino framework via PlatformIO)
- Libraries: `esp_camera`, `esp_sleep`, `WiFi`, `HTTPClient`, `SD_MMC`
- Behavior: Minimal footprint — capture, sleep, push, sync config

### Server / Backend
- **Language:** Node.js / JavaScript (consistent with user's existing projects)
- **Framework:** Express.js
- **Video Processing:** FFmpeg (via `fluent-ffmpeg` npm package or shell exec)
- **Scheduling:** `node-cron` for nightly stitch triggers
- **File Management:** Native `fs` module

### Frontend Dashboard
- **Framework:** Vanilla JS or lightweight framework (TBD — keep it simple)
- **Served by:** Express static middleware or Nginx

### Infrastructure
- **Containerized:** Docker + Docker Compose
- **Reverse Proxy:** Nginx (already installed, setup TBD)
- **Future:** HTTPS via Let's Encrypt / Certbot
- **Repo:** GitHub
- **Deploy:** Custom deploy script (user's existing pattern — see Deploy section)

---

## Docker Compose Services

| Service | Purpose |
|---|---|
| `timelapse-app` | Node.js Express app — API + dashboard |
| `nginx` | Reverse proxy + static file serving |
| `ffmpeg` | Handled inside Node container via shell or fluent-ffmpeg |

---

## API Endpoints (Server)

All camera-specific routes are namespaced by `cameraId`.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/cameras/:id/upload` | Receive photo from ESP32 |
| `GET` | `/api/cameras/:id/config` | ESP32 fetches its settings |
| `POST` | `/api/cameras/:id/config` | Dashboard updates camera settings |
| `POST` | `/api/cameras/:id/status` | ESP32 reports status |
| `GET` | `/api/cameras/:id/preview` | Request live snapshot |
| `POST` | `/api/cameras/:id/stitch/daily` | Trigger daily stitch |
| `POST` | `/api/cameras/:id/stitch/monthly` | Trigger monthly stitch |
| `POST` | `/api/cameras/:id/stitch/yearly` | Trigger yearly stitch |
| `GET` | `/api/cameras/:id/videos` | List videos for this camera |
| `GET` | `/api/cameras` | List all registered cameras |
| `POST` | `/api/cameras` | Register a new camera |
| `DELETE` | `/api/cameras/:id` | Remove a camera |

---

## Settings

**Global defaults** (`settings.json`):
```json
{
  "defaultIntervalMinutes": 1,
  "defaultQuality": "full",
  "defaultPushTime": "02:00",
  "deleteAfterStitch": true
}
```

**Per-camera config** (`cam-01.json`):
```json
{
  "id": "cam-01",
  "label": "Front Yard",
  "intervalMinutes": 1,
  "quality": "full",
  "pushTime": "02:00",
  "captureEnabled": true
}
```

Each ESP32 identifies itself by a unique `cameraId` set in firmware. It polls `/api/cameras/:id/config` on each wake cycle to receive updated settings.

---

## Deploy Script Pattern

Adapted from user's existing deploy script style. This is a **standalone repo** (not a subdirectory sparse clone).

```
/mnt/user/appdata/espal/
  deploy.sh         ← save and run to deploy/redeploy
  .env              ← auto-created on first run, user fills in values
  _source/          ← temp clone, deleted after build
```

**Pattern:**
1. On first run — generate `.env` from template and exit, prompting user to fill it in
2. Stop and remove old container if running
3. Clone the full standalone repo (depth 1)
4. Build Docker image
5. Delete `_source/` clone
6. Run container with:
   - `--restart unless-stopped`
   - `--env-file .env`
   - `--volume` mapping Unraid share (`/mnt/user/timelapse-data`) → `/app/data` inside container
7. Print host IP + port in styled box

**Persistent data** lives on an Unraid share (survives redeployments):
```
/mnt/user/timelapse-data/
  /cameras/         ← per-camera raw photos and videos
  /config/          ← settings.json + per-camera config files
```

**`.env` template:**
```
PORT=3070
```

> All other settings (interval, push time, quality) are managed per-camera via the dashboard and stored in `/app/data/config/`.

---

## Timelapse Stitching Logic (FFmpeg)

**Daily stitch** — runs after nightly push completes:
```bash
ffmpeg -framerate 30 -pattern_type glob -i '/timelapse/raw/2026-04-23/*.jpg' \
  -c:v libx264 -pix_fmt yuv420p /timelapse/videos/daily/2026-04-23.mp4
```

**Monthly stitch** — concatenates daily videos:
```bash
ffmpeg -f concat -safe 0 -i filelist.txt -c copy /timelapse/videos/monthly/2026-04.mp4
```

**Yearly stitch** — concatenates monthly videos (same pattern).

---

## Future / Nice-to-Have

- HTTPS via Let's Encrypt + Certbot in Docker
- Multiple ESP32-CAM support (multiple locations)
- Motion detection mode (only capture when something changes)
- Email/notification when nightly stitch completes
- Thumbnail generation for video browser

---

## Open Questions Before Starting

All major decisions are resolved. Claude Code can begin implementation.

If any ambiguity comes up during build, default to:
- Dark utilitarian aesthetic
- Per-camera namespacing for all data and API routes
- Node.js / Express for server
- Match the field-ops deploy script style exactly for `deploy.sh`
