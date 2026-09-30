import React, { useCallback, useEffect, useRef, useState } from "react";
import MujocoScene from "../components/mujoco/MujocoScene.js";
import { playSound } from "../lib/sound.js";

const CONTROLLERS = [
  {
    id: "mm_fusion",
    label: "Multimodal DRL Fusion",
    tag: "DEEP RL",
    desc: "Deep actor-critic policy fusing 36-beam Lidar, thermal camera, 4x ultrasonic sonar, and gas sensors with Bayesian EIF estimation.",
    sensor: "Lidar + Therm + Sonar + Gas (EIF)",
  },
  {
    id: "frontier",
    label: "Frontier Exploration",
    tag: "RECOMMENDED",
    desc: "Autonomous occupancy grid mapping & frontier point routing with pure-pursuit path execution.",
    sensor: "36-beam Lidar + SLAM",
  },
  {
    id: "scan",
    label: "Lidar Scan Avoidance",
    tag: "REACTIVE",
    desc: "360° obstacle clearance scanning with wandering open-corridor search and flame-tracking takeover.",
    sensor: "36-beam Lidar",
  },
  {
    id: "rule",
    label: "Rule-Based Baseline",
    tag: "ULTRASONIC",
    desc: "Direct observation reactive policy without lidar, relying strictly on 4 ultrasonic range beams.",
    sensor: "4x Ultrasonic",
  },
];

const SPEEDS = [0.5, 1, 2, 4, 8];

const STATE_CONFIG = {
  EXPLORE: { label: "EXPLORING TERRAIN", cls: "text-[#8FE0F5] bg-[#8FE0F5]/10 border-[#8FE0F5]/30" },
  TRACK: { label: "TRACKING THERMAL FLAME", cls: "text-warn bg-warn/10 border-warn/30 animate-pulse" },
  SPRAY: { label: "FIRE SUPPRESSION ACTIVE", cls: "text-telemetry bg-telemetry/15 border-telemetry/40 animate-pulse" },
};

const ROOM_NAMES = {
  datacenter: "Datacenter Server Hall",
  hazmat_lab: "Hazmat Containment Lab",
  control_room: "Operations Control Center",
  workshop: "Industrial Fabrication Bay",
  storage: "Warehouse Depot",
  office: "Administrative Office",
  atrium: "Central Botanical Atrium",
};

