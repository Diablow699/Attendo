/*
  Attendo -- ESP32 + AS608 + DS3231 RTC + ILI9341 TFT
  Attendance & Enrollment Firmware  (offline-first, neon cyberpunk theme, PORTRAIT 240x320)

  Behaviour:
   1. Schedule is cached to LittleFS (/schedule.json) and loaded at boot,
      so a class in session is recognised even when the device boots offline.
   2. WiFi portal has a timeout. If nobody configures WiFi, the device
      continues in offline mode (scans are queued) instead of blocking/restarting.
   3. The DS3231 is synced from NTP when online (boot, then every 24h) and the
      firmware tracks whether the clock can be trusted (rtcTrusted). Scans are
      refused while the clock is untrusted.
   4. Queue flush is power-safe (write /queue.tmp, then rename over /queue.jsonl).
   5. HTTP 5xx responses are treated as "not delivered" so those scans stay queued.
   6. Backend can send {"action":"refresh_schedule"} on /device/command.
   7. Neon green cyberpunk TFT theme (palette, scanlines, corner brackets, glow text).
   8. The status screen is redrawn fully only when something changes; the clock
      and the blinking session cursor are redrawn in place (no flicker).
   9. PORTRAIT layout (240 wide x 320 tall): rotation 0, width-aware text sizing,
      long subject names are truncated, long messages shortened/split.

  The device only reports fingerprintId + scannedAt (RTC time). The backend decides
  present/late by comparing scannedAt to the class start + grace period.
*/

/*#define FP_RX_PIN    16   // ESP32 RX  <- AS608 TX
#define FP_TX_PIN    17   // ESP32 TX  -> AS608 RX
#define I2C_SDA_PIN  21
#define I2C_SCL_PIN  22
#define SPI_SCK_PIN  18
#define SPI_MISO_PIN 19
#define SPI_MOSI_PIN 23*/

#include <WiFiManager.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Adafruit_Fingerprint.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <Wire.h>
#include <RTClib.h>
#include <LittleFS.h>
#include <time.h>

const char* SETUP_AP_NAME = "Attendo-Setup";
const char* SETUP_AP_PASSWORD = "attendo123"; // must be 8+ characters (WiFiManager's requirement)

WiFiManager wifiManager;
const char* BACKEND_BASE_URL = "http://192.168.1.50:4000/api";
const char* DEVICE_KEY = "ESP32-MAIN-01";

// Keep these two in sync: the RTC always stores LOCAL time.
const char* TIMEZONE_OFFSET = "+08:00";
const long  NTP_GMT_OFFSET_SEC = 8L * 3600L;

#define TFT_CS   15
#define TFT_DC    2
#define TFT_RST   4

// ---- Neon cyberpunk palette (RGB565) ----
#define COLOR_BG       0x0040   // near-black green
#define COLOR_GRID     0x0942   // faint scanlines
#define COLOR_NEON     0x3FE2   // #39ff14 main neon green
#define COLOR_NEON_DIM 0x1C67   // #1a8f3c secondary text
#define COLOR_CYAN     0x073F   // #00e5ff clock, subject on results
#define COLOR_MAGENTA  0xF95A   // #ff2bd6 offline
#define COLOR_AMBER    0xFD80   // #ffb000 late / recorded / queue
#define COLOR_RED      0xF98A   // #ff3355 errors / rejected
#define COLOR_DOTOFF   0x09E3   // inactive enroll dot

const unsigned long SCHEDULE_REFRESH_MS       = 15UL * 60UL * 1000UL;
const unsigned long SCHEDULE_RETRY_MS         = 30UL * 1000UL;   // until first successful fetch this boot
const unsigned long COMMAND_POLL_MS           = 3000;
const unsigned long QUEUE_FLUSH_MS            = 20000;
const unsigned long SCAN_COOLDOWN_MS          = 1500;
const unsigned long DISPLAY_REFRESH_MS        = 1000;
const unsigned long NTP_RESYNC_MS             = 24UL * 60UL * 60UL * 1000UL;
const unsigned long NTP_RETRY_MS              = 60UL * 1000UL;
const unsigned long WIFI_RECONNECT_MS         = 30UL * 1000UL;
const uint16_t      PORTAL_TIMEOUT_SEC        = 120;
const uint16_t      WIFI_CONNECT_TIMEOUT_SEC  = 15;

