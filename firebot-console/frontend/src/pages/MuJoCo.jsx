import React, { useCallback, useEffect, useRef, useState } from "react";
import MujocoScene from "../components/mujoco/MujocoScene.js";
import { playSound } from "../lib/sound.js";
import { PageHeader, Button, Badge, Panel } from "../components/ui";

const CONTROLLERS = [
  {
    id: "mm_fusion",
    label: "Multimodal DRL Fusion",
    tag: "Deep RL",
    desc: "Deep actor-critic policy fusing 36-beam Lidar, thermal camera, 4x ultrasonic sonar, and gas sensors with Bayesian EIF estimation.",
    sensor: "Lidar + Therm + Sonar + Gas (EIF)",
  },
  {
    id: "frontier",
    label: "Frontier Exploration",
    tag: "Recommended",
    desc: "Autonomous occupancy grid mapping & frontier point routing with pure-pursuit path execution.",
    sensor: "36-beam Lidar + SLAM",
  },
  {
    id: "scan",
    label: "Lidar Scan Avoidance",
    tag: "Reactive",
    desc: "360° obstacle clearance scanning with wandering open-corridor search and flame-tracking takeover.",
    sensor: "36-beam Lidar",
  },
  {
    id: "rule",
    label: "Rule-Based Baseline",
    tag: "Ultrasonic",
    desc: "Direct observation reactive policy without lidar, relying strictly on 4 ultrasonic range beams.",
    sensor: "4x Ultrasonic",
  },
];

const SPEEDS = [0.5, 1, 2, 4, 8];

