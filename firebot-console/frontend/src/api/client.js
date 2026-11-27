// Thin bridge to backend/server.py. Falls back to a mock data generator
// so the console is fully browsable before the backend is wired up —
// remove USE_MOCK once /api is live.

const USE_MOCK = false;

export async function fetchRuns() {
  if (USE_MOCK) return mockRuns();
  const res = await fetch("/api/runs");
  if (!res.ok) throw new Error(`fetchRuns failed: ${res.status}`);
  return res.json();
}

export async function seedRuns() {
  const res = await fetch("/api/runs/seed", { method: "POST" });
  if (!res.ok) throw new Error(`seedRuns failed: ${res.status}`);
  return res.json();
}

export async function fetchRunDetail(runId) {
  if (USE_MOCK) return mockRunDetail(runId);
  const res = await fetch(`/api/runs/${runId}`);
  if (!res.ok) throw new Error(`fetchRunDetail failed: ${res.status}`);
  return res.json();
}

export async function fetchRunSummary(runId) {
  try {
    const res = await fetch(`/api/runs/${runId}/summary`);
    return res.ok ? res.json() : null;
  } catch { return null; }
}

export async function fetchRunAnomalies(runId) {
  try {
    const res = await fetch(`/api/runs/${runId}/anomalies`);
    return res.ok ? res.json() : null;
  } catch { return null; }
}

export async function sendCommand(command) {
  if (USE_MOCK) {
    console.info("[mock] command sent", command);
    return { ok: true };
  }
  const res = await fetch("/api/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`sendCommand failed: ${res.status}`);
  return res.json();
}

export async function sendEstop() {
  return sendCommand({ type: "ESTOP" });
}

// Live telemetry stream. onFrame receives a raw frames-table row:
// { type: "frame", seq, t, x, y, theta, speed, tank,
//   sensors: {us_*, flame_*, mq2_front, mq2_rear},
//   thermal: number[24][32] | null, est_x, est_y, est_sigma, mode,
//   cmd_v, cmd_w, cmd_pump, compute_ms, session_id }
// `thermal` is null except on every Nth frame (thermal_every on the brain).
// onCommand (optional) receives new operator_commands rows as they land:
// { type: "command", id, at, text, channel: "typed"|"voice"|"backstop"|"system",
//   valid, message }
export function connectTelemetry(onFrame, onCommand) {
  if (USE_MOCK) return mockTelemetryStream(onFrame);

  const ws = new WebSocket(`${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws/telemetry`);
  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      if (msg.type === "command") {
        onCommand?.(msg);
      } else {
        onFrame(msg);
      }
    } catch (e) {
      console.error("bad telemetry message", e);
    }
  };
  ws.onerror = (e) => console.error("telemetry ws error", e);
  return () => ws.close();
}

// ---- mock implementation ----

const THERM_ROWS = 24;
const THERM_COLS = 32;

function mockThermalGrid(t) {
  return Array.from({ length: THERM_ROWS }, (_, r) =>
    Array.from({ length: THERM_COLS }, (_, c) => {
      const dx = c - (THERM_COLS / 2 + Math.sin(t / 15) * 6);
      const dy = r - (THERM_ROWS / 2 + Math.cos(t / 18) * 4);
      const dist = Math.sqrt(dx * dx + dy * dy);
      return +(22 + Math.max(0, 40 - dist * 3) + Math.random() * 1.5).toFixed(1);
    })
  );
}

function mockTelemetryStream(onFrame) {
  let seq = 0;
  let x = 3.2, y = 1.8, theta = 0;
  const modes = ["IDLE", "AUTO", "GOTO"];
  let mode = "AUTO";

  const interval = setInterval(() => {
    seq += 1;
    const t = seq * 0.1;
    x = +(x + (Math.random() - 0.5) * 0.15).toFixed(3);
    y = +(y + (Math.random() - 0.5) * 0.15).toFixed(3);
    theta = +(theta + (Math.random() - 0.5) * 0.1).toFixed(3);
    if (seq % 23 === 0) mode = modes[Math.floor(Math.random() * modes.length)];

    onFrame({
      seq,
      t,
      x,
      y,
      theta,
      speed: +(Math.random() * 0.4).toFixed(2),
      tank: +Math.max(0, 1 - seq * 0.0005).toFixed(3),
      sensors: {
        us_front_left: +(0.5 + Math.random() * 3).toFixed(2),
        us_front_right: +(0.5 + Math.random() * 3).toFixed(2),
        us_left: +(0.5 + Math.random() * 3).toFixed(2),
        us_right: +(0.5 + Math.random() * 3).toFixed(2),
        flame_left: +(Math.random() * 0.05).toFixed(3),
        flame_center: +(Math.random() * 0.05).toFixed(3),
        flame_right: +(Math.random() * 0.05).toFixed(3),
        mq2_front: +(Math.random() * 0.3).toFixed(3),
        mq2_rear: +(Math.random() * 0.3).toFixed(3),
      },
      thermal: seq % 10 === 0 ? mockThermalGrid(seq) : null,
      est_x: +(x + (Math.random() - 0.5) * 0.3).toFixed(2),
      est_y: +(y + (Math.random() - 0.5) * 0.3).toFixed(2),
      est_sigma: +Math.max(0.2, 10 - seq * 0.02).toFixed(2),
      mode,
      cmd_v: +(Math.random() * 0.4).toFixed(2),
      cmd_w: +((Math.random() - 0.5) * 0.6).toFixed(2),
      cmd_pump: Math.random() > 0.9,
      compute_ms: +(Math.random() * 2).toFixed(2),
      session_id: "mock-session",
    });
  }, 300);

  return () => clearInterval(interval);
}

