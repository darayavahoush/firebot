import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SimCanvas from "../components/SimCanvas.jsx";
import ThermalFrame from "../components/ThermalFrame.jsx";
import { PanelHeader } from "../components/TelemetryGauges.jsx";
import { SimController } from "../lib/simController.js";
import { US_ANGLES, FLAME_ANGLES } from "../lib/simEngine.js";

const SPEEDS = [0.5, 1, 2, 4];

export default function Simulator() {
  const engineRef = useRef(null);
  if (!engineRef.current) engineRef.current = new SimController();

  const [, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showTree, setShowTree] = useState(true);
  const [showSensors, setShowSensors] = useState(true);
  const [tab, setTab] = useState("telemetry");
  const [textCmd, setTextCmd] = useState("");
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recogRef = useRef(null);
  const rafRef = useRef(null);
  const lastRef = useRef(performance.now());
  const renderThrottleRef = useRef(0);

  // simulation loop: physics steps every frame at `speed`x, React state refreshed a few times/sec
  useEffect(() => {
    function loop(now) {
      rafRef.current = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - lastRef.current) / 1000);
      lastRef.current = now;
      if (!paused) engineRef.current.step(dt * speed);
      renderThrottleRef.current += dt;
      if (renderThrottleRef.current > 0.12) { renderThrottleRef.current = 0; setTick((t) => t + 1); }
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [paused, speed]);

  const newBuilding = useCallback(() => {
    engineRef.current.newBuilding();
    setTick((t) => t + 1);
  }, []);

  const sendCommand = useCallback((text) => {
    if (!text.trim()) return;
    engineRef.current.say(text);
    setTick((t) => t + 1);
  }, []);

  // Web Speech API -- Chrome/Edge only; Safari partial; Firefox unsupported, hence the text fallback
  const speechSupported = useMemo(
    () => typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition),
    []
  );
  const toggleListening = useCallback(() => {
    if (!speechSupported) return;
    if (listening) { const r = recogRef.current; recogRef.current = null; r?.stop(); setListening(false); return; }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new Recognition();
    r.continuous = true; r.interimResults = true; r.lang = "en-US";
    r.onresult = (e) => {
      let interim = "", final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t; else interim += t;
      }
      if (final) { sendCommand(final); setTranscript(""); } else setTranscript(interim);
    };
    r.onerror = () => setListening(false);
    r.onend = () => { if (recogRef.current === r) r.start(); }; // keep listening until the user toggles off
    recogRef.current = r;
    r.start();
    setListening(true);
  }, [listening, speechSupported, sendCommand]);
  useEffect(() => () => { const r = recogRef.current; recogRef.current = null; r?.stop(); }, []);

  const t = engineRef.current.telemetry();
  const sigma = t.estimate?.sigma;

  return (
    <main className="flex-1 flex flex-col">
      <div className="border-b border-line bg-panel px-6 py-2.5 flex items-center gap-4 flex-wrap">
        <span className="font-display font-bold text-[13px] text-ink tracking-wide">SIMULATOR</span>
        <button onClick={newBuilding} className="rounded-lg border border-line px-3 py-1 text-[12px] font-mono text-ink hover:border-telemetry hover:text-telemetry transition-colors">
          New Building
        </button>
        <button onClick={() => setPaused((p) => !p)} className="rounded-lg border border-line px-3 py-1 text-[12px] font-mono text-ink hover:border-telemetry hover:text-telemetry transition-colors">
          {paused ? "Resume" : "Pause"}
        </button>
        <div className="flex items-center gap-1 font-mono text-[12px] text-muted">
          Speed
          {SPEEDS.map((s) => (
            <button key={s} onClick={() => setSpeed(s)} className={`rounded-lg px-2 py-1 border ${speed === s ? "border-telemetry text-telemetry" : "border-line text-muted hover:text-ink"}`}>
              {s}x
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 font-mono text-[12px] text-muted cursor-pointer">
          <input type="checkbox" checked={showTree} onChange={(e) => setShowTree(e.target.checked)} /> planner tree
        </label>
        <label className="flex items-center gap-1.5 font-mono text-[12px] text-muted cursor-pointer">
          <input type="checkbox" checked={showSensors} onChange={(e) => setShowSensors(e.target.checked)} /> camera FOV
        </label>
        <div className="ml-auto flex items-center gap-2 font-mono text-[12px]">
          <span className={`h-[7px] w-[7px] rounded-full ${t.mode === "STOPPED" ? "bg-alarm pulse-dot" : t.state === "SAFE" ? "bg-ok" : "bg-telemetry pulse-dot"}`} />
          <span className="text-muted">MODE</span>
          <span className="text-ink">{t.mode}</span>
          <span className="text-faint">/</span>
          <span className="text-ink">{t.state}</span>
        </div>
        <button
          onClick={() => sendCommand("stop")}
          className="bg-alarm text-[#1A0805] font-mono text-[12px] font-semibold tracking-wide px-4 py-1.5 rounded-full shadow-[0_0_14px_rgba(240,96,74,0.4)] hover:brightness-110 active:scale-95 transition"
        >
          STOP
        </button>
      </div>

      <div className="flex-1 grid grid-cols-[1fr_360px] gap-3 bg-base overflow-hidden p-3">
        <div className="panel flex flex-col relative">
          <div className="ember-glow w-40 h-40 -top-10 -right-10" />
          <SimCanvas engineRef={engineRef} showTree={showTree} showSensors={showSensors} height={620} />
          <div className="border-t border-line bg-panel px-4 py-2 flex items-center gap-4 text-[11px] font-mono text-muted flex-wrap relative">
            <Legend swatch="#3FA7D6" label="robot" />
            <Legend swatch="#E14A3A" label="fire (ground truth)" />
            <Legend swatch="#D69A3C" label="fire estimate + \u03c3" />
            <Legend swatch="#4CAF6D" label="planned path" />
            <Legend swatch="rgba(63,167,214,0.6)" label="RRT* search tree" />
            <span className="ml-auto text-faint">{t.world.width.toFixed(1)}m \u00d7 {t.world.height.toFixed(1)}m building, seed {engineRef.current.seed}</span>
          </div>
        </div>

        <div className="panel flex flex-col overflow-hidden">
          <div className="flex bg-panel2">
            {["telemetry", "sensors", "planner", "voice"].map((k) => (
              <button key={k} onClick={() => setTab(k)} className={`flex-1 px-2 py-2.5 text-[11px] font-mono tracking-wide uppercase transition-colors ${tab === k ? "bg-panel text-telemetry" : "text-muted hover:text-ink"}`}>
                {k}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {tab === "telemetry" && <TelemetryTab t={t} sigma={sigma} />}
            {tab === "sensors" && <SensorsTab t={t} />}
            {tab === "planner" && <PlannerTab t={t} />}
            {tab === "voice" && (
              <VoiceTab
                t={t}
                speechSupported={speechSupported}
                listening={listening}
                toggleListening={toggleListening}
                transcript={transcript}
                textCmd={textCmd}
                setTextCmd={setTextCmd}
                sendCommand={sendCommand}
              />
            )}
          </div>
          <EventLog events={t.events} />
        </div>
      </div>
    </main>
  );
}

function Legend({ swatch, label }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: swatch }} />
      {label}
    </span>
  );
}

function Metric({ label, value, unit, alarm, ok }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] text-muted mb-1.5">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className={`data text-[20px] leading-none ${alarm ? "text-warn" : ok ? "text-ok" : "text-ink"}`}>{value}</span>
        {unit && <span className="text-[11px] text-faint">{unit}</span>}
      </div>
    </div>
  );
}