#define QUEUE_FILE    "/queue.jsonl"
#define QUEUE_TMP     "/queue.tmp"
#define SCHEDULE_FILE "/schedule.json"
#define MAX_SCHEDULES 60

struct ScheduleEntry {
  int dayOfWeek;
  int startMinutes;
  int endMinutes;
  String subjectName;
};

Adafruit_ILI9341 tft = Adafruit_ILI9341(TFT_CS, TFT_DC, TFT_RST);
HardwareSerial fingerSerial(2);
Adafruit_Fingerprint finger(&fingerSerial);
RTC_DS3231 rtc;

ScheduleEntry cachedSchedule[MAX_SCHEDULES];
int scheduleCount = 0;
bool scheduleEverLoaded = false;        // true once a schedule is in RAM (from flash or backend)
bool scheduleFetchedThisBoot = false;   // true once the backend has answered this boot

bool rtcTrusted = false;                // false = RTC time is unknown/unverified

unsigned long lastScheduleFetch = 0;
unsigned long lastCommandPoll = 0;
unsigned long lastQueueFlush = 0;
unsigned long lastScanTime = 0;
unsigned long lastDisplayRefresh = 0;
unsigned long lastNtpAttempt = 0;
unsigned long lastNtpSuccess = 0;

String lastResultStatus = "";
String lastResultSubject = "";

// Status-screen redraw cache (lets us update the clock/cursor without a full repaint)
bool   statusScreenShown = false;
bool   sWifi = false, sActive = false, sClockOk = false;
int    sQueue = -1;
String sSubject = "";
String sClock = "";
bool   cursorOn = true;

// ---------------------------------------------------------------- display

String upper(String s) { s.toUpperCase(); return s; }

// PORTRAIT: keeps text inside 240 px. At size 2 (12 px/char) the max is 19-20 chars.
String fitText(String s, uint8_t maxChars) {
  if (s.length() <= maxChars) return s;
  return s.substring(0, maxChars - 1) + ".";
}

// PORTRAIT: thresholds re-tuned for a 240 px wide screen
//   size 4 = 24 px/char -> 9 chars = 216 px
//   size 3 = 18 px/char -> 12 chars = 216 px
//   size 2 = 12 px/char -> up to 19 chars = 228 px
uint8_t autoSize(const String &s) {
  if (s.length() <= 9) return 4;
  if (s.length() <= 12) return 3;
  return 2;
}

// Scales an RGB565 color's brightness (used for the glow halo)
uint16_t dimColor(uint16_t c, uint8_t pct) {
  uint16_t r = ((c >> 11) & 0x1F) * pct / 100;
  uint16_t g = ((c >> 5)  & 0x3F) * pct / 100;
  uint16_t b = (c & 0x1F) * pct / 100;
  return (r << 11) | (g << 5) | b;
}

void centerText(const String &text, int y, uint8_t size) {
  int16_t x1, y1;
  uint16_t w, h;
  tft.setTextSize(size);
  tft.getTextBounds(text, 0, y, &x1, &y1, &w, &h);
  int x = (tft.width() - (int)w) / 2;
  if (x < 0) x = 0;
  tft.setCursor(x, y);
  tft.print(text);
}

// Fake neon glow: dim copies at 4 offsets, bright text on top
void glowTextAt(const String &t, int x, int y, uint8_t size, uint16_t color) {
  tft.setTextSize(size);
  tft.setTextColor(dimColor(color, 35));
  tft.setCursor(x - 1, y); tft.print(t);
  tft.setCursor(x + 1, y); tft.print(t);
  tft.setCursor(x, y - 1); tft.print(t);
  tft.setCursor(x, y + 1); tft.print(t);
  tft.setTextColor(color);
  tft.setCursor(x, y); tft.print(t);
}

void glowText(const String &t, int y, uint8_t size, uint16_t color) {
  int16_t x1, y1;
  uint16_t w, h;
  tft.setTextSize(size);
  tft.getTextBounds(t, 0, y, &x1, &y1, &w, &h);
  int x = ((int)tft.width() - (int)w) / 2;
  if (x < 1) x = 1;
  glowTextAt(t, x, y, size, color);
}

void drawScanlines() {
  for (int y = 0; y < tft.height(); y += 4) tft.drawFastHLine(0, y, tft.width(), COLOR_GRID);
}

