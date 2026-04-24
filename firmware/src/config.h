#pragma once

// ── WiFi ──────────────────────────────────────────────────────────────────────
#define WIFI_SSID     "your-wifi-ssid"
#define WIFI_PASS     "your-wifi-password"
#define WIFI_TIMEOUT_S  20        // seconds before giving up on connect

// ── Server ────────────────────────────────────────────────────────────────────
// Use your Unraid LAN IP — do NOT use localhost or 127.0.0.1
#define SERVER_URL    "http://192.168.1.100:3070"
#define CAMERA_ID     "cam-01"    // must match what you registered in the dashboard

// ── Time ──────────────────────────────────────────────────────────────────────
#define NTP_SERVER    "pool.ntp.org"
#define TZ_OFFSET_S   0           // UTC offset in seconds (e.g. -18000 for EST)
#define DST_OFFSET_S  0           // daylight saving offset in seconds

// ── Capture defaults (overridden by server config after first sync) ───────────
#define DEFAULT_INTERVAL_MIN  1   // photo every N minutes
#define DEFAULT_PUSH_HOUR     2   // nightly push at HH:MM
#define DEFAULT_PUSH_MIN      0
#define DEFAULT_QUALITY       "full"

// ── Behaviour ─────────────────────────────────────────────────────────────────
// How many photo cycles between config polls (preview check, settings update).
// At 1 min interval: 30 = check every 30 min.
#define CONFIG_SYNC_EVERY_N   30

// ── Camera pins — Freenove ESP32-S3-WROOM (FNK0085) ──────────────────────────
// Verify against your board's schematic if behaviour is unexpected.
#define CAM_PIN_PWDN    -1
#define CAM_PIN_RESET   -1
#define CAM_PIN_XCLK    15
#define CAM_PIN_SIOD     4
#define CAM_PIN_SIOC     5
#define CAM_PIN_D7      16
#define CAM_PIN_D6      17
#define CAM_PIN_D5      18
#define CAM_PIN_D4      12
#define CAM_PIN_D3      10
#define CAM_PIN_D2       8
#define CAM_PIN_D1       9
#define CAM_PIN_D0      11
#define CAM_PIN_VSYNC    6
#define CAM_PIN_HREF     7
#define CAM_PIN_PCLK    13

// ── SD card pins (SDMMC 1-bit mode) ──────────────────────────────────────────
// Adjust to match your SD breakout wiring.
#define SD_PIN_CLK      39
#define SD_PIN_CMD      38
#define SD_PIN_D0       40