function TelemetryTab({ t, sigma }) {
  return (
    <div>
      <PanelHeader label="Mission" />
      <div className="grid grid-cols-2 divide-x divide-line border-t border-line">
        <Metric label="Sim Time" value={t.t.toFixed(0)} unit="s" />
        <Metric label="Distance" value={t.distanceTravelled.toFixed(1)} unit="m" />
      </div>
      <div className="grid grid-cols-2 divide-x divide-line border-t border-line">
        <Metric label="Tank" value={(t.tank * 100).toFixed(0)} unit="%" alarm={t.tank < 0.2} />
        <Metric label="Battery" value={(t.battery * 100).toFixed(0)} unit="%" alarm={t.battery < 0.2} />
      </div>
      <div className="grid grid-cols-2 divide-x divide-line border-t border-line">
        <Metric label="Water Used" value={t.waterUsed.toFixed(2)} unit="L-eq" />
        <Metric label="Collisions" value={t.collisions} alarm={t.collisions > 0} />
      </div>
      <PanelHeader label="Fire-Source Estimate (EIF)" />
      <div className="border-t border-line px-4 py-3 space-y-1.5">
        <Row k="Ground truth (x, y)" v={`${t.fire.x.toFixed(2)}, ${t.fire.y.toFixed(2)}`} />
        <Row k="Estimate (x, y)" v={t.estimate ? `${t.estimate.x.toFixed(2)}, ${t.estimate.y.toFixed(2)}` : "unlocalised"} />
        <Row k="1\u03c3 uncertainty" v={sigma != null ? `${sigma.toFixed(2)} m` : "\u2014"} ok={sigma != null && sigma < 0.5} />
        <Row k="Intensity remaining" v={`${(t.fire.p * 100).toFixed(0)}%`} alarm={t.fire.p > 0} ok={t.fire.p === 0} />
      </div>
      <PanelHeader label="Robot Pose" />
      <div className="border-t border-line px-4 py-3 space-y-1.5">
        <Row k="Position" v={`${t.robot.x.toFixed(2)}, ${t.robot.y.toFixed(2)}`} />
        <Row k="Heading" v={`${((t.robot.th * 180) / Math.PI).toFixed(0)}\u00b0`} />
      </div>
    </div>
  );
}