void drawCornerBrackets(uint16_t c) {
  const int b = 14, w = tft.width(), h = tft.height();
  tft.fillRect(4, 4, b, 2, c);              tft.fillRect(4, 4, 2, b, c);               // top-left
  tft.fillRect(w - 4 - b, 4, b, 2, c);      tft.fillRect(w - 6, 4, 2, b, c);           // top-right
  tft.fillRect(4, h - 6, b, 2, c);          tft.fillRect(4, h - 4 - b, 2, b, c);       // bottom-left
  tft.fillRect(w - 4 - b, h - 6, b, 2, c);  tft.fillRect(w - 6, h - 4 - b, 2, b, c);   // bottom-right
}

// Clears a rectangle to the background and re-draws the scanlines inside it
void clearRegion(int x, int y, int w, int h) {
  tft.fillRect(x, y, w, h, COLOR_BG);
  int first = ((y + 3) / 4) * 4;
  for (int yy = first; yy < y + h; yy += 4) tft.drawFastHLine(x, yy, w, COLOR_GRID);
}

void drawFrame(uint16_t bracketColor) {
  tft.fillScreen(COLOR_BG);
  drawScanlines();
  drawCornerBrackets(bracketColor);
}

void initDisplay() {
  tft.begin();
  tft.setRotation(0);   // PORTRAIT: 240 wide x 320 tall (use 2 if the image is upside down)
  tft.fillScreen(COLOR_BG);
  tft.setTextWrap(false);
}

void drawStatusHeader(bool wifiOnline) {
  tft.fillCircle(24, 20, 5, wifiOnline ? COLOR_NEON : COLOR_MAGENTA);
  tft.setTextSize(1);
  tft.setTextColor(wifiOnline ? COLOR_CYAN : COLOR_MAGENTA);
  tft.setCursor(36, 16);
  tft.print(wifiOnline ? "ONLINE" : "OFFLINE");
  tft.setTextColor(COLOR_NEON_DIM);
  tft.setCursor(tft.width() - 24 - 54, 16);
  tft.print("ATTENDO//");
}

void drawClockLine(const String &clockText, bool clockOk) {
  clearRegion(20, 30, tft.width() - 40, 24);   // PORTRAIT: was hard-coded 280 wide
  glowText(clockText, 34, 2, clockOk ? COLOR_CYAN : COLOR_RED);
}

// "> IN SESSION_" is centered as 13 characters at size 2 (12 px each)
int sessionLineX() { return (tft.width() - 13 * 12) / 2; }
int sessionLineY() { return tft.height() / 2 - 26 + 40; }

void drawSessionCursor(bool on) {
  int x = sessionLineX() + 12 * 12;
  int y = sessionLineY();
  if (on) {
    tft.setTextSize(2);
    tft.setTextColor(COLOR_NEON_DIM);
    tft.setCursor(x, y);
    tft.print("_");
  } else {
    clearRegion(x, y, 12, 16);
  }
}

void displayStatusScreen(String clockText, bool wifiOnline, bool classActive,
                         String subjectName, int queueCount, bool clockOk) {
  clockText.toUpperCase();
  String subject = fitText(upper(subjectName), 19);   // PORTRAIT: truncate long subjects

  bool layoutChanged = !statusScreenShown || wifiOnline != sWifi || classActive != sActive ||
                       clockOk != sClockOk || queueCount != sQueue || subject != sSubject;

  if (layoutChanged) {
    drawFrame(COLOR_NEON);
    drawStatusHeader(wifiOnline);
    drawClockLine(clockText, clockOk);

    int midY = tft.height() / 2 - (classActive ? 26 : 18);
    if (classActive) {
      glowText(subject, midY, autoSize(subject), COLOR_NEON);
      glowTextAt("> IN SESSION", sessionLineX(), sessionLineY(), 2, COLOR_NEON_DIM);
      cursorOn = true;
      drawSessionCursor(true);
    } else {
      tft.setTextColor(COLOR_NEON_DIM);
      centerText("NO CLASS", midY, 3);
      centerText("SCANNER IDLE", midY + 34, 2);
    }

    if (!clockOk) {
      // PORTRAIT: 24 chars at size 2 is 288 px, so split across two lines
      tft.setTextColor(COLOR_RED);
      centerText("CONNECT WIFI", tft.height() - 52, 2);
      centerText("TO SET TIME", tft.height() - 32, 2);
    } else if (queueCount > 0) {
      tft.setTextColor(COLOR_AMBER);
      centerText(String(queueCount) + " QUEUED OFFLINE", tft.height() - 30, 2);
    }

    sWifi = wifiOnline; sActive = classActive; sClockOk = clockOk;
    sQueue = queueCount; sSubject = subject; sClock = clockText;
    statusScreenShown = true;
    return;
  }

  // Nothing structural changed: update only the clock and the blinking cursor.
  if (clockText != sClock) {
    drawClockLine(clockText, clockOk);
    sClock = clockText;
  }
  if (classActive) {
    cursorOn = !cursorOn;
    drawSessionCursor(cursorOn);
  }
}

