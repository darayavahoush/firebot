import React, { useCallback, useEffect, useRef, useState } from "react";
import MujocoScene from "../components/mujoco/MujocoScene.js";
import { PanelHeader } from "../components/TelemetryGauges.jsx";

const CONTROLLERS = [
  { id: "frontier", label: "Frontier", hint: "lidar avoidance + map-based exploration" },
  { id: "scan", label: "Scan", hint: "lidar avoidance, wandering search" },
  { id: "rule", label: "Rule baseline", hint: "four ultrasonic beams only" },
];
const SPEEDS = [0.5, 1, 2, 4, 8];
const STATE_COLOR = { EXPLORE: "text-muted", TRACK: "text-warn", SPRAY: "text-telemetry" };

function Btn({ on, children, ...p }) {
  return (
    <button {...p} className={`px-3 py-1.5 rounded-full text-[12px] border transition-colors ${on ? "border-telemetry text-telemetry bg-telemetry/15" : "border-line text-muted hover:text-ink"}`}>
      {children}
    </button>
  );
}

function Stat({ label, value, unit, cls = "" }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-faint">{label}</div>
      <div className={`data text-[20px] ${cls}`}>{value}{unit && <span className="text-[12px] text-faint ml-1">{unit}</span>}</div>
    </div>
  );
}

