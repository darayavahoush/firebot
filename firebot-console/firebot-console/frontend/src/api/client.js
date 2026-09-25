// Thin bridge to backend/server.py. Falls back to a mock data generator
// so the console is fully browsable before the backend is wired up —
// remove USE_MOCK once /api is live.

const USE_MOCK = true;

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

// Live telemetry stream. onFrame receives:
// { t, mode, battery_v, temp_c, gas_ppm, pos: {x,y}, link_ok, last_ack_ms }
export function connectTelemetry(onFrame) {
  if (USE_MOCK) return mockTelemetryStream(onFrame);

  const ws = new WebSocket(`ws://${window.location.hostname}:8000/ws/telemetry`);
  ws.onmessage = (evt) => {
    try {
      onFrame(JSON.parse(evt.data));
    } catch (e) {
      console.error("bad telemetry frame", e);
    }
  };
  ws.onerror = (e) => console.error("telemetry ws error", e);
  return () => ws.close();
}

// ---- mock implementation ----

function mockTelemetryStream(onFrame) {
  let t = 0;
  let pos = { x: 3.2, y: 1.8 };
  const modes = ["idle", "auto", "manual"];
  let mode = "auto";

  const interval = setInterval(() => {
    t += 1;
    pos = {
      x: +(pos.x + (Math.random() - 0.5) * 0.15).toFixed(2),
      y: +(pos.y + (Math.random() - 0.5) * 0.15).toFixed(2),
    };
    if (t % 23 === 0) mode = modes[Math.floor(Math.random() * modes.length)];

    onFrame({
      t,
      mode,
      battery_v: +(12.6 - t * 0.001 + Math.random() * 0.03).toFixed(2),
      temp_c: +(24 + Math.sin(t / 12) * 6 + Math.random() * 1.5).toFixed(1),
      gas_ppm: +(Math.max(0, 8 + Math.sin(t / 20) * 5 + Math.random() * 3)).toFixed(1),
      pos,
      link_ok: Math.random() > 0.02,
      last_ack_ms: Math.floor(20 + Math.random() * 40),
    });
  }, 800);

  return () => clearInterval(interval);
}

function mockRuns() {
  const now = Date.now();
  return Array.from({ length: 8 }).map((_, i) => {
    const started = now - (i + 1) * 1000 * 60 * 60 * (3 + i);
    const durationS = 90 + Math.floor(Math.random() * 600);
    return {
      id: `run-${8 - i}`,
      started_at: new Date(started).toISOString(),
      duration_s: durationS,
      mode: i % 3 === 0 ? "voice" : i % 2 === 0 ? "auto" : "manual",
      extinguished: Math.random() > 0.25,
      max_temp_c: +(28 + Math.random() * 40).toFixed(1),
      commands: 20 + Math.floor(Math.random() * 140),
    };
  });
}

function mockRunDetail(runId) {
  const points = Array.from({ length: 40 }).map((_, i) => ({
    t: i,
    temp_c: +(25 + Math.sin(i / 5) * 10 + Math.random() * 2).toFixed(1),
    battery_v: +(12.6 - i * 0.01).toFixed(2),
  }));
  return { id: runId, points };
}