void displayScanResult(String slotLabel, String status, String subjectName) {
  uint16_t color = (status == "present") ? COLOR_NEON
                  : (status == "late" || status == "queued") ? COLOR_AMBER
                  : COLOR_RED;
  String label = (status == "present") ? "PRESENT"
               : (status == "late") ? "LATE"
               : (status == "queued") ? "RECORDED"   // neutral: status is decided by the server later
               : "REJECTED";
  String tag = (status == "present" || status == "late") ? "[ ACCESS GRANTED ]"
             : (status == "queued") ? "[ STORED LOCALLY ]"
             : "[ ACCESS DENIED ]";
  statusScreenShown = false;
  drawFrame(color);
  tft.setTextColor(COLOR_NEON_DIM);
  centerText(fitText(upper(slotLabel), 19), tft.height() / 2 - 60, 2);
  glowText(label, tft.height() / 2 - 20, 4, color);
  tft.setTextColor(COLOR_CYAN);
  centerText(fitText(upper(subjectName), 19), tft.height() / 2 + 40, 2);   // PORTRAIT: truncate
  tft.setTextColor(COLOR_NEON_DIM);
  centerText(tag, tft.height() - 44, 1);
}

void displayMessage(String line1, String line2, uint16_t color) {
  line1.toUpperCase();
  line2.toUpperCase();
  statusScreenShown = false;
  drawFrame(COLOR_NEON);
  int midY = tft.height() / 2 - 24;
  glowText(line1, midY, autoSize(line1), color);
  tft.setTextColor(COLOR_NEON_DIM);
  centerText(fitText(line2, 19), midY + 34, 2);   // PORTRAIT: never wider than the screen
}

void displayEnrollStep(int step) {
  statusScreenShown = false;
  drawFrame(COLOR_CYAN);
  String text = (step == 1) ? "PLACE FINGER"
              : (step == 2) ? "REMOVE FINGER"
              : (step == 3) ? "PLACE AGAIN"
              : "SAVING";
  glowText(text, tft.height() / 2 - 16, 3, COLOR_CYAN);
  int dotSpacing = 26;
  int startX = (tft.width() - dotSpacing * 3) / 2;
  int y = tft.height() / 2 + 40;
  for (int i = 0; i < 4; i++) {
    uint16_t c = (i < step) ? COLOR_NEON : COLOR_DOTOFF;
    tft.fillCircle(startX + i * dotSpacing, y, 4, c);
  }
}

// ---------------------------------------------------------------- setup / loop

