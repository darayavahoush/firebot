/*
 * =========================================================================================
 * FIREBOT ESP32 EMBEDDED CONTROLLER FIRMWARE
 * =========================================================================================
 * Hardware Target: ESP32 DevKit V1 (30-pin or 38-pin WROOM-32)
 * Communication:   USB Serial / UART @ 115200 baud to Raspberry Pi 4/5
 *
 * Responsibilities:
 *  1. Sample 4x HC-SR04 Ultrasonic Distance Sensors (front-left, front-right, left, right)
 *  2. Sample 3x IR Flame Sensor modules (left, center, right)
 *  3. Sample 2x MQ-2 Smoke / Combustible Gas Sensors (front, rear) via ADC
 *  4. Sample Water Tank Level & Battery Voltage via ADC
 *  5. Drive 2x DC Motors (Differential Drive) via H-Bridge (TB6612FNG / L298N)
 *  6. Switch 12V Diaphragm Water Pump via Logic-Level N-MOSFET
 *  7. Pan the extinguisher nozzle (SG90): brain sends a normalised pan RATE, we integrate to an angle
 *  8. Enforce Hardware Safety Watchdog (kill pump & motors if serial link lost for >500ms)
 *  9. Stream JSON telemetry frames to Pi at 10 Hz (matching firebot.link.agent protocol)
 * =========================================================================================
 */

#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

// -----------------------------------------------------------------------------------------
// PIN DEFINITIONS
// -----------------------------------------------------------------------------------------

// --- HC-SR04 Ultrasonic Sensors ---
// Note: Echo pins MUST use a voltage divider (5V -> 3.3V) before entering ESP32!
#define PIN_US_FL_TRIG   13
#define PIN_US_FL_ECHO   34  // Input only

#define PIN_US_FR_TRIG   12
#define PIN_US_FR_ECHO   35  // Input only

#define PIN_US_L_TRIG    14
#define PIN_US_L_ECHO    36  // VP (Input only)

#define PIN_US_R_TRIG    27
#define PIN_US_R_ECHO    39  // VN (Input only)

// --- IR Flame Sensor Modules (Digital Active-LOW or Analog inverted) ---
#define PIN_FLAME_L      25
#define PIN_FLAME_C      26
#define PIN_FLAME_R      33

// --- MQ-2 Gas Sensors (Analog Inputs, ADC1) ---
#define PIN_MQ2_FRONT    32  // ADC1_CH4
#define PIN_MQ2_REAR     15  // ADC2_CH3 / Touch3

// --- Water Tank Level Sensor & Battery Monitor (ADC1) ---
#define PIN_TANK_LEVEL    4  // ADC2_CH0 / Touch0 (Resistive / Float level)
#define PIN_BATT_MONITOR  2  // ADC2_CH2 (10k / 2.2k divider: 12.6V max -> 2.28V at pin)

// --- DC Motor H-Bridge Driver (TB6612FNG or L298N) ---
// Left Motor
#define PIN_MOTOR_L_PWM  18  // Speed PWM
#define PIN_MOTOR_L_IN1  19  // Direction
#define PIN_MOTOR_L_IN2  21  // Direction

// Right Motor
#define PIN_MOTOR_R_PWM  22  // Speed PWM
#define PIN_MOTOR_R_IN3  23  // Direction
#define PIN_MOTOR_R_IN4   5  // Direction

// --- 12V Diaphragm Water Pump (Logic-Level N-MOSFET Gate) ---
#define PIN_PUMP_GATE    17

// --- Extinguisher Nozzle Turret Servos (SG90) ---
#define PIN_SERVO_PAN    16

// -----------------------------------------------------------------------------------------
// PWM & TIMER CONFIGURATION
// -----------------------------------------------------------------------------------------
#define PWM_FREQ         20000  // 20 kHz ultrasonic motor PWM (inaudible, smooth torque)
#define PWM_RES          8      // 8-bit resolution (0 - 255)
#define PWM_CH_MOTOR_L   0
#define PWM_CH_MOTOR_R   1

#define SERIAL_BAUD      115200
#define TELEMETRY_RATE_HZ 10    // 10 Hz telemetry loop (100ms period)
#define WATCHDOG_MS      500    // Failsafe timeout: halt motors/pump if no command for 0.5s

