/*
 * ESP-AL Firmware — Freenove ESP32-S3-WROOM (FNK0085)
 *
 * Boot flow:
 *   Every wake:  check time → capture or push → deep sleep
 *   First boot:  WiFi → NTP → config sync → capture → sleep
 *   Push boot:   WiFi → upload all SD photos → report → re-sync config → sleep
 *   Every 30th:  mid-cycle WiFi check for config updates / preview requests
 */

#include "Arduino.h"
#include "esp_camera.h"
#include "SD_MMC.h"
#include "WiFi.h"
#include "HTTPClient.h"
#include "ArduinoJson.h"
#include "time.h"
#include "esp_sleep.h"
#include "config.h"

// ── RTC-backed state (survives deep sleep) ────────────────────────────────────
RTC_DATA_ATTR static uint32_t bootCount       = 0;
RTC_DATA_ATTR static bool     timeReady       = false;
RTC_DATA_ATTR static time_t   nextPushTime    = 0;
RTC_DATA_ATTR static uint32_t photoCounter    = 0;   // sequence within current date
RTC_DATA_ATTR static char     photoDate[11]   = "";  // "YYYY-MM-DD" of current counter
RTC_DATA_ATTR static uint32_t syncCounter     = 0;   // cycles since last config poll
RTC_DATA_ATTR static int      intervalMin     = DEFAULT_INTERVAL_MIN;
RTC_DATA_ATTR static int      pushHour        = DEFAULT_PUSH_HOUR;
RTC_DATA_ATTR static int      pushMin         = DEFAULT_PUSH_MIN;
RTC_DATA_ATTR static bool     captureEnabled  = true;
RTC_DATA_ATTR static bool     previewPending  = false;
// framesize and quality stored as ints (enums aren't safe in RTC structs)
RTC_DATA_ATTR static int      cfgFrameSize    = FRAMESIZE_UXGA;
RTC_DATA_ATTR static int      cfgJpegQuality  = 10;  // 0-63, lower = better

// ── Helpers ───────────────────────────────────────────────────────────────────
void getDateStr(char* buf, time_t t = 0) {
  if (t == 0) t = time(nullptr);
  struct tm tm_info;
  localtime_r(&t, &tm_info);
  strftime(buf, 11, "%Y-%m-%d", &tm_info);
}

time_t calcNextPushTime(int hour, int minute) {
  time_t now = time(nullptr);
  struct tm tm_info;
  localtime_r(&now, &tm_info);
  tm_info.tm_hour = hour;
  tm_info.tm_min  = minute;
  tm_info.tm_sec  = 0;
  time_t candidate = mktime(&tm_info);
  if (candidate <= now + 60) candidate += 86400; // already past → tomorrow
  return candidate;
}

bool isToday(const char* dateStr) {
  char today[11];
  getDateStr(today);
  return strcmp(dateStr, today) == 0;
}

void qualityFromString(const char* q) {
  if (strcmp(q, "full") == 0)        { cfgFrameSize = FRAMESIZE_UXGA; cfgJpegQuality = 10; }
  else if (strcmp(q, "high") == 0)   { cfgFrameSize = FRAMESIZE_SXGA; cfgJpegQuality = 12; }
  else if (strcmp(q, "medium") == 0) { cfgFrameSize = FRAMESIZE_XGA;  cfgJpegQuality = 15; }
  else                               { cfgFrameSize = FRAMESIZE_SVGA; cfgJpegQuality = 20; }
}