function Row({ k, v, alarm, ok }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-muted">{k}</span>
      <span className={`data ${alarm ? "text-warn" : ok ? "text-ok" : "text-ink"}`}>{v}</span>
    </div>
  );
}

function SensorsTab({ t }) {
  const s = t.sense;
  if (!s) return <div className="px-4 py-6 text-[12px] text-faint font-mono">no sensor frame yet</div>;
  return (
    <div>
      <PanelHeader label="Ultrasonic Ring" right={<span className="text-[10px] text-faint">HC-SR04 x4</span>} />
      <div className="grid grid-cols-2 gap-px bg-line border-t border-b border-line">
        {Object.keys(US_ANGLES).map((k) => (
          <Bar key={k} label={k.replace("us_", "")} value={s[k]} max={4} unit="m" invert />
        ))}
      </div>
      <PanelHeader label="Flame Triad" right={<span className="text-[10px] text-faint">IR flame x3</span>} />
      <div className="grid grid-cols-3 gap-px bg-line border-t border-b border-line">
        {Object.keys(FLAME_ANGLES).map((k) => (
          <Bar key={k} label={k.replace("flame_", "")} value={s[k]} max={1} unit="" alarm={s[k] > 0.5} />
        ))}
      </div>
      <PanelHeader label="Gas (MQ-2)" />
      <div className="grid grid-cols-2 gap-px bg-line border-t border-b border-line">
        <Bar label="front" value={s.mq2_front} max={1} alarm={s.mq2_front > 0.5} />
        <Bar label="rear" value={s.mq2_rear} max={1} alarm={s.mq2_rear > 0.5} />
      </div>
      <PanelHeader label="Thermal Camera" right={<span className="text-[10px] text-faint">MLX90640, 24\u00d732</span>} />
      <div className="border-t border-line px-4 py-3 flex gap-4 items-start">
        <ThermalFrame frame={s.thermal} />
        <div className="space-y-1.5 flex-1">
          <Row k="Peak temp" v={`${s.peakTemp.toFixed(1)} \u00b0C`} alarm={s.peakTemp > 45} />
          <Row k="In frame" v={s.seen ? "yes" : "no"} ok={s.seen} />
          <Row k="Bearing" v={`${((s.bearing * 180) / Math.PI).toFixed(0)}\u00b0`} />
        </div>
      </div>
    </div>
  );
}

function Bar({ label, value, max, unit, invert, alarm }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const barPct = invert ? 100 - pct : pct;
  return (
    <div className="bg-panel px-3 py-2.5">
      <div className="text-[10px] text-faint mb-1">{label}</div>
      <div className="data text-[14px] text-ink mb-1.5">{value.toFixed(2)}{unit}</div>
      <div className="h-[3px] bg-line w-full">
        <div className={`h-full ${alarm ? "bg-warn" : "bg-telemetry"}`} style={{ width: `${barPct}%` }} />
      </div>
    </div>
  );
}