// -----------------------------------------------------------------------------------------
// GLOBALS & OBJECTS
// -----------------------------------------------------------------------------------------
Servo servoPan;

unsigned long lastTelemetryTime = 0;
unsigned long lastCommandTime = 0;
bool failsafeTriggered = false;

// Robot State
float cmd_v = 0.0f;       // Linear velocity demand: [0.0, 1.0]
float cmd_w = 0.0f;       // Angular velocity demand: [-1.0, 1.0]
bool  cmd_pump = false;   // Water pump demand: on/off
float cmd_turret = 0.0f;  // Turret pan RATE demand from the brain: [-1.0, 1.0] (normalised, see protocol.py)
float turret_angle = 0.0f; // Integrated pan angle in RADIANS, chassis-relative (reported in telemetry)
unsigned long lastTurretTime = 0;
int   last_ack = -1;

// Odometry state (simple dead-reckoning estimator based on velocity commands)
float pose_x = 0.0f;
float pose_y = 0.0f;
float pose_theta = 0.0f;
float measured_speed = 0.0f;
unsigned long lastOdomTime = 0;

// Maximum robot physical linear and angular velocity at full duty cycle
const float MAX_LINEAR_SPEED = 0.60f;  // m/s (~0.6 m/s top speed)
const float MAX_ANGULAR_SPEED = 2.50f; // rad/s
const float WHEEL_BASE = 0.22f;        // 22 cm between left and right wheels

// Turret: must match firebot/sim/env.py (TURRET_WMAX, TURRET_LIMIT) so the brain's model of the
// nozzle agrees with the real one. The brain sends a normalised RATE; we integrate it to an angle.
const float TURRET_WMAX  = 2.5f;                 // rad/s at cmd_turret = +/-1
const float TURRET_LIMIT = 1.57079632679f;       // +/- 90 deg usable servo range
const int   TURRET_SERVO_SIGN = 1;               // set to -1 if the nozzle pans the wrong way

// -----------------------------------------------------------------------------------------
// ACTUATOR FUNCTIONS
// -----------------------------------------------------------------------------------------

void initActuators() {
  // Motor Pins
  pinMode(PIN_MOTOR_L_IN1, OUTPUT);
  pinMode(PIN_MOTOR_L_IN2, OUTPUT);
  pinMode(PIN_MOTOR_R_IN3, OUTPUT);
  pinMode(PIN_MOTOR_R_IN4, OUTPUT);

  // Setup LEDC PWM for motors
  ledcAttach(PIN_MOTOR_L_PWM, PWM_FREQ, PWM_RES);
  ledcAttach(PIN_MOTOR_R_PWM, PWM_FREQ, PWM_RES);

  // Pump MOSFET Gate
  pinMode(PIN_PUMP_GATE, OUTPUT);
  digitalWrite(PIN_PUMP_GATE, LOW);

  // Servo Turret
  servoPan.attach(PIN_SERVO_PAN, 500, 2500);
  servoPan.write(90); // Center position (0 radians); turret_angle starts at 0

  // Safe halt immediately on boot
  haltActuators();
}

void haltActuators() {
  // Stop Left Motor
  digitalWrite(PIN_MOTOR_L_IN1, LOW);
  digitalWrite(PIN_MOTOR_L_IN2, LOW);
  ledcWrite(PIN_MOTOR_L_PWM, 0);

  // Stop Right Motor
  digitalWrite(PIN_MOTOR_R_IN3, LOW);
  digitalWrite(PIN_MOTOR_R_IN4, LOW);
  ledcWrite(PIN_MOTOR_R_PWM, 0);

  // Stop Pump
  digitalWrite(PIN_PUMP_GATE, LOW);

  cmd_v = 0.0f;
  cmd_w = 0.0f;
  cmd_pump = false;
  cmd_turret = 0.0f;   // rate 0 = hold current angle
  measured_speed = 0.0f;
}