// ── Camera ────────────────────────────────────────────────────────────────────
bool initCamera() {
  camera_config_t cfg = {};
  cfg.pin_pwdn    = CAM_PIN_PWDN;
  cfg.pin_reset   = CAM_PIN_RESET;
  cfg.pin_xclk    = CAM_PIN_XCLK;
  cfg.pin_sccb_sda = CAM_PIN_SIOD;
  cfg.pin_sccb_scl = CAM_PIN_SIOC;
  cfg.pin_d7      = CAM_PIN_D7;
  cfg.pin_d6      = CAM_PIN_D6;
  cfg.pin_d5      = CAM_PIN_D5;
  cfg.pin_d4      = CAM_PIN_D4;
  cfg.pin_d3      = CAM_PIN_D3;
  cfg.pin_d2      = CAM_PIN_D2;
  cfg.pin_d1      = CAM_PIN_D1;
  cfg.pin_d0      = CAM_PIN_D0;
  cfg.pin_vsync   = CAM_PIN_VSYNC;
  cfg.pin_href    = CAM_PIN_HREF;
  cfg.pin_pclk    = CAM_PIN_PCLK;

  cfg.xclk_freq_hz = 20000000;
  cfg.ledc_channel = LEDC_CHANNEL_0;
  cfg.ledc_timer   = LEDC_TIMER_0;
  cfg.pixel_format = PIXFORMAT_JPEG;

  if (psramFound()) {
    cfg.frame_size   = (framesize_t)cfgFrameSize;
    cfg.jpeg_quality = cfgJpegQuality;
    cfg.fb_count     = 2;
    cfg.fb_location  = CAMERA_FB_IN_PSRAM;
    cfg.grab_mode    = CAMERA_GRAB_LATEST;
  } else {
    cfg.frame_size   = FRAMESIZE_SVGA;
    cfg.jpeg_quality = 20;
    cfg.fb_count     = 1;
    cfg.fb_location  = CAMERA_FB_IN_DRAM;
    cfg.grab_mode    = CAMERA_GRAB_WHEN_EMPTY;
  }

  esp_err_t err = esp_camera_init(&cfg);
  if (err != ESP_OK) {
    Serial.printf("[cam] init failed: 0x%x\n", err);
    return false;
  }

  // Discard first frame — sensor needs a moment to settle
  camera_fb_t* warmup = esp_camera_fb_get();
  if (warmup) esp_camera_fb_return(warmup);
  delay(100);

  return true;
}

void deinitCamera() {
  esp_camera_deinit();
}

// ── SD card ───────────────────────────────────────────────────────────────────
bool initSD() {
  SD_MMC.setPins(SD_PIN_CLK, SD_PIN_CMD, SD_PIN_D0);
  // 1-bit mode (true) avoids pin conflicts with the camera
  if (!SD_MMC.begin("/sdcard", true)) {
    Serial.println("[sd] mount failed");
    return false;
  }
  Serial.printf("[sd] mounted — %.0f MB free\n",
    (float)(SD_MMC.totalBytes() - SD_MMC.usedBytes()) / 1048576.0f);
  return true;
}

// Returns true and writes path into `out` (must be ≥ 32 bytes)
bool buildPhotoPath(char* out, size_t outLen, const char* date, uint32_t seq) {
  snprintf(out, outLen, "/%s/%04lu.jpg", date, (unsigned long)seq);
  return true;
}

bool ensureDateDir(const char* date) {
  char path[16];
  snprintf(path, sizeof(path), "/%s", date);
  if (!SD_MMC.exists(path)) {
    return SD_MMC.mkdir(path);
  }
  return true;
}

// Capture one frame and write it to SD. Returns true on success.
bool captureToSD(const char* date, uint32_t seq) {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[cam] capture failed");
    return false;
  }

  char path[32];
  buildPhotoPath(path, sizeof(path), date, seq);

  File file = SD_MMC.open(path, FILE_WRITE);
  if (!file) {
    Serial.printf("[sd] open failed: %s\n", path);
    esp_camera_fb_return(fb);
    return false;
  }

  size_t written = file.write(fb->buf, fb->len);
  file.close();
  esp_camera_fb_return(fb);

  if (written != fb->len) {
    Serial.printf("[sd] write incomplete: %s (%u/%u)\n", path, written, fb->len);
    return false;
  }

  Serial.printf("[sd] saved %s (%u bytes)\n", path, (unsigned)written);
  return true;
}