export default function MuJoCo() {
  const hostRef = useRef(null);
  const sceneRef = useRef(null);
  const wsRef = useRef(null);
  const [status, setStatus] = useState(null);          // /api/mujoco/status
  const [seed, setSeed] = useState(3);
  const [controller, setController] = useState("frontier");
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [camMode, setCamMode] = useState("orbit");
  const [lidar, setLidar] = useState(true);
  const [pathOn, setPathOn] = useState(true);
  const [logRun, setLogRun] = useState(false);          // save the run to the History database
  const [sessionId, setSessionId] = useState(null);
  const [warn, setWarn] = useState("");
  const [phase, setPhase] = useState("idle");          // idle | loading | running | done | error
  const [error, setError] = useState("");
  const [hud, setHud] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    fetch("/api/mujoco/status").then((r) => r.json()).then(setStatus).catch(() => setStatus({ available: false, detail: "Backend not reachable. Is `./run.sh` running in firebot-console/backend?" }));
  }, []);

  useEffect(() => {
    const s = new MujocoScene(hostRef.current);
    sceneRef.current = s;
    return () => { wsRef.current?.close(); s.dispose(); };
  }, []);

  useEffect(() => { const s = sceneRef.current; if (s) { s.showLidar = lidar; s.showPath = pathOn; } }, [lidar, pathOn]);
  useEffect(() => { sceneRef.current?.setCamera(camMode); }, [camMode]);

  const start = useCallback(() => {
    wsRef.current?.close();
    setPhase("loading"); setError(""); setResult(null); setHud(null); setPaused(false); setSessionId(null); setWarn("");
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/mujoco?seed=${seed}&controller=${controller}&speed=${speed}&log=${logRun ? 1 : 0}`);
    wsRef.current = ws;
    let last = 0;
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "scene") { sceneRef.current.load(m); setSessionId(m.session_id || null); setPhase("running"); }
      else if (m.type === "warn") { setWarn(m.message); }
      else if (m.type === "frame") {
        sceneRef.current.frame(m);
        const now = performance.now();
        if (now - last > 90 || m.done) { last = now; setHud(m); }   // throttle React re-renders
      } else if (m.type === "end") { setResult(m); setPhase("done"); }
      else if (m.type === "error") { setError(m.message); setPhase("error"); }
    };
    ws.onerror = () => { setError("WebSocket failed. Is the backend running?"); setPhase("error"); };
  }, [seed, controller, speed, logRun]);

  const send = (msg) => wsRef.current?.readyState === 1 && wsRef.current.send(JSON.stringify(msg));
  const togglePause = () => { setPaused((p) => { send({ paused: !p }); return !p; }); };
  const changeSpeed = (v) => { setSpeed(v); send({ speed: v }); };

  const unavailable = status && !status.available;
  const busy = phase === "loading";

  return (
    <div className="flex-1 min-h-0 px-6 pb-6 pt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="panel flex flex-col min-h-[520px]">
        <PanelHeader label="MuJoCo scene" />
        <div className="relative flex-1 min-h-[460px] border-t border-line">
          <div ref={hostRef} className="absolute inset-0" />
          {phase === "idle" && !unavailable && (
            <div className="absolute inset-0 flex items-center justify-center text-muted text-[14px] pointer-events-none">
              Pick a seed and controller, then press Run.
            </div>
          )}
          {(unavailable || phase === "error") && (
            <div className="absolute inset-x-6 top-6 rounded-lg border border-warn bg-panel/95 p-4 text-[13px] text-warn">
              {phase === "error" ? error : status.detail}
            </div>
          )}
          {phase === "done" && result && (
            <div className={`absolute top-4 left-1/2 -translate-x-1/2 rounded-full border px-4 py-1.5 text-[13px] font-mono bg-panel ${result.success ? "border-ok text-ok" : "border-alarm text-alarm"}`}>
              {result.success ? `Fire out in ${result.t.toFixed(1)} s` : `Time out after ${result.t.toFixed(0)} s`} · {result.collisions} collisions
            </div>
          )}
          <div className="absolute bottom-3 left-3 flex gap-2">
            {["orbit", "top", "follow"].map((c) => <Btn key={c} on={camMode === c} onClick={() => setCamMode(c)}>{c}</Btn>)}
          </div>
          <div className="absolute bottom-3 right-3 flex gap-2">
            <Btn on={lidar} onClick={() => setLidar((v) => !v)}>lidar rays</Btn>
            <Btn on={pathOn} onClick={() => setPathOn((v) => !v)}>planned path</Btn>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="panel">
          <PanelHeader label="Run" />
          <div className="border-t border-line p-4 flex flex-col gap-3">
            <label className="text-[12px] text-muted flex items-center justify-between gap-3">
              Map seed
              <input type="number" value={seed} min={0} onChange={(e) => setSeed(Math.max(0, parseInt(e.target.value || "0", 10)))}
                className="data w-24 bg-panel2 border border-line rounded px-2 py-1 text-ink text-right" />
            </label>
            <div className="flex flex-col gap-1.5">
              {CONTROLLERS.map((c) => (
                <button key={c.id} onClick={() => setController(c.id)} title={c.hint}
                  className={`text-left rounded-lg border px-3 py-2 transition-colors ${controller === c.id ? "border-telemetry bg-telemetry/10" : "border-line hover:border-faint"}`}>
                  <div className="text-[13px] text-ink">{c.label}</div>
                  <div className="text-[11px] text-faint">{c.hint}</div>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-[12px] text-muted mr-1">Speed</span>
              {SPEEDS.map((v) => <Btn key={v} on={speed === v} onClick={() => changeSpeed(v)}>{v}×</Btn>)}
            </div>
            <div className="flex flex-wrap gap-1.5 items-center">
              <Btn on={logRun} onClick={() => setLogRun((v) => !v)} disabled={phase === "running"}>Log this run</Btn>
              <span className="text-[11px] text-faint">saves to History; shows on Live while running</span>
            </div>
            {warn && <div className="text-[12px] text-warn">{warn}</div>}
            {sessionId && <div className="text-[11px] text-faint data break-all">Logging as session {sessionId.slice(0, 8)}</div>}
            <div className="flex gap-2">
              <button onClick={start} disabled={unavailable || busy}
                className="flex-1 h-10 rounded-full bg-telemetry text-[#1A0615] font-display font-extrabold text-[14px] disabled:opacity-40 hover:brightness-110 active:scale-95 transition">
                {busy ? "Building map…" : phase === "idle" ? "Run" : "Restart"}
              </button>
              {(phase === "running") && <Btn on={paused} onClick={togglePause}>{paused ? "Resume" : "Pause"}</Btn>}
            </div>
          </div>
        </div>

        <div className="panel">
          <PanelHeader label="Episode" />
          <div className="grid grid-cols-2 divide-x divide-y divide-line border-t border-line">
            <Stat label="State" value={hud?.state ?? "—"} cls={STATE_COLOR[hud?.state] ?? ""} />
            <Stat label="Time" value={hud ? hud.t.toFixed(1) : "—"} unit="s" />
            <Stat label="Fire" value={hud ? Math.round(hud.fire_p * 100) : "—"} unit="%" cls={hud && hud.fire_p > 0 ? "text-alarm" : "text-ok"} />
            <Stat label="Tank" value={hud ? Math.round(hud.tank * 100) : "—"} unit="%" />
            <Stat label="Collisions" value={hud?.collisions ?? "—"} cls={hud?.collisions ? "text-warn" : ""} />
            <Stat label="Pump" value={hud ? (hud.pump ? "ON" : "off") : "—"} cls={hud?.pump ? "text-telemetry" : ""} />
          </div>
        </div>
        <p className="text-[11px] text-faint leading-relaxed px-1">
          Same simulator as <span className="data">firebot-sim --world mujoco</span>, run live on the backend. Maps differ from the Simulator tab, which is a separate browser-only engine. The lidar exists only in simulation; the real robot has none. Drag to orbit, scroll to zoom. Rays show the 36-beam lidar at 0.15 m; the green line is the frontier planner's path.
        </p>
      </div>
    </div>
  );
}