function PlannerTab({ t }) {
  return (
    <div>
      <PanelHeader label="Motion Planner" />
      <div className="border-t border-line px-4 py-3 space-y-1.5">
        <Row k="Algorithm" v="Informed RRT*" />
        <Row k="Server-side equivalent" v="OMPL InformedRRTstar" />
        <Row k="Active goal" v={t.goal ? `${t.goal[0].toFixed(1)}, ${t.goal[1].toFixed(1)} (${t.goalKind})` : "\u2014"} />
        <Row k="Waypoints" v={t.path ? t.path.length : "\u2014"} />
        <Row k="Path length" v={`${t.planStats.length.toFixed(2)} m`} />
      </div>
      <PanelHeader label="Solve Stats (this scenario)" />
      <div className="grid grid-cols-2 divide-x divide-line border-t border-line">
        <Metric label="Plans found" value={t.planStats.plans} />
        <Metric label="Plans failed" value={t.planStats.failures} alarm={t.planStats.failures > 0} />
      </div>
      <div className="border-t border-line px-4 py-3 text-[11px] text-faint leading-relaxed">
        OMPL is a C++/Python library with no browser build, so this in-page demo runs the same
        informed-RRT* search in plain JS \u2014 tree growth, rewiring, shortcutting. The Python
        backend's <code className="text-muted">firebot.planning.OMPLPlanner</code> runs the real
        OMPL bindings and is a drop-in swap for the numpy planner via <code className="text-muted">PlanningController(planner_cls=...)</code>.
      </div>
    </div>
  );
}

function VoiceTab({ t, speechSupported, listening, toggleListening, transcript, textCmd, setTextCmd, sendCommand }) {
  return (
    <div>
      <PanelHeader label="Voice Command" />
      <div className="border-t border-line px-4 py-4 flex flex-col items-center gap-3">
        <button
          onClick={toggleListening}
          disabled={!speechSupported}
          className={`w-16 h-16 rounded-full border flex items-center justify-center font-mono text-[11px] transition-all ${
            listening
              ? "border-alarm text-alarm pulse-dot shadow-[0_0_18px_rgba(240,96,74,0.35)]"
              : "border-telemetry text-telemetry hover:bg-telemetry hover:text-[#0A1A1C] hover:shadow-[0_0_18px_rgba(47,184,166,0.35)]"
          } ${!speechSupported ? "opacity-30 cursor-not-allowed" : ""}`}
        >
          {listening ? "LIVE" : "MIC"}
        </button>
        {!speechSupported && <div className="text-[11px] text-faint text-center">Speech recognition isn\u2019t supported in this browser \u2014 use the text field below.</div>}
        {transcript && <div className="text-[12px] text-muted font-mono italic">\u201c{transcript}\u2026\u201d</div>}
      </div>
      <div className="border-t border-line px-4 py-3 flex gap-2">
        <input
          value={textCmd}
          onChange={(e) => setTextCmd(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { sendCommand(textCmd); setTextCmd(""); } }}
          placeholder='"go to the north room", "stop", "status"'
          className="flex-1 rounded-lg bg-panel2 border border-line px-2.5 py-1.5 text-[12px] font-mono text-ink outline-none focus:border-telemetry"
        />
        <button
          onClick={() => { sendCommand(textCmd); setTextCmd(""); }}
          className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-mono text-ink hover:border-telemetry hover:text-telemetry"
        >
          Send
        </button>
      </div>
      <PanelHeader label="Recognized Commands" />
      <div className="border-t border-line divide-y divide-line max-h-72 overflow-y-auto">
        {t.commandLog.length === 0 && <div className="px-4 py-3 text-[12px] text-faint font-mono">no commands yet \u2014 try \u201cstop\u201d, \u201creturn home\u201d, \u201cgo to the east room\u201d, \u201cstatus\u201d</div>}
        {t.commandLog.map((c, i) => (
          <div key={i} className="px-4 py-2 flex items-center justify-between text-[12px]">
            <span className="text-ink font-mono truncate max-w-[180px]">{c.text}</span>
            <span className={`font-mono text-[11px] ${c.intent === "UNKNOWN" ? "text-faint" : "text-telemetry"}`}>{c.intent}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EventLog({ events }) {
  return (
    <div className="border-t border-line bg-panel max-h-40 overflow-y-auto">
      <PanelHeader label="Event Log" />
      <div className="border-t border-line divide-y divide-line">
        {events.map((e, i) => (
          <div key={i} className="px-4 py-1.5 flex items-start gap-2 text-[11px]">
            <span className="data text-faint w-12 shrink-0">{e.t.toFixed(0)}s</span>
            <span className={`shrink-0 ${e.kind === "command" ? "text-telemetry" : e.kind === "status" ? "text-muted" : "text-ink"}`}>{e.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