void applyMotorCommands(float v, float w) {
  // Differential drive kinematics:
  // left_norm  = v - (w * 0.5)
  // right_norm = v + (w * 0.5)
  float u_l = v - (w * 0.5f);
  float u_r = v + (w * 0.5f);

  // Clamp to [-1.0, 1.0]
  u_l = constrain(u_l, -1.0f, 1.0f);
  u_r = constrain(u_r, -1.0f, 1.0f);

  // Left Motor Direction & PWM
  if (u_l > 0.02f) {
    digitalWrite(PIN_MOTOR_L_IN1, HIGH);
    digitalWrite(PIN_MOTOR_L_IN2, LOW);
    ledcWrite(PIN_MOTOR_L_PWM, (uint32_t)(fabs(u_l) * 255.0f));
  } else if (u_l < -0.02f) {
    digitalWrite(PIN_MOTOR_L_IN1, LOW);
    digitalWrite(PIN_MOTOR_L_IN2, HIGH);
    ledcWrite(PIN_MOTOR_L_PWM, (uint32_t)(fabs(u_l) * 255.0f));
  } else {
    digitalWrite(PIN_MOTOR_L_IN1, LOW);
    digitalWrite(PIN_MOTOR_L_IN2, LOW);
    ledcWrite(PIN_MOTOR_L_PWM, 0);
  }

  // Right Motor Direction & PWM
  if (u_r > 0.02f) {
    digitalWrite(PIN_MOTOR_R_IN3, HIGH);
    digitalWrite(PIN_MOTOR_R_IN4, LOW);
    ledcWrite(PIN_MOTOR_R_PWM, (uint32_t)(fabs(u_r) * 255.0f));
  } else if (u_r < -0.02f) {
    digitalWrite(PIN_MOTOR_R_IN3, LOW);
    digitalWrite(PIN_MOTOR_R_IN4, HIGH);
    ledcWrite(PIN_MOTOR_R_PWM, (uint32_t)(fabs(u_r) * 255.0f));
  } else {
    digitalWrite(PIN_MOTOR_R_IN3, LOW);
    digitalWrite(PIN_MOTOR_R_IN4, LOW);
    ledcWrite(PIN_MOTOR_R_PWM, 0);
  }

  measured_speed = v * MAX_LINEAR_SPEED;
}

void applyPumpCommand(bool pumpOn) {
  digitalWrite(PIN_PUMP_GATE, pumpOn ? HIGH : LOW);
}

void updateTurret() {
  // Integrate the rate command into an angle, clamp, and drive the SG90 (90 deg = centred).
  // Runs every loop(). cmd_turret is forced to 0 by haltActuators(), so the nozzle simply holds
  // its last angle on failsafe/E-stop (it does not snap back).
  unsigned long now = millis();
  float dt = (now - lastTurretTime) / 1000.0f;
  lastTurretTime = now;
  if (dt <= 0.0f || dt > 1.0f) return;

  turret_angle += cmd_turret * TURRET_WMAX * dt;
  turret_angle = constrain(turret_angle, -TURRET_LIMIT, TURRET_LIMIT);

  static int lastDeg = -1;
  int deg = (int)(90.0f + TURRET_SERVO_SIGN * turret_angle * (180.0f / PI));
  deg = constrain(deg, 0, 180);
  if (deg != lastDeg) {   // only touch the servo when the target actually moves (avoids jitter)
    servoPan.write(deg);
    lastDeg = deg;
  }
}

// -----------------------------------------------------------------------------------------
// SENSOR SAMPLING
// -----------------------------------------------------------------------------------------

void initSensors() {
  // Ultrasonic Trigger pins as output
  pinMode(PIN_US_FL_TRIG, OUTPUT);
  pinMode(PIN_US_FR_TRIG, OUTPUT);
  pinMode(PIN_US_L_TRIG, OUTPUT);
  pinMode(PIN_US_R_TRIG, OUTPUT);

  digitalWrite(PIN_US_FL_TRIG, LOW);
  digitalWrite(PIN_US_FR_TRIG, LOW);
  digitalWrite(PIN_US_L_TRIG, LOW);
  digitalWrite(PIN_US_R_TRIG, LOW);

  // Ultrasonic Echo pins as input
  pinMode(PIN_US_FL_ECHO, INPUT);
  pinMode(PIN_US_FR_ECHO, INPUT);
  pinMode(PIN_US_L_ECHO, INPUT);
  pinMode(PIN_US_R_ECHO, INPUT);

  // Flame sensors (Digital Comparator D0: LOW when flame detected, HIGH when dark)
  pinMode(PIN_FLAME_L, INPUT);
  pinMode(PIN_FLAME_C, INPUT);
  pinMode(PIN_FLAME_R, INPUT);

  // ADC resolution to 12-bit (0 - 4095)
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db); // Full 0 - 3.3V range
}