const STATE_CONFIG = {
  EXPLORE: { label: "Exploring terrain", cls: "text-telemetry bg-telemetry/10 border-telemetry/30" },
  TRACK: { label: "Tracking thermal flame", cls: "text-warn bg-warn/10 border-warn/30 animate-pulse" },
  SPRAY: { label: "Fire suppression active", cls: "text-telemetry bg-telemetry/15 border-telemetry/40 animate-pulse" },
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
  const [showHeader, setShowHeader] = useState(true);

  useEffect(() => {
    fetch("/api/mujoco/status")
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text();
          throw new Error(`HTTP ${r.status}: ${text || r.statusText}`);
        }
        return r.json();
      })
      .then(setStatus)
      .catch((err) =>
        setStatus({
          available: false,
          detail: `Backend error: ${err.message || "Check that the API server is running."}`,
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
      try {
        const m = JSON.parse(e.data);
        if (m.type === "scene") {
          sceneRef.current?.load(m);
          setSessionId(m.session_id || null);
          setPhase("running");
        } else if (m.type === "warn" || m.type === "status") {
          setWarn(m.message);
        } else if (m.type === "ping") {
          // Keepalive ping from server, no-op
        } else if (m.type === "frame") {
          sceneRef.current?.frame(m);
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
      } catch (err) {
        console.error("Error processing websocket message:", err);
        setError("Error rendering simulation: " + err.message);
        setPhase("error");
      }
    };
    ws.onerror = () => {
      setError("WebSocket connection failed. Ensure the MuJoCo backend server is running.");
      setPhase("error");
    };
    ws.onclose = (e) => {
      setPhase((prev) => {
        if (prev === "loading" || prev === "running") {
          const detail = e.reason ? `: ${e.reason}` : ` (${e.code === 1000 ? "stream ended early" : `code ${e.code}`})`;
          setError(`Simulation disconnected${detail}.`);
          return "error";
        }
        return prev;
      });
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
    <div className="flex-1 min-w-0 p-4 sm:p-6 space-y-6">
      {showHeader && (
        <PageHeader
          eyebrow="Rigid-body dynamics"
          title="3D Physics simulator"
          description="High-fidelity MuJoCo physics engine simulating 36-beam Lidar, thermal radiative transfer, ultrasonic sonars, and water suppression."
          illustration="mujoco-3d"
          actions={
            <Button onClick={() => setShowHeader(false)} className="text-[12px] !py-1 !px-2.5">
              Dismiss header
            </Button>
          }
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
        {/* 3D Viewport Station */}
        <Panel
          title="MuJoCo 3D rigid-body physics"
          state={phase === "running" ? (hud?.fire_p > 0 ? "hot" : "live") : undefined}
          className="flex flex-col min-h-[560px] h-[calc(100vh-160px)] relative overflow-hidden"
          actions={
            <div className="flex items-center gap-1 bg-panel2 p-0.5 rounded-lg border border-line">
              {[
                { id: "orbit", label: "Orbit 3D" },
                { id: "top", label: "Top-down" },
                { id: "follow", label: "Chase cam" },
                { id: "fpv", label: "FPV mast" },
                { id: "turret", label: "Turret cam" },
              ].map((c) => (
                <button
                  key={c.id}
                  onClick={() => { playSound("click"); setCamMode(c.id); }}
                  className={`px-2 py-1 text-[11px] rounded transition-colors ${
                    camMode === c.id
                      ? "bg-telemetry text-onaccent font-medium"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          }
        >
          {/* 3D Canvas Host Container */}
          <div className="relative flex-1 min-h-[480px] bg-scope">
            <div ref={hostRef} className="absolute inset-0 w-full h-full" />

            {/* Idle Prompt */}
            {phase === "idle" && !unavailable && (
              <div className="absolute inset-0 flex flex-col items-start justify-center text-muted gap-2 bg-base/60 backdrop-blur-sm p-8 pointer-events-none">
                <div className="h-10 w-10 rounded-lg bg-panel border border-line flex items-center justify-center text-telemetry">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </div>
                <p className="text-[13px] text-ink font-medium">
                  Configure parameters and press <b className="text-telemetry font-semibold">Start simulation</b>
                </p>
                <p className="text-[12px] text-muted">
                  Use mouse/trackpad to orbit, right-click to pan, scroll to zoom.
                </p>
              </div>
            )}

            {/* Unavailable / Error Message */}
            {(unavailable || phase === "error") && (
              <div className="absolute inset-x-6 top-6 rounded-lg border border-warn/40 bg-panel p-4 text-[13px] text-warn flex items-start gap-3">
                <span className="text-[18px] leading-none">⚠</span>
                <div className="space-y-1">
                  <div className="font-semibold text-[11px] uppercase tracking-wide">
                    Simulation backend offline
                  </div>
                  <div className="text-ink">
                    {phase === "error" ? error : status.detail}
                  </div>
                </div>
              </div>
            )}

            {/* Episode Complete Banner */}
            {phase === "done" && result && (
              <div className="absolute top-4 left-6 rounded-lg border px-4 py-2 flex items-center gap-3 bg-panel border-line animate-fadeIn">
                <span className={`text-[16px] leading-none ${result.success ? "text-ok" : "text-alarm"}`}>
                  {result.success ? "✓" : "⚠"}
                </span>
                <div>
                  <div className={`text-[13px] font-semibold ${result.success ? "text-ok" : "text-alarm"}`}>
                    {result.success ? `Fire extinguished in ${result.t.toFixed(1)}s` : `Timed out (${result.t.toFixed(0)}s)`}
                  </div>
                  <div className="text-[11px] text-muted">
                    {result.collisions} collisions recorded • Water pump completed
                  </div>
                </div>
              </div>
            )}

            {/* Bottom Left Tactical Sensor & Layer Toggles */}
            <div className="absolute bottom-3 left-3 flex flex-wrap gap-1.5 z-10">
              <button
                onClick={() => { playSound("click"); setLidar((v) => !v); }}
                className={`px-2.5 py-1 rounded text-[11px] border backdrop-blur-md transition-colors ${
                  lidar
                    ? "border-telemetry/50 bg-telemetry/15 text-telemetry font-medium"
                    : "border-line bg-panel/80 text-muted hover:text-ink"
                }`}
              >
                Lidar ({lidar ? "on" : "off"})
              </button>
              <button
                onClick={() => { playSound("click"); setPathOn((v) => !v); }}
                className={`px-2.5 py-1 rounded text-[11px] border backdrop-blur-md transition-colors ${
                  pathOn
                    ? "border-ok/50 bg-ok/15 text-ok font-medium"
                    : "border-line bg-panel/80 text-muted hover:text-ink"
                }`}
              >
                Path ({pathOn ? "on" : "off"})
              </button>
              <button
                onClick={() => { playSound("click"); setParticles((v) => !v); }}
                className={`px-2.5 py-1 rounded text-[11px] border backdrop-blur-md transition-colors ${
                  particles
                    ? "border-warn/50 bg-warn/15 text-warn font-medium"
                    : "border-line bg-panel/80 text-muted hover:text-ink"
                }`}
              >
                Particles ({particles ? "on" : "off"})
              </button>
              <button
                onClick={() => { playSound("click"); setSensors((v) => !v); }}
                className={`px-2.5 py-1 rounded text-[11px] border backdrop-blur-md transition-colors ${
                  sensors
                    ? "border-telemetry/50 bg-telemetry/15 text-telemetry font-medium"
                    : "border-line bg-panel/80 text-muted hover:text-ink"
                }`}
              >
                Sonar / EIF ({sensors ? "on" : "off"})
              </button>
              <button
                onClick={() => { playSound("click"); setHeatmap((v) => !v); }}
                className={`px-2.5 py-1 rounded text-[11px] border backdrop-blur-md transition-colors ${
                  heatmap
                    ? "border-flame/50 bg-flame/15 text-flame font-medium"
                    : "border-line bg-panel/80 text-muted hover:text-ink"
                }`}
              >
                Heatmap ({heatmap ? "on" : "off"})
              </button>
            </div>
          </div>
        </Panel>

      {/* Control Station & Telemetry Column */}
      <div className="flex flex-col gap-4">
        {/* Simulation Configuration Card */}
        <Panel
          title="Mission controls"
          eyebrow="Episode setup"
          bodyClassName="p-5 space-y-4"
        >
          {/* Seed Input with Randomize */}
          <div className="flex items-center justify-between gap-3 text-[12px]">
            <span className="text-muted font-medium">Procedural map seed</span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={seed}
                min={0}
                onChange={(e) => setSeed(Math.max(0, parseInt(e.target.value || "0", 10)))}
                className="data w-20 bg-panel2 border border-line rounded px-2.5 py-1 text-ink text-right"
              />
              <button
                onClick={handleRandomSeed}
                title="Generate random seed"
                className="h-8 w-8 rounded border border-line bg-panel2 text-faint hover:text-ink flex items-center justify-center transition-colors cursor-pointer"
              >
                🎲
              </button>
            </div>
          </div>

          {/* Controller Selector */}
          <div className="space-y-2">
            <div className="panel-eyebrow text-faint">
              Navigation agent
            </div>
            <div className="space-y-2">
              {CONTROLLERS.map((c) => {
                const active = controller === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => { playSound("click"); setController(c.id); }}
                    className={`w-full text-left rounded p-3 border transition-colors cursor-pointer ${
                      active
                        ? "border-telemetry/50 bg-telemetry/10"
                        : "border-line bg-panel2/50 hover:bg-panel2"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-ink">
                        {c.label}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          active
                            ? "bg-telemetry/15 text-telemetry border border-telemetry/30"
                            : "bg-panel text-faint border border-line"
                        }`}
                      >
                        {c.tag}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted mt-1 leading-snug">
                      {c.desc}
                    </div>
                    <div className="text-[11px] text-faint mt-1.5 flex items-center gap-1.5">
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
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span>Physics stepping rate</span>
              <span className="text-telemetry font-semibold data">{speed}× realtime</span>
            </div>
            <div className="flex items-center gap-1 bg-panel2 p-0.5 rounded border border-line">
              {SPEEDS.map((v) => (
                <button
                  key={v}
                  onClick={() => changeSpeed(v)}
                  className={`flex-1 py-1 text-[11px] data rounded transition-colors ${
                    speed === v
                      ? "bg-panel text-ink font-semibold border border-line"
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
                  Log sortie to database
                </span>
                <span className="text-[11px] text-faint">
                  Stores 36-beam scan, sensors and pose into Postgres run history
                </span>
              </div>
            </label>
          </div>

          {warn && (
            <div className="text-[11px] text-warn bg-warn/10 p-2.5 rounded border border-warn/30">
              {warn}
            </div>
          )}

          {sessionId && (
            <div className="text-[10px] text-faint data break-all bg-panel2 px-2.5 py-1.5 rounded border border-line">
              Logging session: {sessionId}
            </div>
          )}

          {/* Primary Action Buttons */}
          <div className="pt-2 flex gap-2">
            <Button
              variant="primary"
              onClick={start}
              disabled={unavailable || busy}
              className="flex-1 !h-10 text-[13px]"
            >
              {busy ? "Generating world…" : phase === "idle" ? "Start simulation" : "Restart episode"}
            </Button>
            {phase === "running" && (
              <Button
                onClick={togglePause}
                className="px-4 !h-10 text-[12px]"
              >
                {paused ? "Resume" : "Pause"}
              </Button>
            )}
          </div>
        </Panel>

        {/* Live Episode Telemetry HUD Card */}
        <Panel
          title="Episode telemetry"
          state={phase === "running" ? (hud?.fire_p > 0 ? "hot" : "live") : undefined}
          bodyClassName="p-5 space-y-4"
          actions={
            <span className={`text-[10px] px-2 py-0.5 rounded font-medium border ${stateStyle.cls}`}>
              {stateStyle.label}
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            {/* Simulation Time */}
            <div className="p-3 rounded bg-panel2/60 border border-line space-y-1">
              <div className="panel-eyebrow text-faint">Sim time</div>
              <div className="readout text-[22px] text-ink">
                {hud ? hud.t.toFixed(1) : "0.0"}<span className="text-[11px] text-faint ml-1 font-sans">s</span>
              </div>
            </div>

            {/* Fire Intensity */}
            <div className="p-3 rounded bg-panel2/60 border border-line space-y-1">
              <div className="panel-eyebrow text-faint">Flame intensity</div>
              <div className={`readout text-[22px] ${hud && hud.fire_p > 0 ? "text-alarm" : "text-ok"}`}>
                {hud ? Math.round(hud.fire_p * 100) : "100"}<span className="text-[11px] text-faint ml-1 font-sans">%</span>
              </div>
            </div>

            {/* Water Tank */}
            <div className="p-3 rounded bg-panel2/60 border border-line space-y-1">
              <div className="panel-eyebrow text-faint">Water tank</div>
              <div className="readout text-[22px] text-telemetry">
                {hud ? Math.round(hud.tank * 100) : "100"}<span className="text-[11px] text-faint ml-1 font-sans">%</span>
              </div>
            </div>

            {/* Collisions */}
            <div className="p-3 rounded bg-panel2/60 border border-line space-y-1">
              <div className="panel-eyebrow text-faint">Impacts</div>
              <div className={`readout text-[22px] ${hud?.collisions ? "text-warn" : "text-ink"}`}>
                {hud?.collisions ?? 0}
              </div>
            </div>
          </div>

          {/* Pump Status Strip */}
          <div className="p-3 rounded bg-panel2/40 border border-line flex items-center justify-between">
            <span className="text-[12px] text-muted">Water cannon</span>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${
              hud?.pump
                ? "bg-telemetry text-onaccent"
                : "bg-panel text-faint border border-line"
            }`}>
              {hud?.pump ? "Dispensing jet" : "Standby"}
            </span>
          </div>
        </Panel>

        {/* Environmental & Bayesian Sensor Diagnostics Card */}
        <Panel
          title="Environmental diagnostics"
          eyebrow="EIF fusion"
          state={hud?.peak > 0.4 ? "hot" : undefined}
          bodyClassName="p-5 space-y-3"
        >
          {/* Sector Location */}
          <div className="p-3 rounded bg-panel2/60 border border-line space-y-1">
            <div className="panel-eyebrow text-faint">Rover sector location</div>
            <div className="text-[13px] font-medium text-ink flex items-center gap-2">
              <span className="text-telemetry">◈</span>
              <span>{roomTitle}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {/* Gas Sensor */}
            <div className="p-2.5 rounded bg-panel2/60 border border-line space-y-1">
              <div className="flex items-center justify-between">
                <span className="panel-eyebrow text-faint">Gas sensor</span>
                <span className={`text-[10px] px-1 py-0.2 rounded font-medium border ${gasCls}`}>
                  {gasLevel}
                </span>
              </div>
              <div className="readout text-[18px] text-ink">
                {(gasVal * 100).toFixed(1)}<span className="text-[10px] text-faint ml-1 font-sans">%</span>
              </div>
            </div>

            {/* Thermal Peak */}
            <div className="p-2.5 rounded bg-panel2/60 border border-line space-y-1">
              <div className="flex items-center justify-between">
                <span className="panel-eyebrow text-faint">Peak heat</span>
                <span className="text-[10px] text-faint">Thermal</span>
              </div>
              <div className={`readout text-[18px] ${hud?.peak > 0.4 ? "text-warn" : "text-ink"}`}>
                {((hud?.peak ?? 0) * 100).toFixed(0)}<span className="text-[10px] text-faint ml-1 font-sans">%</span>
              </div>
            </div>
          </div>

          {/* Bayesian EIF Belief Target */}
          <div className="p-2.5 rounded bg-panel2/40 border border-line text-[12px] text-muted flex items-center justify-between">
            <span>EIF target belief:</span>
            <span className="data text-ink font-semibold">
              {hud?.est
                ? `(${hud.est.x.toFixed(1)}, ${hud.est.y.toFixed(1)}) ±${hud.est.sigma.toFixed(1)} m`
                : "Acquiring…"}
            </span>
          </div>
        </Panel>
      </div>
    </div>
  </div>
  );
}
