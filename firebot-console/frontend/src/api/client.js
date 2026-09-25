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

export async function fetchRunDetail(runId) {
  if (USE_MOCK) return mockRunDetail(runId);
  const res = await fetch(`/api/runs/${runId}`);
  if (!res.ok) throw new Error(`fetchRunDetail failed: ${res.status}`);
  return res.json();
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

  const ws = new WebSocket(`ws://${window.location.hostname}:8000/ws/telemetry`);
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
  return Array.from({ length: 8 }).map((_, i) => {
    const started = now - (i + 1) * 1000 * 60 * 60 * (3 + i);
    const durationS = 90 + Math.floor(Math.random() * 600);
    return {
      id: `run-${8 - i}`,
      robot: "firebot-1",
      started_at: new Date(started).toISOString(),
      ended_at: new Date(started + durationS * 1000).toISOString(),
      notes: "brain session",
      frames: 50 + Math.floor(Math.random() * 600),
      duration_s: durationS,
      min_tank: +(Math.random() * 0.6).toFixed(2),
      pumped: Math.random() > 0.4,
      operator_commands: Math.floor(Math.random() * 10),
    };
  });
}

function mockRunDetail(runId) {
  const points = Array.from({ length: 60 }).map((_, i) => ({
    seq: i,
    t: +(i * 0.1).toFixed(2),
    x: +(3 + Math.sin(i / 8)).toFixed(2),
    y: +(1.8 + Math.cos(i / 8)).toFixed(2),
    theta: +(i * 0.03).toFixed(2),
    speed: +(Math.random() * 0.4).toFixed(2),
    tank: +Math.max(0, 1 - i * 0.01).toFixed(2),
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
    thermal: i % 10 === 0 ? mockThermalGrid(i) : null,
    est_x: +(3 + Math.random() * 0.3).toFixed(2),
    est_y: +(1.8 + Math.random() * 0.3).toFixed(2),
    est_sigma: +Math.max(0.2, 10 - i * 0.15).toFixed(2),
    mode: "AUTO",
    cmd_v: +(Math.random() * 0.4).toFixed(2),
    cmd_w: +((Math.random() - 0.5) * 0.6).toFixed(2),
    cmd_pump: Math.random() > 0.9,
    compute_ms: +(Math.random() * 2).toFixed(2),
  }));
  return { id: runId, points };
}