void setup() {
  Serial.begin(115200);
  delay(300);
  initDisplay();
  displayMessage("Attendo", "Starting up...", COLOR_NEON);

  fingerSerial.begin(57600, SERIAL_8N1, 16, 17);
  finger.begin(57600);
  if (finger.verifyPassword()) {
    Serial.println("AS608 sensor found and ready.");
  } else {
    Serial.println("AS608 sensor NOT found. Check wiring.");
    displayMessage("Hardware error", "Sensor not found", COLOR_RED);
    while (true) delay(1000);
  }

  Wire.begin();
  if (!rtc.begin()) {
    Serial.println("RTC NOT found. Check wiring.");
    displayMessage("Hardware error", "RTC not found", COLOR_RED);
    while (true) delay(1000);
  }
  rtcTrusted = !rtc.lostPower();
  if (!rtcTrusted) {
    Serial.println("RTC lost power -- time untrusted until NTP sync succeeds.");
  }

  if (!LittleFS.begin(true)) {
    Serial.println("Failed to mount LittleFS.");
  } else {
    LittleFS.remove(QUEUE_TMP);   // stale temp file from an interrupted flush
    loadScheduleFromFS();         // works even if we boot with no WiFi
  }

  setupWiFi();   // returns whether or not WiFi connected (offline mode is allowed)

  if (WiFi.status() == WL_CONNECTED) {
    syncRtcFromNtp();
    lastScheduleFetch = millis();
    fetchSchedule();
  }
  refreshStatusScreen();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    static unsigned long lastReconnectAttempt = 0;
    if (millis() - lastReconnectAttempt > WIFI_RECONNECT_MS) {
      lastReconnectAttempt = millis();
      Serial.println("WiFi disconnected -- attempting silent reconnect...");
      WiFi.begin();   // reuses saved credentials
    }
  }
  bool online = WiFi.status() == WL_CONNECTED;

  if (online) {
    bool ntpDue = (millis() - lastNtpAttempt >= NTP_RETRY_MS) &&
                  (!rtcTrusted || millis() - lastNtpSuccess >= NTP_RESYNC_MS);
    if (ntpDue) syncRtcFromNtp();
  }

  unsigned long scheduleInterval = scheduleFetchedThisBoot ? SCHEDULE_REFRESH_MS : SCHEDULE_RETRY_MS;
  if (online && millis() - lastScheduleFetch >= scheduleInterval) {
    lastScheduleFetch = millis();
    fetchSchedule();
  }
  if (online && millis() - lastCommandPoll >= COMMAND_POLL_MS) {
    lastCommandPoll = millis();
    checkForEnrollCommand();
  }
  if (online && millis() - lastQueueFlush >= QUEUE_FLUSH_MS) {
    lastQueueFlush = millis();
    flushOfflineQueue();
  }
  if (isClassInSession()) attemptAttendanceScan();
  if (millis() - lastDisplayRefresh >= DISPLAY_REFRESH_MS) {
    lastDisplayRefresh = millis();
    refreshStatusScreen();
  }
  delay(50);
}

// ---------------------------------------------------------------- WiFi

void setupWiFi() {
  pinMode(0, INPUT_PULLUP); // GPIO0 is the BOOT button on most ESP32 devkits

  if (digitalRead(0) == LOW) {
    Serial.println("BOOT button held -- resetting saved WiFi credentials.");
    displayMessage("Resetting WiFi", "Release button...", COLOR_AMBER);
    wifiManager.resetSettings();
    delay(1000);
  }

  wifiManager.setConnectTimeout(WIFI_CONNECT_TIMEOUT_SEC);
  wifiManager.setConfigPortalTimeout(PORTAL_TIMEOUT_SEC);

  displayMessage("WiFi setup", "Join: " + String(SETUP_AP_NAME), COLOR_NEON_DIM);
  Serial.println("Starting WiFiManager (portal SSID: " + String(SETUP_AP_NAME) + ")");

  bool connected = wifiManager.autoConnect(SETUP_AP_NAME, SETUP_AP_PASSWORD);

  if (!connected) {
    Serial.println("WiFi setup timed out -- continuing in offline mode.");
    WiFi.mode(WIFI_STA);   // make sure the setup AP is gone; loop() will keep retrying silently
    displayMessage("Offline mode", "Scans queued", COLOR_AMBER);   // PORTRAIT: shortened
    delay(2000);
    return;
  }

  WiFi.setAutoReconnect(true);
  Serial.println("WiFi connected. IP: " + WiFi.localIP().toString());
  displayMessage("WiFi connected", WiFi.localIP().toString(), COLOR_NEON);
  delay(1200);
}

// ---------------------------------------------------------------- RTC / NTP

bool syncRtcFromNtp() {
  lastNtpAttempt = millis();
  configTime(NTP_GMT_OFFSET_SEC, 0, "pool.ntp.org", "time.google.com");
  struct tm t;
  if (!getLocalTime(&t, 5000)) {
    Serial.println("NTP sync failed.");
    return false;
  }
  if (t.tm_year + 1900 < 2024) {   // sanity check: reject obviously wrong time
    Serial.println("NTP returned an implausible date; ignoring.");
    return false;
  }
  rtc.adjust(DateTime(t.tm_year + 1900, t.tm_mon + 1, t.tm_mday,
                      t.tm_hour, t.tm_min, t.tm_sec));
  rtcTrusted = true;
  lastNtpSuccess = millis();
  Serial.printf("RTC synced from NTP: %04d-%02d-%02d %02d:%02d:%02d\n",
                t.tm_year + 1900, t.tm_mon + 1, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec);
  return true;
}