void deletePhotosForDate(const char* date) {
  char dirPath[16];
  snprintf(dirPath, sizeof(dirPath), "/%s", date);

  File dir = SD_MMC.open(dirPath);
  if (!dir || !dir.isDirectory()) return;

  File f = dir.openNextFile();
  while (f) {
    if (!f.isDirectory()) {
      char fpath[48];
      snprintf(fpath, sizeof(fpath), "/%s/%s", date, f.name());
      f.close();
      SD_MMC.remove(fpath);
    } else {
      f.close();
    }
    f = dir.openNextFile();
  }
  dir.close();
  SD_MMC.rmdir(dirPath);
  Serial.printf("[sd] deleted /%s\n", date);
}

// ── Network ───────────────────────────────────────────────────────────────────
bool connectWiFi() {
  Serial.printf("[wifi] connecting to %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  for (int i = 0; i < WIFI_TIMEOUT_S * 2; i++) {
    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("[wifi] connected — IP %s\n", WiFi.localIP().toString().c_str());
      return true;
    }
    delay(500);
  }
  Serial.println("[wifi] connection failed");
  return false;
}

void disconnectWiFi() {
  WiFi.disconnect(true, true);
  WiFi.mode(WIFI_OFF);
}

void syncNTP() {
  configTime(TZ_OFFSET_S, DST_OFFSET_S, NTP_SERVER);
  struct tm tm_info;
  int attempts = 0;
  while (!getLocalTime(&tm_info) && attempts++ < 20) delay(500);
  if (attempts < 20) {
    timeReady = true;
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &tm_info);
    Serial.printf("[ntp] time synced: %s\n", buf);
  } else {
    Serial.println("[ntp] sync failed");
  }
}

// Parse and store config from server JSON. Returns true on success.
bool fetchConfig() {
  char url[192];
  snprintf(url, sizeof(url), "%s/api/cameras/%s/config", SERVER_URL, CAMERA_ID);

  HTTPClient http;
  http.begin(url);
  http.setTimeout(10000);
  int code = http.GET();

  if (code != 200) {
    Serial.printf("[config] GET failed: %d\n", code);
    http.end();
    return false;
  }

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, http.getString());
  http.end();

  if (err) {
    Serial.printf("[config] parse error: %s\n", err.c_str());
    return false;
  }

  intervalMin    = doc["intervalMinutes"] | DEFAULT_INTERVAL_MIN;
  captureEnabled = doc["captureEnabled"]  | true;
  previewPending = doc["previewRequested"] | false;

  const char* pt = doc["pushTime"] | "02:00";
  sscanf(pt, "%d:%d", &pushHour, &pushMin);

  const char* q  = doc["quality"] | DEFAULT_QUALITY;
  qualityFromString(q);

  Serial.printf("[config] interval=%dmin push=%02d:%02d capture=%s preview=%s\n",
    intervalMin, pushHour, pushMin,
    captureEnabled ? "on" : "off",
    previewPending ? "YES" : "no");

  return true;
}

// POST raw JPEG bytes to server. Returns true on HTTP 200/201.
bool uploadPhoto(const char* date, uint32_t seq, const char* filepath) {
  File file = SD_MMC.open(filepath);
  if (!file) {
    Serial.printf("[upload] open failed: %s\n", filepath);
    return false;
  }

  size_t len = file.size();
  uint8_t* buf = psramFound()
    ? (uint8_t*)ps_malloc(len)
    : (uint8_t*)malloc(len);

  if (!buf) {
    Serial.println("[upload] malloc failed");
    file.close();
    return false;
  }

  file.read(buf, len);
  file.close();

  char url[256];
  snprintf(url, sizeof(url), "%s/api/cameras/%s/upload?date=%s&seq=%04lu",
           SERVER_URL, CAMERA_ID, date, (unsigned long)seq);

  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "image/jpeg");
  http.setTimeout(30000);
  int code = http.POST(buf, len);
  http.end();

  psramFound() ? ps_free(buf) : free(buf);

  if (code != 200 && code != 201) {
    Serial.printf("[upload] %s → HTTP %d\n", filepath, code);
    return false;
  }
  return true;
}