function mockRuns() {
  const now = Date.now();
  return [
    {
      id: "d8e3b1c2-5f6a-4b9d-8e7c-1a2b3c4d5e6f",
      robot: "firebot-1",
      started_at: new Date(now - 48 * 60 * 1000).toISOString(),
      ended_at: new Date(now - 43 * 60 * 1000).toISOString(),
      notes: "North Wing Sector 3 - structural fire detected and extinguished",
      frames: 60,
      duration_s: 290.0,
      min_tank: 0.42,
      pumped: true,
      operator_commands: 4,
    },
    {
      id: "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      robot: "firebot-1",
      started_at: new Date(now - 190 * 60 * 1000).toISOString(),
      ended_at: new Date(now - 187 * 60 * 1000).toISOString(),
      notes: "East corridor perimeter sweep - ambient thermal baseline established",
      frames: 60,
      duration_s: 180.0,
      min_tank: 1.0,
      pumped: false,
      operator_commands: 3,
    },
    {
      id: "f9e8d7c6-b5a4-3210-9876-543210fedcba",
      robot: "firebot-1",
      started_at: new Date(now - 1335 * 60 * 1000).toISOString(),
      ended_at: new Date(now - 1328 * 60 * 1000).toISOString(),
      notes: "Warehouse bay 4 - chemical flare suppressed, thermal anomaly isolated",
      frames: 60,
      duration_s: 420.0,
      min_tank: 0.18,
      pumped: true,
      operator_commands: 4,
    },
  ];
}

function mockRunDetail(runId) {
  const missions = {
    "d8e3b1c2-5f6a-4b9d-8e7c-1a2b3c4d5e6f": { dur: 290.0, pumpStart: 140.0, pumpEnd: 240.0, fireX: 8.4, fireY: 5.1, minTank: 0.42 },
    "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d": { dur: 180.0, pumpStart: 999999, pumpEnd: 999999, fireX: null, fireY: null, minTank: 1.0 },
    "f9e8d7c6-b5a4-3210-9876-543210fedcba": { dur: 420.0, pumpStart: 160.0, pumpEnd: 350.0, fireX: 4.5, fireY: 6.2, minTank: 0.18 },
  };
  const cfg = missions[runId] || { dur: 300.0, pumpStart: 120.0, pumpEnd: 220.0, fireX: 6.0, fireY: 4.0, minTank: 0.3 };
  const numFrames = 60;
  const dt = cfg.dur / numFrames;

  const points = Array.from({ length: numFrames }).map((_, i) => {
    const t = +(i * dt).toFixed(2);
    const frac = i / (numFrames - 1);
    const hasFire = cfg.fireX != null && t > 60.0;
    const isPumping = t >= cfg.pumpStart && t <= cfg.pumpEnd;

    let x = cfg.fireX != null
      ? +(1.2 + (cfg.fireX - 1.2) * Math.min(1.0, frac * 1.5) + Math.sin(t / 8.0) * 0.2).toFixed(2)
      : +(2.0 + 4.0 * Math.sin(frac * 4.0)).toFixed(2);
    let y = cfg.fireY != null
      ? +(1.0 + (cfg.fireY - 1.0) * Math.min(1.0, frac * 1.5) + Math.cos(t / 9.0) * 0.2).toFixed(2)
      : +(3.0 + 2.0 * Math.cos(frac * 4.0)).toFixed(2);

    const speed = isPumping ? 0.0 : +(0.35 + 0.1 * Math.sin(t)).toFixed(2);
    let tank = 1.0;
    if (isPumping) {
      tank = +Math.max(cfg.minTank, 1.0 - ((t - cfg.pumpStart) / (cfg.pumpEnd - cfg.pumpStart)) * (1.0 - cfg.minTank)).toFixed(2);
    } else if (t > cfg.pumpEnd) {
      tank = cfg.minTank;
    }

    const flame = hasFire ? +Math.min(0.98, Math.max(0.01, 0.9 * Math.exp(-Math.pow(t - 180.0, 2) / 6000.0))).toFixed(3) : 0.02;

    return {
      seq: i,
      t,
      x,
      y,
      theta: +(Math.sin(t / 10.0) * 1.5).toFixed(2),
      speed,
      tank,
      sensors: {
        us_front_left: +(1.2 + 0.8 * Math.sin(t / 3.0)).toFixed(2),
        us_front_right: +(1.1 + 0.7 * Math.cos(t / 3.0)).toFixed(2),
        us_left: +(2.0 + 0.5 * Math.sin(t / 5.0)).toFixed(2),
        us_right: +(1.8 + 0.6 * Math.cos(t / 5.0)).toFixed(2),
        flame_left: +(flame * 0.8).toFixed(3),
        flame_center: flame,
        flame_right: +(flame * 0.75).toFixed(3),
        mq2_front: +(0.1 + flame * 0.6).toFixed(3),
        mq2_rear: +(0.08 + flame * 0.3).toFixed(3),
      },
      thermal: i % 8 === 0 ? mockThermalGrid(t) : null,
      est_x: hasFire ? cfg.fireX : null,
      est_y: hasFire ? cfg.fireY : null,
      est_sigma: hasFire ? +Math.max(0.35, 12.0 * Math.exp(-t / 60.0)).toFixed(2) : 25.0,
      mode: isPumping ? "SPRAY" : (t > cfg.pumpEnd ? "SAFE" : "AUTO"),
      cmd_v: speed,
      cmd_w: +(Math.sin(t / 4.0) * 0.3).toFixed(2),
      cmd_pump: isPumping,
      compute_ms: +(1.2 + Math.sin(t) * 0.5).toFixed(2),
    };
  });

  return { id: runId, points };
}