// ---------------------------------------------------------------- schedule

bool isClassInSession() {
  if (!scheduleEverLoaded) return false;
  DateTime now = rtc.now();
  int dow = now.dayOfTheWeek();
  int minutes = now.hour() * 60 + now.minute();
  for (int i = 0; i < scheduleCount; i++) {
    if (cachedSchedule[i].dayOfWeek == dow && minutes >= cachedSchedule[i].startMinutes && minutes <= cachedSchedule[i].endMinutes) return true;
  }
  return false;
}

String getActiveSubjectName() {
  DateTime now = rtc.now();
  int dow = now.dayOfTheWeek();
  int minutes = now.hour() * 60 + now.minute();
  for (int i = 0; i < scheduleCount; i++) {
    if (cachedSchedule[i].dayOfWeek == dow && minutes >= cachedSchedule[i].startMinutes && minutes <= cachedSchedule[i].endMinutes) return cachedSchedule[i].subjectName;
  }
  return "";
}

int timeStrToMinutes(String hhmm) {
  int c = hhmm.indexOf(':');
  if (c < 0) return 0;
  return hhmm.substring(0, c).toInt() * 60 + hhmm.substring(c + 1).toInt();
}

// Parses a schedule JSON array into the RAM cache. Returns false (and leaves the
// existing cache untouched) if the JSON is invalid or not an array.
bool applyScheduleJson(const String &json) {
  JsonDocument doc;
  if (deserializeJson(doc, json)) return false;
  if (!doc.is<JsonArray>()) return false;
  int count = 0;
  for (JsonObject item : doc.as<JsonArray>()) {
    if (count >= MAX_SCHEDULES) break;
    cachedSchedule[count].dayOfWeek = item["dayOfWeek"];
    cachedSchedule[count].startMinutes = timeStrToMinutes(item["startTime"].as<String>());
    cachedSchedule[count].endMinutes = timeStrToMinutes(item["endTime"].as<String>());
    cachedSchedule[count].subjectName = item["subjectName"].as<String>();
    count++;
  }
  scheduleCount = count;
  scheduleEverLoaded = true;
  return true;
}

void loadScheduleFromFS() {
  if (!LittleFS.exists(SCHEDULE_FILE)) return;
  File f = LittleFS.open(SCHEDULE_FILE, FILE_READ);
  if (!f) return;
  String json = f.readString();
  f.close();
  if (applyScheduleJson(json)) {
    Serial.printf("Schedule loaded from flash: %d entries.\n", scheduleCount);
  } else {
    Serial.println("Saved schedule was unreadable; ignoring.");
  }
}

bool fetchSchedule() {
  HTTPClient http;
  String url = String(BACKEND_BASE_URL) + "/device/schedule";
  http.begin(url);
  http.addHeader("X-Device-Key", DEVICE_KEY);
  int status = http.GET();
  if (status != 200) { Serial.printf("Schedule fetch failed (HTTP %d)\n", status); http.end(); return false; }
  String response = http.getString();
  http.end();

  if (!applyScheduleJson(response)) {
    Serial.println("Failed to parse schedule response; keeping previous schedule.");
    return false;
  }
  scheduleFetchedThisBoot = true;

  File f = LittleFS.open(SCHEDULE_FILE, FILE_WRITE);
  if (f) { f.print(response); f.close(); }
  Serial.printf("Schedule synced: %d entries cached.\n", scheduleCount);
  return true;
}

// ---------------------------------------------------------------- time helpers / status

String currentTimestampISO() {
  DateTime now = rtc.now();
  char buf[32];
  snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02d%s", now.year(), now.month(), now.day(), now.hour(), now.minute(), now.second(), TIMEZONE_OFFSET);
  return String(buf);
}

String formatClockForDisplay() {
  DateTime now = rtc.now();
  const char* days[] = { "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat" };
  int h24 = now.hour();
  int h12 = h24 % 12 == 0 ? 12 : h24 % 12;
  const char* ampm = h24 >= 12 ? "PM" : "AM";
  char buf[24];
  snprintf(buf, sizeof(buf), "%s %02d:%02d %s", days[now.dayOfTheWeek()], h12, now.minute(), ampm);
  return String(buf);
}