// Upload a live preview shot (ESP32 was asked via previewRequested flag).
void uploadPreview() {
  Serial.println("[preview] capturing snapshot for dashboard");
  if (!initCamera()) return;
  delay(200); // let sensor settle

  camera_fb_t* fb = esp_camera_fb_get();
  deinitCamera();
  if (!fb) { Serial.println("[preview] capture failed"); return; }

  char url[192];
  snprintf(url, sizeof(url), "%s/api/cameras/%s/upload?preview=true", SERVER_URL, CAMERA_ID);

  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "image/jpeg");
  http.setTimeout(20000);
  int code = http.POST(fb->buf, fb->len);
  http.end();
  esp_camera_fb_return(fb);

  Serial.printf("[preview] upload → HTTP %d\n", code);
}

// Report status + push-complete to server so it can trigger auto-stitch.
void reportStatus(const char* date, int photoCount, bool pushComplete) {
  char url[192];
  snprintf(url, sizeof(url), "%s/api/cameras/%s/status", SERVER_URL, CAMERA_ID);

  JsonDocument doc;
  doc["lastPush"] = pushComplete ? (JsonVariant)true : JsonVariant(); // simplified

  if (pushComplete) {
    doc["pushComplete"]["date"]       = date;
    doc["pushComplete"]["photoCount"] = photoCount;
  }

  uint64_t chipId = ESP.getEfuseMac();
  doc["chipId"] = chipId;

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);
  http.POST(body);
  http.end();
}

// ── Push all photos from SD to server ─────────────────────────────────────────
// Walks every date directory, uploads photos, reports push-complete per day,
// then deletes the local copies. Skips today (still capturing).
void pushAllPhotos() {
  File root = SD_MMC.open("/");
  if (!root) { Serial.println("[push] SD root open failed"); return; }

  File entry = root.openNextFile();
  while (entry) {
    if (entry.isDirectory()) {
      const char* name = entry.name(); // just the dir name, e.g. "2026-04-23"

      // Validate it looks like a date directory
      bool looksLikeDate = (strlen(name) == 10)
        && name[4] == '-' && name[7] == '-';

      if (looksLikeDate && !isToday(name)) {
        Serial.printf("[push] processing %s\n", name);

        int uploaded = 0;
        int failed   = 0;
        uint32_t seq = 0;

        // Re-open the directory for file iteration
        char dirPath[16];
        snprintf(dirPath, sizeof(dirPath), "/%s", name);
        File dir = SD_MMC.open(dirPath);
        File photo = dir.openNextFile();

        while (photo) {
          if (!photo.isDirectory()) {
            seq++;
            char fpath[48];
            snprintf(fpath, sizeof(fpath), "/%s/%s", name, photo.name());
            photo.close();

            if (uploadPhoto(name, seq, fpath)) {
              uploaded++;
            } else {
              failed++;
              // Leave file on SD if upload failed; retry next night
            }
          } else {
            photo.close();
          }
          photo = dir.openNextFile();
        }
        dir.close();

        Serial.printf("[push] %s — %d uploaded, %d failed\n", name, uploaded, failed);

        if (uploaded > 0) {
          reportStatus(name, uploaded, true);
          // Only delete if everything uploaded successfully
          if (failed == 0) {
            deletePhotosForDate(name);
          }
        }
      }
    }
    entry.close();
    entry = root.openNextFile();
  }
  root.close();
}

// ── Deep sleep ────────────────────────────────────────────────────────────────
void goToSleep(uint32_t seconds) {
  Serial.printf("[sleep] sleeping %lu s\n", (unsigned long)seconds);
  Serial.flush();
  deinitCamera();
  SD_MMC.end();
  esp_sleep_enable_timer_wakeup((uint64_t)seconds * 1000000ULL);
  esp_deep_sleep_start();
}

