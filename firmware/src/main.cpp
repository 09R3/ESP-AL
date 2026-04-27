/*
 * ESP-AL Firmware — always-on mode
 *
 * Stays connected to WiFi. Captures a photo every intervalMinutes,
 * uploads it to the server immediately, and saves a copy to SD as backup.
 * No deep sleep — assumes the board is powered from mains via USB-C.
 *
 * Boot flow:
 *   setup()  — init camera, SD, WiFi, NTP, fetch config
 *   loop()   — capture on interval, upload, sync config every 30 min
 */

#include "Arduino.h"
#include "esp_camera.h"
#include "SD_MMC.h"
#include "WiFi.h"
#include "HTTPClient.h"
#include "ArduinoJson.h"
#include "time.h"
#include "config.h"

// ── Runtime state (no RTC needed — WiFi stays up) ─────────────────────────────
static int      intervalMin    = DEFAULT_INTERVAL_MIN;
static bool     captureEnabled = true;
static bool     previewPending = false;
static int      cfgFrameSize   = FRAMESIZE_UXGA;
static int      cfgJpegQuality = 10;

static char     currentDate[11] = "";
static uint32_t photoSeq        = 0;
static uint32_t lastCaptureMs   = 0;
static uint32_t lastConfigSyncMs = 0;
static uint32_t lastStatusMs    = 0;
static bool     cameraReady     = false;
static bool     sdReady         = false;

// ── Helpers ───────────────────────────────────────────────────────────────────
void getDateStr(char* buf, time_t t = 0) {
  if (t == 0) t = time(nullptr);
  struct tm tm_info;
  gmtime_r(&t, &tm_info);
  strftime(buf, 11, "%Y-%m-%d", &tm_info);
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
  cfg.pin_pwdn     = CAM_PIN_PWDN;
  cfg.pin_reset    = CAM_PIN_RESET;
  cfg.pin_xclk     = CAM_PIN_XCLK;
  cfg.pin_sccb_sda = CAM_PIN_SIOD;
  cfg.pin_sccb_scl = CAM_PIN_SIOC;
  cfg.pin_d7       = CAM_PIN_D7;
  cfg.pin_d6       = CAM_PIN_D6;
  cfg.pin_d5       = CAM_PIN_D5;
  cfg.pin_d4       = CAM_PIN_D4;
  cfg.pin_d3       = CAM_PIN_D3;
  cfg.pin_d2       = CAM_PIN_D2;
  cfg.pin_d1       = CAM_PIN_D1;
  cfg.pin_d0       = CAM_PIN_D0;
  cfg.pin_vsync    = CAM_PIN_VSYNC;
  cfg.pin_href     = CAM_PIN_HREF;
  cfg.pin_pclk     = CAM_PIN_PCLK;

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
  delay(300);

  Serial.println("[cam] ready");
  return true;
}

// ── SD card ───────────────────────────────────────────────────────────────────
bool initSD() {
  SD_MMC.setPins(SD_PIN_CLK, SD_PIN_CMD, SD_PIN_D0);
  if (!SD_MMC.begin("/sdcard", true)) {
    Serial.println("[sd] mount failed");
    return false;
  }
  Serial.printf("[sd] mounted — %.0f MB free\n",
    (float)(SD_MMC.totalBytes() - SD_MMC.usedBytes()) / 1048576.0f);
  return true;
}

bool ensureDateDir(const char* date) {
  char path[16];
  snprintf(path, sizeof(path), "/%s", date);
  if (!SD_MMC.exists(path)) return SD_MMC.mkdir(path);
  return true;
}

void saveToSD(const char* date, uint32_t seq, const uint8_t* buf, size_t len) {
  if (!sdReady) return;
  ensureDateDir(date);
  char path[32];
  snprintf(path, sizeof(path), "/%s/%04lu.jpg", date, (unsigned long)seq);
  File f = SD_MMC.open(path, FILE_WRITE);
  if (!f) { Serial.printf("[sd] open failed: %s\n", path); return; }
  f.write(buf, len);
  f.close();
  Serial.printf("[sd] saved %s (%u bytes)\n", path, (unsigned)len);
}

// ── Network ───────────────────────────────────────────────────────────────────
bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;
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

void syncNTP() {
  setenv("TZ", "UTC0", 1);
  tzset();
  configTime(0, 0, NTP_SERVER);
  time_t now = 0;
  int attempts = 0;
  while (now < 1000000000UL && attempts++ < 20) { delay(500); now = time(nullptr); }
  if (now > 1000000000UL) {
    struct tm t; gmtime_r(&now, &t);
    char buf[32]; strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S UTC", &t);
    Serial.printf("[ntp] %s\n", buf);
  } else {
    Serial.println("[ntp] sync failed");
  }
}