int countQueueEntries() {
  if (!LittleFS.exists(QUEUE_FILE)) return 0;
  File f = LittleFS.open(QUEUE_FILE, FILE_READ);
  if (!f) return 0;
  int count = 0;
  while (f.available()) { String l = f.readStringUntil('\n'); l.trim(); if (l.length() > 0) count++; }
  f.close();
  return count;
}

void refreshStatusScreen() {
  bool online = WiFi.status() == WL_CONNECTED;
  bool active = isClassInSession();
  String subjectName = active ? getActiveSubjectName() : "";
  String clockText = rtcTrusted ? formatClockForDisplay() : String("Time not set");
  displayStatusScreen(clockText, online, active, subjectName, countQueueEntries(), rtcTrusted);
}

// ---------------------------------------------------------------- attendance

void attemptAttendanceScan() {
  if (millis() - lastScanTime < SCAN_COOLDOWN_MS) return;
  int p = finger.getImage();
  if (p != FINGERPRINT_OK) return;

  // Never record a scan whose timestamp we can't trust.
  if (!rtcTrusted) {
    Serial.println("Scan refused: RTC time is not trusted. Connect to WiFi so NTP can set it.");
    displayMessage("Clock not set", "Connect WiFi first", COLOR_RED);
    delay(2000);
    refreshStatusScreen();
    lastScanTime = millis();
    return;
  }

  p = finger.image2Tz();
  if (p != FINGERPRINT_OK) { Serial.println("Could not process fingerprint image."); return; }
  p = finger.fingerFastSearch();
  if (p != FINGERPRINT_OK) {
    Serial.println("No match found for this finger.");
    displayScanResult("Unknown", "rejected", "No match found");
    delay(1500);
    refreshStatusScreen();
    lastScanTime = millis();
    return;
  }
  int matchedSlot = finger.fingerID;
  String timestamp = currentTimestampISO();
  Serial.printf("Match: slot #%d at %s\n", matchedSlot, timestamp.c_str());
  String slotLabel = "Slot #" + String(matchedSlot);
  if (sendAttendanceScan(matchedSlot, timestamp)) {
    if (lastResultStatus.length() > 0) displayScanResult(slotLabel, lastResultStatus, lastResultSubject);
    else displayScanResult(slotLabel, "rejected", "See serial log");
  } else {
    Serial.println("Backend unreachable -- queueing scan for later sync.");
    queueScanOffline(matchedSlot, timestamp);
    displayScanResult(slotLabel, "queued", "Will sync later");
  }
  delay(2000);
  refreshStatusScreen();
  lastScanTime = millis();
}

// Returns true if the backend gave a definitive answer (2xx/4xx) -- the scan is done with.
// Returns false if it should stay queued/be queued (no connection or 5xx server error).
bool sendAttendanceScan(int fingerprintId, String timestamp) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  String url = String(BACKEND_BASE_URL) + "/attendance/scan";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_KEY);
  JsonDocument body;
  body["fingerprintId"] = fingerprintId;
  body["scannedAt"] = timestamp;
  String payload;
  serializeJson(body, payload);
  int status = http.POST(payload);
  String response = http.getString();
  http.end();
  if (status <= 0 || status >= 500) return false;
  lastResultStatus = "";
  lastResultSubject = "";
  if (status == 201) {
    JsonDocument doc;
    if (!deserializeJson(doc, response)) {
      lastResultStatus = doc["status"].as<String>();
      lastResultSubject = doc["subject"]["name"].as<String>();
    }
    Serial.println("Attendance recorded: " + response);
  } else {
    Serial.printf("Attendance scan rejected (HTTP %d): %s\n", status, response.c_str());
  }
  return true;
}

void queueScanOffline(int fingerprintId, String timestamp) {
  File f = LittleFS.open(QUEUE_FILE, FILE_APPEND);
  if (!f) { Serial.println("Failed to open queue file for writing."); return; }
  JsonDocument doc;
  doc["fingerprintId"] = fingerprintId;
  doc["scannedAt"] = timestamp;
  String line;
  serializeJson(doc, line);
  f.println(line);
  f.close();
  Serial.println("Queued offline: " + line);
}