// ── Main ──────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(100);
  bootCount++;
  Serial.printf("\n[boot] #%lu\n", (unsigned long)bootCount);

  bool needWiFi = false;

  // ── First boot: must sync time and fetch initial config ──────────────────
  if (!timeReady) {
    Serial.println("[boot] first run — WiFi init");
    needWiFi = true;
  }

  // ── Periodic mid-cycle config sync ──────────────────────────────────────
  syncCounter++;
  if (syncCounter >= CONFIG_SYNC_EVERY_N) {
    syncCounter = 0;
    needWiFi = true;
    Serial.println("[boot] periodic config sync");
  }

  // ── Check if it's push time ──────────────────────────────────────────────
  time_t now = timeReady ? time(nullptr) : 0;
  bool   isPushTime = timeReady && (now >= nextPushTime);

  if (isPushTime) {
    Serial.println("[boot] push cycle");
    needWiFi = true;
  }

  // ── Connect WiFi if needed ───────────────────────────────────────────────
  if (needWiFi) {
    if (!initSD()) {
      // Can't do much without SD; sleep and retry
      goToSleep(60);
    }

    if (!connectWiFi()) {
      // WiFi failed: capture anyway if possible, retry WiFi next cycle
      disconnectWiFi();
      needWiFi = false;
    } else {
      if (!timeReady || isPushTime) syncNTP();
      fetchConfig(); // updates RTC config vars
      now = time(nullptr);

      if (!timeReady) {
        // Still couldn't get time — shouldn't happen after NTP
        nextPushTime = now + 86400;
      }
    }
  }

  // ── Recalculate push time if needed ─────────────────────────────────────
  if (timeReady && (nextPushTime == 0 || isPushTime)) {
    nextPushTime = calcNextPushTime(pushHour, pushMin);
    Serial.printf("[boot] next push at %s\n",
      []() {
        static char buf[20];
        struct tm t; localtime_r(&nextPushTime, &t);
        strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M", &t);
        return buf;
      }());
  }

  // ── Push cycle ───────────────────────────────────────────────────────────
  if (isPushTime && WiFi.status() == WL_CONNECTED) {
    pushAllPhotos();
    disconnectWiFi();

    // After push just sleep until next capture interval — no photo to take
    uint32_t sleepSec = (uint32_t)(intervalMin * 60);
    goToSleep(sleepSec);
  }

  // ── Handle preview request ───────────────────────────────────────────────
  if (previewPending && WiFi.status() == WL_CONNECTED) {
    uploadPreview();
    previewPending = false;
  }

  if (WiFi.status() == WL_CONNECTED) {
    disconnectWiFi();
  }

  // ── Normal capture ───────────────────────────────────────────────────────
  if (captureEnabled) {
    if (!initSD()) { goToSleep(60); }

    now = timeReady ? time(nullptr) : 0;

    // Update date tracking; reset counter if the date rolled over
    char today[11];
    getDateStr(today, now);
    if (strcmp(today, photoDate) != 0) {
      strncpy(photoDate, today, sizeof(photoDate));
      photoCounter = 0;
    }

    photoCounter++;
    ensureDateDir(photoDate);

    if (!initCamera()) {
      goToSleep((uint32_t)(intervalMin * 60));
    }

    captureToSD(photoDate, photoCounter);
    deinitCamera();
  }

  // ── Sleep until next capture (or push time, whichever comes first) ───────
  uint32_t sleepSec = (uint32_t)(intervalMin * 60);
  if (timeReady) {
    now = time(nullptr);
    time_t timeUntilPush = nextPushTime - now;
    if (timeUntilPush > 0 && (uint32_t)timeUntilPush < sleepSec) {
      sleepSec = (uint32_t)timeUntilPush;
    }
  }

  goToSleep(sleepSec);
}

void loop() {
  // Never reached — deep sleep restarts from setup()
}