bool fetchConfig() {
  char url[192];
  snprintf(url, sizeof(url), "%s/api/cameras/%s/config", SERVER_URL, CAMERA_ID);
  HTTPClient http;
  http.begin(url);
  http.setTimeout(10000);
  int code = http.GET();
  if (code != 200) { Serial.printf("[config] GET failed: %d\n", code); http.end(); return false; }

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, http.getString());
  http.end();
  if (err) { Serial.printf("[config] parse error: %s\n", err.c_str()); return false; }

  intervalMin    = doc["intervalMinutes"] | DEFAULT_INTERVAL_MIN;
  captureEnabled = doc["captureEnabled"]  | true;
  previewPending = doc["previewRequested"] | false;
  qualityFromString(doc["quality"] | DEFAULT_QUALITY);

  Serial.printf("[config] interval=%dmin capture=%s preview=%s\n",
    intervalMin, captureEnabled ? "on" : "off", previewPending ? "YES" : "no");
  return true;
}

// Upload raw JPEG bytes directly to server. Returns true on success.
bool uploadPhoto(const char* date, uint32_t seq, const uint8_t* buf, size_t len) {
  char url[256];
  snprintf(url, sizeof(url), "%s/api/cameras/%s/upload?date=%s&seq=%04lu",
           SERVER_URL, CAMERA_ID, date, (unsigned long)seq);
  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "image/jpeg");
  http.setTimeout(20000);
  int code = http.POST((uint8_t*)buf, len);
  http.end();
  Serial.printf("[upload] %s/%04lu → HTTP %d (%u bytes)\n",
    date, (unsigned long)seq, code, (unsigned)len);
  return code == 200 || code == 201;
}

void uploadPreview() {
  Serial.println("[preview] capturing snapshot");
  camera_fb_t* fb = esp_camera_fb_get();
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
  Serial.printf("[preview] → HTTP %d\n", code);
}

void reportStatus() {
  char url[192];
  snprintf(url, sizeof(url), "%s/api/cameras/%s/status", SERVER_URL, CAMERA_ID);

  char ts[24];
  time_t now = time(nullptr);
  struct tm t; gmtime_r(&now, &t);
  strftime(ts, sizeof(ts), "%Y-%m-%dT%H:%M:%SZ", &t);

  JsonDocument doc;
  doc["lastPhoto"]    = ts;
  doc["photosToday"]  = (int)photoSeq;

  String body; serializeJson(doc, body);
  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);
  http.POST(body);
  http.end();
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[boot] ESP-AL starting (always-on mode)");

  sdReady     = initSD();
  cameraReady = initCamera();

  if (connectWiFi()) {
    syncNTP();
    fetchConfig();
  }

  getDateStr(currentDate);

  // Capture immediately on first boot rather than waiting a full interval
  lastCaptureMs    = millis() - (uint32_t)intervalMin * 60000UL;
  lastConfigSyncMs = millis();
  lastStatusMs     = millis();

  Serial.printf("[boot] ready — capturing every %d min\n", intervalMin);
}

// ── Loop ──────────────────────────────────────────────────────────────────────
void loop() {
  uint32_t now = millis();

  // ── WiFi watchdog ─────────────────────────────────────────────────────────
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[wifi] lost connection — reconnecting");
    connectWiFi();
  }

  // ── Config sync every CONFIG_SYNC_EVERY_N minutes ─────────────────────────
  uint32_t syncIntervalMs = (uint32_t)intervalMin * CONFIG_SYNC_EVERY_N * 60000UL;
  if (now - lastConfigSyncMs >= syncIntervalMs) {
    lastConfigSyncMs = now;
    if (WiFi.status() == WL_CONNECTED) {
      fetchConfig();
      if (previewPending) {
        uploadPreview();
        previewPending = false;
      }
    }
  }

  // ── Capture on interval ───────────────────────────────────────────────────
  uint32_t captureIntervalMs = (uint32_t)intervalMin * 60000UL;
  if (captureEnabled && (now - lastCaptureMs >= captureIntervalMs)) {
    lastCaptureMs = now;

    // Reset sequence counter if date has rolled over
    char today[11];
    getDateStr(today);
    if (strcmp(today, currentDate) != 0) {
      strncpy(currentDate, today, sizeof(currentDate));
      photoSeq = 0;
    }
    photoSeq++;

    if (!cameraReady) {
      cameraReady = initCamera();
      if (!cameraReady) { Serial.println("[cam] still not ready"); return; }
    }

    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("[cam] capture failed");
      return;
    }

    // Save to SD and upload using the same frame buffer
    saveToSD(currentDate, photoSeq, fb->buf, fb->len);

    if (WiFi.status() == WL_CONNECTED) {
      uploadPhoto(currentDate, photoSeq, fb->buf, fb->len);
    } else {
      Serial.println("[upload] skipped — no WiFi (saved to SD)");
    }

    esp_camera_fb_return(fb);
  }

  // ── Status report every 60 captures ──────────────────────────────────────
  if (photoSeq > 0 && photoSeq % 60 == 0 && now - lastStatusMs > 60000UL) {
    lastStatusMs = now;
    if (WiFi.status() == WL_CONNECTED) reportStatus();
  }

  delay(200);
}