void flushOfflineQueue() {
  if (!LittleFS.exists(QUEUE_FILE)) return;
  File f = LittleFS.open(QUEUE_FILE, FILE_READ);
  if (!f) return;
  if (f.size() == 0) { f.close(); LittleFS.remove(QUEUE_FILE); return; }
  Serial.println("Flushing offline queue...");
  displayMessage("Syncing...", "Sending scans", COLOR_AMBER);   // PORTRAIT: shortened
  String remaining = "";
  int deliveredCount = 0;
  while (f.available()) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;
    JsonDocument doc;
    if (deserializeJson(doc, line)) continue;   // corrupt line: drop it
    int fingerprintId = doc["fingerprintId"];
    String timestamp = doc["scannedAt"].as<String>();
    bool delivered = sendAttendanceScan(fingerprintId, timestamp);
    if (delivered) deliveredCount++;
    else remaining += line + "\n";
    delay(150);
  }
  f.close();

  // Power-safe update: never delete the queue before the replacement is fully written.
  if (remaining.length() == 0) {
    LittleFS.remove(QUEUE_FILE);
  } else if (deliveredCount > 0) {
    File out = LittleFS.open(QUEUE_TMP, FILE_WRITE);
    if (out) {
      size_t written = out.print(remaining);
      out.close();
      if (written == remaining.length()) LittleFS.rename(QUEUE_TMP, QUEUE_FILE);
      else LittleFS.remove(QUEUE_TMP);
    }
  }
  // If nothing was delivered, the original queue file is left exactly as it was.

  if (deliveredCount > 0) {
    displayMessage("Sync complete", String(deliveredCount) + " scan(s) sent", COLOR_NEON);
    delay(1500);
  }
  refreshStatusScreen();
}

// ---------------------------------------------------------------- commands / enrollment

void checkForEnrollCommand() {
  HTTPClient http;
  String url = String(BACKEND_BASE_URL) + "/device/command";
  http.begin(url);
  http.addHeader("X-Device-Key", DEVICE_KEY);
  int status = http.GET();
  if (status != 200) { http.end(); return; }
  String response = http.getString();
  http.end();
  JsonDocument doc;
  if (deserializeJson(doc, response)) return;
  const char* action = doc["action"];

  if (action && strcmp(action, "refresh_schedule") == 0) {
    Serial.println("Backend requested a schedule refresh.");
    lastScheduleFetch = millis();
    fetchSchedule();
    return;
  }

  if (action && strcmp(action, "enroll") == 0) {
    String requestId = doc["requestId"].as<String>();
    int slot = doc["slot"];
    Serial.printf("Enrollment requested for slot #%d\n", slot);
    bool success = enrollFingerprint(slot);
    reportEnrollResult(requestId, slot, success);
    refreshStatusScreen();
  }
}

bool enrollFingerprint(int slot) {
  displayEnrollStep(1);
  int p = -1;
  unsigned long startTime = millis();
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    if (millis() - startTime > 15000) { displayMessage("Enroll failed", "Timed out", COLOR_RED); delay(2000); return false; }
  }
  p = finger.image2Tz(1);
  if (p != FINGERPRINT_OK) { displayMessage("Enroll failed", "Bad image", COLOR_RED); delay(2000); return false; }

  displayEnrollStep(2);
  delay(1500);
  p = 0;
  while (p != FINGERPRINT_NOFINGER) p = finger.getImage();

  displayEnrollStep(3);
  p = -1;
  startTime = millis();
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    if (millis() - startTime > 15000) { displayMessage("Enroll failed", "Timed out", COLOR_RED); delay(2000); return false; }
  }
  p = finger.image2Tz(2);
  if (p != FINGERPRINT_OK) { displayMessage("Enroll failed", "Bad image", COLOR_RED); delay(2000); return false; }

  displayEnrollStep(4);
  p = finger.createModel();
  if (p != FINGERPRINT_OK) { displayMessage("Enroll failed", "Prints didn't match", COLOR_RED); delay(2000); return false; }
  p = finger.storeModel(slot);
  if (p != FINGERPRINT_OK) { displayMessage("Enroll failed", "Storage error", COLOR_RED); delay(2000); return false; }

  displayMessage("Enrolled", "Slot #" + String(slot), COLOR_NEON);
  delay(2000);
  return true;
}

void reportEnrollResult(String requestId, int slot, bool success) {
  HTTPClient http;
  String url = String(BACKEND_BASE_URL) + "/device/enroll-result";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_KEY);
  JsonDocument body;
  body["requestId"] = requestId;
  body["slot"] = slot;
  body["success"] = success;
  String payload;
  serializeJson(body, payload);
  int status = http.POST(payload);
  http.end();
  Serial.printf("Enroll result reported (HTTP %d)\n", status);
}