float readUltrasonicMeters(uint8_t trigPin, uint8_t echoPin) {
  // Trigger 10us high pulse
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  // 24ms timeout corresponds to approx 4.0 meters max range
  unsigned long duration = pulseIn(echoPin, HIGH, 24000);
  if (duration == 0) {
    return 4.0f; // Max range if no echo returned within timeout
  }

  // Speed of sound = 343 m/s -> (duration * 0.000343) / 2
  float distMeters = (duration * 0.0343f / 2.0f) / 100.0f;
  return constrain(distMeters, 0.03f, 4.0f);
}

float readFlameSensor(uint8_t pin) {
  // Most standard IR flame photodiode modules output active LOW on digital pin
  // (LOW = Fire detected, HIGH = Normal)
  // Normalized protocol requires: 0.0 (clean/no flame), 1.0 (intense flame detected)
  int val = digitalRead(pin);
  return (val == LOW) ? 1.0f : 0.0f;
}

float readMq2Normalized(uint8_t pin) {
  int raw = analogRead(pin);
  float norm = (float)raw / 4095.0f;
  return constrain(norm, 0.0f, 1.0f);
}

float readWaterTankNormalized() {
  int raw = analogRead(PIN_TANK_LEVEL);
  float norm = (float)raw / 4095.0f;
  return constrain(norm, 0.0f, 1.0f);
}

float readBatteryVoltage() {
  // Voltage divider: R1 = 10k, R2 = 2.2k
  // V_pin = V_bat * (2.2 / (10 + 2.2)) = V_bat * (2.2 / 12.2) = V_bat * 0.1803
  // V_bat = V_pin * (12.2 / 2.2) = V_pin * 5.545
  int raw = analogRead(PIN_BATT_MONITOR);
  float vPin = ((float)raw / 4095.0f) * 3.3f;
  float vBat = vPin * 5.545f;
  return vBat;
}

// -----------------------------------------------------------------------------------------
// ODOMETRY INTEGRATION
// -----------------------------------------------------------------------------------------
void updateOdometry() {
  unsigned long now = millis();
  float dt = (now - lastOdomTime) / 1000.0f;
  lastOdomTime = now;

  if (dt <= 0.0f || dt > 1.0f) return;

  float lin_v = cmd_v * MAX_LINEAR_SPEED;
  float ang_w = cmd_w * MAX_ANGULAR_SPEED;

  pose_theta += ang_w * dt;
  // Keep theta in [-pi, pi]
  while (pose_theta > PI)  pose_theta -= 2.0f * PI;
  while (pose_theta < -PI) pose_theta += 2.0f * PI;

  pose_x += lin_v * cos(pose_theta) * dt;
  pose_y += lin_v * sin(pose_theta) * dt;
}

// -----------------------------------------------------------------------------------------
// SERIAL TELEMETRY & COMMAND PROCESSING
// -----------------------------------------------------------------------------------------