// ---- Voice Studio & Calibration API ----

export async function fetchVoiceProfiles() {
  const res = await fetch("/api/voice/profiles");
  if (!res.ok) throw new Error(`fetchVoiceProfiles failed: ${res.status}`);
  return res.json();
}

export async function saveVoiceProfile(profile) {
  const res = await fetch("/api/voice/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
  if (!res.ok) throw new Error(`saveVoiceProfile failed: ${res.status}`);
  return res.json();
}

export async function fetchCalibrationStatus(user) {
  const res = await fetch(`/api/voice/calibrate/status?user=${encodeURIComponent(user)}`);
  if (!res.ok) throw new Error(`fetchCalibrationStatus failed: ${res.status}`);
  return res.json();
}

export async function uploadCalibrationClip(user, label, audioBlob) {
  const fd = new FormData();
  fd.append("file", audioBlob, "clip.wav");
  const res = await fetch(`/api/voice/calibrate/clip?user=${encodeURIComponent(user)}&label=${encodeURIComponent(label)}`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Upload failed: ${res.status}`);
  }
  return res.json();
}

export async function deleteCalibrationClip(user, label, filename = null) {
  const url = filename
    ? `/api/voice/calibrate/clip?user=${encodeURIComponent(user)}&label=${encodeURIComponent(label)}&filename=${encodeURIComponent(filename)}`
    : `/api/voice/calibrate/clip?user=${encodeURIComponent(user)}&label=${encodeURIComponent(label)}`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete clip failed: ${res.status}`);
  return res.json();
}

export async function trainCalibrationModel(user, allowPartial = true) {
  const res = await fetch(`/api/voice/calibrate/train?user=${encodeURIComponent(user)}&allow_partial=${allowPartial}&min_clips=1`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Train model failed: ${res.status}`);
  }
  return res.json();
}

export async function enrollSpeakerVoiceprint(user) {
  const res = await fetch(`/api/voice/calibrate/enroll-speaker?user=${encodeURIComponent(user)}`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Enroll speaker failed: ${res.status}`);
  }
  return res.json();
}

export async function testVoiceClip(audioBlob, expectedUser = null) {
  const fd = new FormData();
  fd.append("file", audioBlob, "test.wav");
  const url = expectedUser
    ? `/api/voice/test?expected_user=${encodeURIComponent(expectedUser)}`
    : "/api/voice/test";
  const res = await fetch(url, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Test voice failed: ${res.status}`);
  }
  return res.json();
}

export async function parseAndExecuteVoiceIntent(text, execute = false, operator = null) {
  const res = await fetch("/api/voice/intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, execute, operator }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Intent parsing failed: ${res.status}`);
  }
  return res.json();
}

// ---- Hugging Face Model Cloud Sync ----

export async function fetchHfSyncStatus() {
  const res = await fetch("/api/voice/hf/status");
  if (!res.ok) throw new Error(`fetchHfSyncStatus failed: ${res.status}`);
  return res.json();
}

export async function syncModelsFromHf(repoId = null) {
  const url = repoId ? `/api/voice/hf/sync?repo_id=${encodeURIComponent(repoId)}` : "/api/voice/hf/sync";
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HF sync failed: ${res.status}`);
  }
  return res.json();
}

export async function pushModelsToHf(repoId = null, user = null) {
  const params = new URLSearchParams();
  if (repoId) params.append("repo_id", repoId);
  if (user) params.append("user", user);
  const q = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`/api/voice/hf/push${q}`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HF push failed: ${res.status}`);
  }
  return res.json();
}