export default function MuJoCo() {
  const hostRef = useRef(null);
  const sceneRef = useRef(null);
  const wsRef = useRef(null);
  const [status, setStatus] = useState(null);
  const [seed, setSeed] = useState(3);
  const [controller, setController] = useState("mm_fusion");
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [camMode, setCamMode] = useState("orbit");
  const [lidar, setLidar] = useState(true);
  const [pathOn, setPathOn] = useState(true);
  const [particles, setParticles] = useState(true);
  const [sensors, setSensors] = useState(true);
  const [heatmap, setHeatmap] = useState(true);
  const [logRun, setLogRun] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [warn, setWarn] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | loading | running | done | error
  const [error, setError] = useState("");
  const [hud, setHud] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    fetch("/api/mujoco/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() =>
        setStatus({
          available: false,
          detail: "Backend not reachable. Is `./run.sh` running in firebot-console/backend?",
        })
      );
  }, []);

  useEffect(() => {
    const s = new MujocoScene(hostRef.current);
    sceneRef.current = s;
    return () => {
      wsRef.current?.close();
      s.dispose();
    };
  }, []);

  useEffect(() => {
    const s = sceneRef.current;
    if (s) {
      s.showLidar = lidar;
      s.showPath = pathOn;
      s.showParticles = particles;
      s.showSensors = sensors;
      s.showHeatmap = heatmap;
    }
  }, [lidar, pathOn, particles, sensors, heatmap]);

  useEffect(() => {
    sceneRef.current?.setCamera(camMode);
  }, [camMode]);

  const start = useCallback(() => {
    playSound("ack");
    wsRef.current?.close();
    setPhase("loading");
    setError("");
    setResult(null);
    setHud(null);
    setPaused(false);
    setSessionId(null);
    setWarn("");

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${window.location.host}/ws/mujoco?seed=${seed}&controller=${controller}&speed=${speed}&log=${
        logRun ? 1 : 0
      }`
    );
    wsRef.current = ws;
    let last = 0;

    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "scene") {
        sceneRef.current.load(m);
        setSessionId(m.session_id || null);
        setPhase("running");
      } else if (m.type === "warn") {
        setWarn(m.message);
      } else if (m.type === "frame") {
        sceneRef.current.frame(m);
        const now = performance.now();
        if (now - last > 80 || m.done) {
          last = now;
          setHud(m);
        }
      } else if (m.type === "end") {
        setResult(m);
        setPhase("done");
        playSound(m.success ? "ack" : "estop");
      } else if (m.type === "error") {
        setError(m.message);
        setPhase("error");
      }
    };
    ws.onerror = () => {
      setError("WebSocket connection failed. Ensure the MuJoCo backend server is running.");
      setPhase("error");
    };
  }, [seed, controller, speed, logRun]);

  const send = (msg) => wsRef.current?.readyState === 1 && wsRef.current.send(JSON.stringify(msg));

  const togglePause = () => {
    playSound("click");
    setPaused((p) => {
      send({ paused: !p });
      return !p;
    });
  };

  const changeSpeed = (v) => {
    playSound("click");
    setSpeed(v);
    send({ speed: v });
  };

  const handleRandomSeed = () => {
    playSound("click");
    setSeed(Math.floor(Math.random() * 999) + 1);
  };

  const unavailable = status && !status.available;
  const busy = phase === "loading";
  const stateStyle = STATE_CONFIG[hud?.state] || {
    label: hud?.state ?? "STANDBY",
    cls: "text-muted bg-panel2 border-line",
  };

  // Resolve current active room
  const currentRoom = sceneRef.current?.sc?.rooms?.find(
    (r) => hud && hud.x >= r.x && hud.x <= r.x + r.w && hud.y >= r.y && hud.y <= r.y + r.h
  );
  const roomTitle = currentRoom ? (ROOM_NAMES[currentRoom.kind] || currentRoom.kind.toUpperCase()) : "Transit Corridor";

  // Gas status badge
  const gasVal = hud?.gas ?? 0;
  const gasLevel = gasVal > 0.6 ? "HAZARD" : gasVal > 0.2 ? "ELEVATED" : "NOMINAL";
  const gasCls = gasVal > 0.6 ? "text-alarm border-alarm/40 bg-alarm/10" : gasVal > 0.2 ? "text-warn border-warn/40 bg-warn/10" : "text-ok border-ok/40 bg-ok/10";

  return (
    <div className="flex-1 min-h-0 p-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
      {/* 3D Viewport Station */}
      <div className="panel flex flex-col min-h-[600px] h-[calc(100vh-140px)] relative overflow-hidden">
        {/* Viewport Top Bar */}
        <div className="px-4 py-3 bg-panel2/70 border-b border-line flex items-center justify-between z-10 gap-2 flex-wrap">
          <div className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-telemetry animate-pulse shadow-[0_0_8px_#f0559b]" />
            <span className="font-display font-extrabold text-[15px] tracking-tight text-ink">
              MuJoCo 3D Rigid-Body Physics Sim
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-panel border border-line text-faint uppercase">
              Multimodal Sensors • 60Hz
            </span>
          </div>

          {/* Quick HUD Camera Controls */}
          <div className="flex items-center gap-1 bg-panel/90 backdrop-blur p-1 rounded-xl border border-line flex-wrap">
            {[
              { id: "orbit", label: "Orbit 3D" },
              { id: "top", label: "Top-Down" },
              { id: "follow", label: "Chase Cam" },
              { id: "fpv", label: "FPV Mast" },
              { id: "turret", label: "Turret Cam" },
            ].map((c) => (
              <button
                key={c.id}
                onClick={() => { playSound("click"); setCamMode(c.id); }}
                className={`px-2.5 py-1 text-[11px] font-mono rounded-lg transition-all cursor-pointer ${
                  camMode === c.id
                    ? "bg-telemetry text-base font-bold shadow-[0_0_8px_rgba(240,85,155,0.4)]"
                    : "text-muted hover:text-ink"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* 3D Canvas Host Container */}
        <div className="relative flex-1 min-h-[480px] bg-[#0E0919]">
          <div ref={hostRef} className="absolute inset-0 w-full h-full" />

          {/* Tactical Corner HUD Reticles */}
          <div className="absolute top-3 left-3 text-[10px] font-mono text-ink/30 select-none pointer-events-none">
            ┌ MUJOCO_ENGINE: v3.x
          </div>
          <div className="absolute top-3 right-3 text-[10px] font-mono text-ink/30 select-none pointer-events-none">
            WORLD_GEOMS ┐
          </div>
          <div className="absolute bottom-14 left-3 text-[10px] font-mono text-ink/30 select-none pointer-events-none">
            └ MULTIMODAL_FUSION
          </div>
          <div className="absolute bottom-14 right-3 text-[10px] font-mono text-ink/30 select-none pointer-events-none">
            PHYSICS_DT: 0.016s ┘
          </div>

          {/* Idle Prompt */}
          {phase === "idle" && !unavailable && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted gap-3 bg-base/50 backdrop-blur-sm pointer-events-none">
              <div className="h-12 w-12 rounded-2xl bg-panel2 border border-line flex items-center justify-center text-telemetry shadow-lg">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </div>
              <p className="text-[14px] font-mono text-ink">
                Configure parameters and press <b className="text-telemetry font-bold">START SIMULATION</b>
              </p>
              <p className="text-[12px] font-mono text-faint">
                Use mouse/trackpad to orbit, right-click to pan, scroll to zoom.
              </p>
            </div>
          )}

          {/* Unavailable / Error Message */}
          {(unavailable || phase === "error") && (
            <div className="absolute inset-x-6 top-6 rounded-2xl border border-warn/40 bg-panel/95 backdrop-blur-md p-5 text-[13px] text-warn shadow-2xl flex items-start gap-3">
              <span className="text-[20px] leading-none">⚠</span>
              <div className="space-y-1">
                <div className="font-bold uppercase tracking-wider text-[11px] font-mono">
                  Simulation Backend Offline
                </div>
                <div className="text-ink">
                  {phase === "error" ? error : status.detail}
                </div>
              </div>
            </div>
          )}

          {/* Episode Complete Banner */}
          {phase === "done" && result && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-2xl border px-6 py-2.5 shadow-2xl backdrop-blur-xl flex items-center gap-3 bg-panel/90 border-line animate-fadeIn">
              <span className={`text-[20px] leading-none ${result.success ? "text-ok" : "text-alarm"}`}>
                {result.success ? "✓" : "⚠"}
              </span>
              <div>
                <div className={`text-[14px] font-display font-black tracking-tight ${result.success ? "text-ok" : "text-alarm"}`}>
                  {result.success ? `FIRE EXTINGUISHED IN ${result.t.toFixed(1)}s` : `TIME OUT (${result.t.toFixed(0)}s)`}
                </div>
                <div className="text-[11px] font-mono text-faint">
                  {result.collisions} collisions recorded • Water pump completed
                </div>
              </div>
            </div>
          )}

          {/* Bottom Left Tactical Sensor & Layer Toggles */}
          <div className="absolute bottom-3 left-3 flex flex-wrap gap-1.5 z-10">
            <button
              onClick={() => { playSound("click"); setLidar((v) => !v); }}
              className={`px-2.5 py-1.5 rounded-xl text-[11px] font-mono border backdrop-blur-md transition-all cursor-pointer ${
                lidar
                  ? "border-telemetry bg-telemetry/20 text-white shadow-[0_0_10px_rgba(240,85,155,0.35)]"
                  : "border-line bg-panel/80 text-muted hover:text-ink"
              }`}
            >
              Lidar ({lidar ? "ON" : "OFF"})
            </button>
            <button
              onClick={() => { playSound("click"); setPathOn((v) => !v); }}
              className={`px-2.5 py-1.5 rounded-xl text-[11px] font-mono border backdrop-blur-md transition-all cursor-pointer ${
                pathOn
                  ? "border-ok bg-ok/20 text-white shadow-[0_0_10px_rgba(125,227,176,0.35)]"
                  : "border-line bg-panel/80 text-muted hover:text-ink"
              }`}
            >
              Path ({pathOn ? "ON" : "OFF"})
            </button>
            <button
              onClick={() => { playSound("click"); setParticles((v) => !v); }}
              className={`px-2.5 py-1.5 rounded-xl text-[11px] font-mono border backdrop-blur-md transition-all cursor-pointer ${
                particles
                  ? "border-[#ffaa33] bg-[#ffaa33]/20 text-white shadow-[0_0_10px_rgba(255,170,51,0.35)]"
                  : "border-line bg-panel/80 text-muted hover:text-ink"
              }`}
            >
              FX Particles ({particles ? "ON" : "OFF"})
            </button>
            <button
              onClick={() => { playSound("click"); setSensors((v) => !v); }}
              className={`px-2.5 py-1.5 rounded-xl text-[11px] font-mono border backdrop-blur-md transition-all cursor-pointer ${
                sensors
                  ? "border-[#00f0ff] bg-[#00f0ff]/20 text-white shadow-[0_0_10px_rgba(0,240,255,0.35)]"
                  : "border-line bg-panel/80 text-muted hover:text-ink"
              }`}
            >
              Sonar/EIF ({sensors ? "ON" : "OFF"})
            </button>
            <button
              onClick={() => { playSound("click"); setHeatmap((v) => !v); }}
              className={`px-2.5 py-1.5 rounded-xl text-[11px] font-mono border backdrop-blur-md transition-all cursor-pointer ${
                heatmap
                  ? "border-[#ff4a2b] bg-[#ff4a2b]/20 text-white shadow-[0_0_10px_rgba(255,74,43,0.35)]"
                  : "border-line bg-panel/80 text-muted hover:text-ink"
              }`}
            >
              Heatmap ({heatmap ? "ON" : "OFF"})
            </button>
          </div>
        </div>
      </div>

      {/* Control Station & Telemetry Column */}
      <div className="flex flex-col gap-4">
        {/* Simulation Configuration Card */}
        <div className="panel space-y-4 p-5">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <span className="font-display font-extrabold text-[15px] tracking-tight text-ink">
              MISSION CONTROLS
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-panel2 border border-line text-telemetry">
              EPISODE SETUP
            </span>
          </div>

          {/* Seed Input with Randomize */}
          <div className="flex items-center justify-between gap-3 text-[12px]">
            <span className="text-muted font-medium">Procedural Map Seed</span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={seed}
                min={0}
                onChange={(e) => setSeed(Math.max(0, parseInt(e.target.value || "0", 10)))}
                className="data w-20 bg-panel2 border border-line rounded-lg px-2.5 py-1 text-ink text-right font-mono"
              />
              <button
                onClick={handleRandomSeed}
                title="Generate random seed"
                className="h-8 w-8 rounded-lg border border-line bg-panel2 text-faint hover:text-ink flex items-center justify-center transition-colors cursor-pointer"
              >
                🎲
              </button>
            </div>
          </div>

          {/* Controller Selector */}
          <div className="space-y-2">
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted">
              Select Navigation Agent
            </div>
            <div className="space-y-2">
              {CONTROLLERS.map((c) => {
                const active = controller === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => { playSound("click"); setController(c.id); }}
                    className={`w-full text-left rounded-xl p-3 border transition-all duration-150 cursor-pointer ${
                      active
                        ? "border-telemetry bg-telemetry/15 shadow-[0_0_16px_rgba(240,85,155,0.25)]"
                        : "border-line bg-panel2/50 hover:bg-panel2 hover:border-line/90"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-display font-bold text-ink">
                        {c.label}
                      </span>
                      <span
                        className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold uppercase ${
                          active
                            ? "bg-telemetry text-base"
                            : "bg-panel text-faint border border-line"
                        }`}
                      >
                        {c.tag}
                      </span>
                    </div>
                    <div className="text-[11px] text-faint mt-1 leading-snug">
                      {c.desc}
                    </div>
                    <div className="text-[10px] font-mono text-muted mt-1.5 flex items-center gap-1.5">
                      <span className="h-1 w-1 rounded-full bg-telemetry" />
                      <span>{c.sensor}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Speed Multipliers */}
          <div className="pt-2 border-t border-line space-y-2">
            <div className="flex items-center justify-between text-[11px] font-mono uppercase text-muted">
              <span>Physics Stepping Rate</span>
              <span className="text-telemetry font-bold">{speed}× REALTIME</span>
            </div>
            <div className="flex items-center gap-1.5 bg-panel2 p-1 rounded-xl border border-line">
              {SPEEDS.map((v) => (
                <button
                  key={v}
                  onClick={() => changeSpeed(v)}
                  className={`flex-1 py-1.5 text-[12px] font-mono rounded-lg transition-all cursor-pointer ${
                    speed === v
                      ? "bg-telemetry text-base font-bold shadow-[0_0_8px_rgba(240,85,155,0.4)]"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {v}×
                </button>
              ))}
            </div>
          </div>

          {/* Log this run toggle */}
          <div className="pt-2 border-t border-line">
            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={logRun}
                disabled={phase === "running"}
                onChange={(e) => { playSound("click"); setLogRun(e.target.checked); }}
                className="h-4 w-4 rounded accent-telemetry cursor-pointer"
              />
              <div className="flex flex-col min-w-0">
                <span className="text-[12px] font-medium text-ink group-hover:text-telemetry transition-colors">
                  Log Sortie to Database
                </span>
                <span className="text-[10px] text-faint">
                  Stores 36-beam scan, sensors and pose into Postgres run history
                </span>
              </div>
            </label>
          </div>

          {warn && (
            <div className="text-[11px] font-mono text-warn bg-warn/10 p-2.5 rounded-lg border border-warn/30">
              {warn}
            </div>
          )}

          {sessionId && (
            <div className="text-[10px] font-mono text-faint data break-all bg-panel2 px-2.5 py-1.5 rounded-lg border border-line">
              LOGGING SESSION: {sessionId}
            </div>
          )}

          {/* Primary Action Buttons */}
          <div className="pt-2 flex gap-2.5">
            <button
              onClick={start}
              disabled={unavailable || busy}
              className="flex-1 h-12 rounded-xl bg-gradient-to-r from-telemetry to-[#c4286f] text-white font-display font-black text-[14px] tracking-wider uppercase disabled:opacity-40 hover:brightness-110 active:scale-95 transition shadow-[0_0_20px_rgba(240,85,155,0.4)] cursor-pointer"
            >
              {busy ? "GENERATING WORLD..." : phase === "idle" ? "START SIMULATION" : "RESTART EPISODE"}
            </button>
            {phase === "running" && (
              <button
                onClick={togglePause}
                className="px-4 h-12 rounded-xl border border-line bg-panel2 hover:bg-panel2/80 font-mono text-[12px] text-ink font-bold transition-all cursor-pointer"
              >
                {paused ? "RESUME" : "PAUSE"}
              </button>
            )}
          </div>
        </div>

        {/* Live Episode Telemetry HUD Card */}
        <div className="panel p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <span className="font-display font-extrabold text-[15px] tracking-tight text-ink">
              EPISODE TELEMETRY
            </span>
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold border ${stateStyle.cls}`}>
              {stateStyle.label}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Simulation Time */}
            <div className="p-3 rounded-xl bg-panel2/60 border border-line space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-faint">Sim Time</div>
              <div className="data text-[22px] font-bold text-ink">
                {hud ? hud.t.toFixed(1) : "0.0"}<span className="text-[11px] font-mono text-faint ml-1">s</span>
              </div>
            </div>

            {/* Fire Intensity */}
            <div className="p-3 rounded-xl bg-panel2/60 border border-line space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-faint">Flame Intensity</div>
              <div className={`data text-[22px] font-bold ${hud && hud.fire_p > 0 ? "text-alarm" : "text-ok"}`}>
                {hud ? Math.round(hud.fire_p * 100) : "100"}<span className="text-[11px] font-mono text-faint ml-1">%</span>
              </div>
            </div>

            {/* Water Tank */}
            <div className="p-3 rounded-xl bg-panel2/60 border border-line space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-faint">Water Tank</div>
              <div className="data text-[22px] font-bold text-telemetry">
                {hud ? Math.round(hud.tank * 100) : "100"}<span className="text-[11px] font-mono text-faint ml-1">%</span>
              </div>
            </div>

            {/* Collisions */}
            <div className="p-3 rounded-xl bg-panel2/60 border border-line space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-faint">Impacts</div>
              <div className={`data text-[22px] font-bold ${hud?.collisions ? "text-warn" : "text-ink"}`}>
                {hud?.collisions ?? 0}
              </div>
            </div>
          </div>

          {/* Pump Status Strip */}
          <div className="p-3 rounded-xl bg-panel2/40 border border-line flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase text-muted">Water Cannon</span>
            <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded ${
              hud?.pump
                ? "bg-telemetry text-base animate-pulse"
                : "bg-panel text-faint border border-line"
            }`}>
              {hud?.pump ? "DISPENSING JET" : "STANDBY"}
            </span>
          </div>
        </div>

        {/* Environmental & Bayesian Sensor Diagnostics Card */}
        <div className="panel p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-line pb-2.5">
            <span className="font-display font-bold text-[14px] tracking-tight text-ink flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#00f0ff] animate-ping" />
              ENVIRONMENTAL DIAGNOSTICS
            </span>
            <span className="text-[10px] font-mono text-faint">
              EIF FUSION
            </span>
          </div>

          {/* Sector Location */}
          <div className="p-3 rounded-xl bg-panel2/60 border border-line space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-wider text-faint">Rover Sector Location</div>
            <div className="text-[13px] font-display font-extrabold text-ink flex items-center gap-2">
              <span className="text-telemetry">◈</span>
              <span>{roomTitle}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {/* Gas Sensor */}
            <div className="p-2.5 rounded-xl bg-panel2/60 border border-line space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-faint">Gas Sensor</span>
                <span className={`text-[9px] font-mono px-1 py-0.2 rounded font-bold border ${gasCls}`}>
                  {gasLevel}
                </span>
              </div>
              <div className="data text-[18px] font-bold text-ink">
                {(gasVal * 100).toFixed(1)}<span className="text-[10px] font-mono text-faint ml-1">%</span>
              </div>
            </div>

            {/* Thermal Peak */}
            <div className="p-2.5 rounded-xl bg-panel2/60 border border-line space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-faint">Peak Heat</span>
                <span className="text-[9px] font-mono text-faint">THERMAL</span>
              </div>
              <div className={`data text-[18px] font-bold ${hud?.peak > 0.4 ? "text-warn" : "text-ink"}`}>
                {((hud?.peak ?? 0) * 100).toFixed(0)}<span className="text-[10px] font-mono text-faint ml-1">%</span>
              </div>
            </div>
          </div>

          {/* Bayesian EIF Belief Target */}
          <div className="p-2.5 rounded-xl bg-panel2/40 border border-line text-[11px] font-mono text-faint flex items-center justify-between">
            <span>EIF Target Belief:</span>
            <span className="text-ink font-bold">
              {hud?.est
                ? `(${hud.est.x.toFixed(1)}, ${hud.est.y.toFixed(1)}) ±${hud.est.sigma.toFixed(1)}m`
                : "Acquiring..."}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