void sendTelemetryFrame() {
  // Read all sensors
  float us_fl = readUltrasonicMeters(PIN_US_FL_TRIG, PIN_US_FL_ECHO);
  float us_fr = readUltrasonicMeters(PIN_US_FR_TRIG, PIN_US_FR_ECHO);
  float us_l  = readUltrasonicMeters(PIN_US_L_TRIG, PIN_US_L_ECHO);
  float us_r  = readUltrasonicMeters(PIN_US_R_TRIG, PIN_US_R_ECHO);

  float flame_l = readFlameSensor(PIN_FLAME_L);
  float flame_c = readFlameSensor(PIN_FLAME_C);
  float flame_r = readFlameSensor(PIN_FLAME_R);

  float mq2_f = readMq2Normalized(PIN_MQ2_FRONT);
  float mq2_r = readMq2Normalized(PIN_MQ2_REAR);

  float tank = readWaterTankNormalized();
  float current_turret = turret_angle; // Current pan angle in radians (protocol.py: Frame.turret)

  // Construct JSON document matching firebot protocol
  StaticJsonDocument<512> doc;
  doc["t"] = millis() / 1000.0f;

  JsonArray poseArr = doc.createNestedArray("pose");
  poseArr.add(round(pose_x * 1000.0f) / 1000.0f);
  poseArr.add(round(pose_y * 1000.0f) / 1000.0f);
  poseArr.add(round(pose_theta * 1000.0f) / 1000.0f);

  doc["speed"] = round(measured_speed * 100.0f) / 100.0f;
  doc["tank"]  = round(tank * 100.0f) / 100.0f;
  doc["turret"] = round(current_turret * 1000.0f) / 1000.0f;

  JsonObject sensors = doc.createNestedObject("sensors");
  sensors["us_front_left"]  = round(us_fl * 100.0f) / 100.0f;
  sensors["us_front_right"] = round(us_fr * 100.0f) / 100.0f;
  sensors["us_left"]        = round(us_l * 100.0f) / 100.0f;
  sensors["us_right"]       = round(us_r * 100.0f) / 100.0f;

  sensors["flame_left"]   = flame_l;
  sensors["flame_center"] = flame_c;
  sensors["flame_right"]  = flame_r;

  sensors["mq2_front"] = round(mq2_f * 1000.0f) / 1000.0f;
  sensors["mq2_rear"]  = round(mq2_r * 1000.0f) / 1000.0f;

  // Serialize to Serial line
  serializeJson(doc, Serial);
  Serial.println();
}

void processIncomingCommands() {
  while (Serial.available() > 0) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;

    StaticJsonDocument<256> doc;
    DeserializationError err = deserializeJson(doc, line);
    if (err) {
      continue; // Malformed packet ignored
    }

    // Parse command fields: {"v": 0.5, "w": 0.0, "pump": false, "turret": 0.0, "ack": 42}
    if (doc.containsKey("v") && doc.containsKey("w") && doc.containsKey("pump")) {
      cmd_v = doc["v"].as<float>();
      cmd_w = doc["w"].as<float>();
      cmd_pump = doc["pump"].as<bool>();

      if (doc.containsKey("turret")) {
        cmd_turret = doc["turret"].as<float>();
      }
      if (doc.containsKey("ack")) {
        last_ack = doc["ack"].as<int>();
      }

      // Reset watchdog timer
      lastCommandTime = millis();
      failsafeTriggered = false;

      // Apply to hardware actuators
      applyMotorCommands(cmd_v, cmd_w);
      applyPumpCommand(cmd_pump);
    }
  }
}

void checkWatchdog() {
  // If no command received from Pi within WATCHDOG_MS, trigger failsafe stop
  if (!failsafeTriggered && (millis() - lastCommandTime > WATCHDOG_MS)) {
    haltActuators();
    failsafeTriggered = true;
  }
}

// -----------------------------------------------------------------------------------------
// SETUP & MAIN LOOP
// -----------------------------------------------------------------------------------------

void setup() {
  Serial.begin(SERIAL_BAUD);
  // Default readStringUntil timeout is 1000 ms: a half-received line would block loop() (and the
  // watchdog) for a full second with the motors still running. Keep it short.
  Serial.setTimeout(20);
  // Wait up to 1 second for serial connection (non-blocking if headless)
  unsigned long start = millis();
  while (!Serial && (millis() - start < 1000));

  initActuators();
  initSensors();

  lastCommandTime = millis();
  lastTelemetryTime = millis();
  lastOdomTime = millis();
  lastTurretTime = millis();
}

void loop() {
  // 1. Process incoming commands from Raspberry Pi
  processIncomingCommands();

  // 2. Enforce hardware watchdog
  checkWatchdog();

  // 3. Update estimated odometry and nozzle pan angle
  updateOdometry();
  updateTurret();

  // 4. Send telemetry frame at configured rate (10 Hz = every 100ms)
  unsigned long now = millis();
  if (now - lastTelemetryTime >= (1000 / TELEMETRY_RATE_HZ)) {
    lastTelemetryTime = now;
    sendTelemetryFrame();
  }
}
