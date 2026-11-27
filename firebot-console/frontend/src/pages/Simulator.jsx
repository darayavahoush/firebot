import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SimCanvas from "../components/SimCanvas.jsx";
import Ring from "../components/Ring.jsx";
import SensorsTab from "../components/sim/SensorsTab.jsx";
import PlannerTab from "../components/sim/PlannerTab.jsx";
import VoiceTab from "../components/sim/VoiceTab.jsx";
import { COMMAND_HELP } from "../lib/commandHelp.js";
import { PanelHeader } from "../components/TelemetryGauges.jsx";
import { SimController } from "../lib/simController.js";
import { blobToWav16k } from "../lib/wav";
import { playSound } from "../lib/sound.js";
import CalibratePanel from "../components/sim/CalibratePanel.jsx";
import { getOperator } from "../lib/operator.js";
import { parseAndExecuteVoiceIntent } from "../api/client.js";
import { PageHeader, Button } from "../components/ui";

const SPEEDS = [0.5, 1, 2, 4];

const FATAL_VOICE_ERRORS = new Set(["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"]);
const VOICE_ERROR_MESSAGES = {
  "not-allowed": "Microphone access was denied — allow it in browser settings.",
  "service-not-allowed": "Microphone access was denied — allow it in browser settings.",
  "audio-capture": "No microphone found. Check your device and try again.",
  "language-not-supported": "This browser doesn't support the en-US recognition language.",
};

function detectBrokenWebSpeech() {
  if (typeof navigator === "undefined") return false;
  return /\bOPR\//.test(navigator.userAgent || "");
}

export default function Simulator() {
  const engineRef = useRef(null);
  if (!engineRef.current) engineRef.current = new SimController();

  const [, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showTree, setShowTree] = useState(true);
  const [showSensors, setShowSensors] = useState(true);
  const [showSlam, setShowSlam] = useState(true);
  const [tab, setTab] = useState("telemetry");
  const [textCmd, setTextCmd] = useState("");
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [ack, setAck] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [webSpeechBroken, setWebSpeechBroken] = useState(detectBrokenWebSpeech);
  const [asrStatus, setAsrStatus] = useState("idle");
  const [asrError, setAsrError] = useState("");
  const [voiceMode, setVoiceMode] = useState(null);
  const [speakerInfo, setSpeakerInfo] = useState(null);
  const [operator, setOperatorState] = useState(getOperator);
  const [personalModel, setPersonalModel] = useState(false);
  const [showCalibrate, setShowCalibrate] = useState(false);
  const [pendingClip, setPendingClip] = useState(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [recentTranscripts, setRecentTranscripts] = useState([]);
  const [showHeader, setShowHeader] = useState(true);

  const recognitionRef = useRef(null);
  const cmdInputRef = useRef(null);
  const lastIntentRef = useRef(null);
  const isListeningRef = useRef(false);
  const ackTimerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const micStreamRef = useRef(null);
  const rafRef = useRef(null);
  const lastSpokeAtRef = useRef(0);
  const hasSpokenRef = useRef(false);
  const isRecordingRef = useRef(false);

  useEffect(() => {
    fetch(`/api/voice/calibrate/status?user=${encodeURIComponent(operator)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.has_model) setPersonalModel(true);
        if (data?.mode) setVoiceMode(data.mode);
      })
      .catch(() => {});
  }, [operator]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (engineRef.current) {
        setTick((tick) => tick + 1);
      }
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const sendCommand = useCallback((text) => {
    const res = engineRef.current.issueVoiceCommand(text);
    if (!res) return;
    lastIntentRef.current = res.intent;
    if (ackTimerRef.current) clearTimeout(ackTimerRef.current);
    playSound(res.intent !== "UNKNOWN" ? "ack" : "estop");
    setAck({ text, intent: res.intent, understood: res.intent !== "UNKNOWN" });
    ackTimerRef.current = setTimeout(() => setAck(null), 3000);
  }, []);

  const newBuilding = () => {
    engineRef.current.regenerateBuilding();
    setTick((t) => t + 1);
  };

  const newFire = () => {
    engineRef.current.randomizeFire();
    setTick((t) => t + 1);
  };

  const t = engineRef.current.telemetry();
  const sigma = t.estimate?.sigma;

  return (
    <main className="flex-1 flex flex-col relative min-w-0">
      {/* Collapsible Page Header */}
      {showHeader && (
        <div className="p-4 sm:p-6 pb-0">
          <PageHeader
            eyebrow="Kinematic & sensor simulation"
            title="2D Simulator"
            description="Autonomous RRT* motion planning, bearing-only Extended Information Filter fire localization, and occupancy grid SLAM in an interactive browser engine."
            illustration="sim-world"
            actions={
              <Button onClick={() => setShowHeader(false)} className="text-[12px] !py-1 !px-2.5">
                Dismiss header
              </Button>
            }
          />
        </div>
      )}

      {ack && (
        <div
          role="status"
          className={`absolute top-3 left-1/2 -translate-x-1/2 z-30 rounded-xl border px-4 py-2 text-[13px] bg-panel shadow-md transition-opacity flex items-center gap-2 ${
            ack.understood ? "border-line2 text-ink" : "border-warn/50 text-warn"
          }`}
        >
          <span className={`font-semibold ${ack.understood ? "text-ok" : "text-warn"}`}>
            {ack.understood ? "✓" : "!"}
          </span>
          <span>{ack.understood ? "Command received: " : "Not understood: "}</span>
          <b className="font-semibold text-ink">"{ack.text}"</b>
          {ack.understood && <span className="text-faint"> → {ack.intent}</span>}
        </div>
      )}

      {/* Simulator Toolbar */}
      <div className="px-4 sm:px-6 py-2.5 flex items-center gap-2 flex-wrap bg-panel2/40 border-b border-line text-[12px]">
        <button
          type="button"
          onClick={() => { playSound("click"); newBuilding(); }}
          className="btn !py-1 !px-2.5 flex items-center gap-1.5"
          title="Generate new procedural building layout"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="2" width="16" height="20" rx="2" />
            <line x1="9" y1="22" x2="9" y2="12" />
            <line x1="15" y1="22" x2="15" y2="12" />
          </svg>
          <span>New building</span>
        </button>

        <button
          type="button"
          onClick={() => { playSound("click"); newFire(); }}
          className="btn !py-1 !px-2.5 flex items-center gap-1.5"
          title="Relocate fire source"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-flame">
            <path d="M12 2c.6 3.2 2.7 4.6 4.2 6.5C17.6 10.2 18 11.6 18 13a6 6 0 1 1-12 0c0-1.7.7-3 1.6-4 .3 1.2 1 2 2 2.3-.4-3 .2-6 2.4-9.3Z" />
          </svg>
          <span>Relocate fire</span>
        </button>

        <button
          type="button"
          onClick={() => { playSound("click"); setPaused((p) => !p); }}
          className="btn !py-1 !px-2.5"
        >
          {paused ? "▶ Resume" : "⏸ Pause"}
        </button>

        <div className="flex items-center gap-0.5 rounded-lg bg-panel p-0.5 border border-line" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { playSound("click"); setSpeed(s); }}
              className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors ${
                speed === s
                  ? "bg-telemetry text-onaccent font-medium"
                  : "text-muted hover:text-ink"
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 ml-auto sm:ml-1">
          <button
            type="button"
            className={`px-2.5 py-1 rounded-md text-[11.5px] border transition-colors ${
              showTree
                ? "border-telemetry/40 bg-telemetry/15 text-telemetry font-medium"
                : "border-line text-muted hover:text-ink"
            }`}
            onClick={() => { playSound("click"); setShowTree((v) => !v); }}
          >
            RRT* tree
          </button>
          <button
            type="button"
            className={`px-2.5 py-1 rounded-md text-[11.5px] border transition-colors ${
              showSensors
                ? "border-ok/40 bg-ok/15 text-ok font-medium"
                : "border-line text-muted hover:text-ink"
            }`}
            onClick={() => { playSound("click"); setShowSensors((v) => !v); }}
          >
            Camera cone
          </button>
          <button
            type="button"
            className={`px-2.5 py-1 rounded-md text-[11.5px] border transition-colors ${
              showSlam
                ? "border-warn/40 bg-warn/15 text-warn font-medium"
                : "border-line text-muted hover:text-ink"
            }`}
            onClick={() => { playSound("click"); setShowSlam((v) => !v); }}
          >
            SLAM / NBV
          </button>
        </div>

        {!showHeader && (
          <button
            type="button"
            onClick={() => setShowHeader(true)}
            className="text-[11.5px] text-muted hover:text-ink underline ml-auto"
          >
            Show info
          </button>
        )}
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 bg-base overflow-hidden px-4 sm:px-6 pb-6 pt-4 items-start">
        {/* Main Canvas Viewport Panel */}
        <div className="panel flex flex-col relative overflow-hidden">
          <div className="absolute top-3 left-3 z-10 flex flex-wrap gap-2 pointer-events-none">
            <span className="rounded-lg bg-panel/90 backdrop-blur-sm border border-line px-2.5 py-1 text-[11px] flex items-center gap-1.5 shadow-sm">
              <span className={`h-1.5 w-1.5 rounded-full ${t.mode === "STOPPED" ? "bg-alarm" : t.state === "SAFE" ? "bg-ok" : "bg-telemetry"}`} />
              <b className="text-ink font-semibold">{t.mode === "STOPPED" ? "STOPPED" : t.state}</b>
            </span>
            <span className="rounded-lg bg-panel/90 backdrop-blur-sm border border-line px-2.5 py-1 text-[11px] data shadow-sm">
              Tank <b className="text-telemetry font-semibold">{(t.tank * 100).toFixed(0)}%</b>
            </span>
            <span className="rounded-lg bg-panel/90 backdrop-blur-sm border border-line px-2.5 py-1 text-[11px] data shadow-sm">
              Fire <b className={t.fire.p > 0 ? "text-flame font-semibold" : "text-ok font-semibold"}>{t.fire.p > 0 ? `${(t.fire.p * 100).toFixed(0)}%` : "Suppressed"}</b>
            </span>
          </div>

          <SimCanvas engineRef={engineRef} showTree={showTree} showSensors={showSensors} showSlam={showSlam} height={600} />

          {/* Canvas Footer Legend */}
          <div className="border-t border-line bg-panel2/40 px-4 py-2.5 flex items-center gap-4 text-[11px] text-muted flex-wrap">
            <Legend swatch="rgb(var(--c-telemetry))" label="Robot" />
            <Legend swatch="rgb(var(--c-flame))" label="Fire (ground truth)" />
            <Legend swatch="rgb(var(--c-warn))" label="EIF estimate" />
            <Legend swatch="rgb(var(--c-ok))" label="Planned path" />
            <Legend swatch="rgba(14, 124, 123, 0.4)" label="RRT* tree" />
            <span className="ml-auto text-faint data">
              {t.world.width.toFixed(1)} m × {t.world.height.toFixed(1)} m • Seed {engineRef.current.seed}
            </span>
          </div>
        </div>

        {/* Right Telemetry / Inspector Tabs Panel */}
        <div className="panel flex flex-col overflow-hidden">
          <div className="flex bg-panel2/60 border-b border-line p-1 gap-1">
            {[
              { id: "telemetry", label: "Telemetry" },
              { id: "sensors", label: "Sensors" },
              { id: "planner", label: "Planner" },
              { id: "voice", label: "Voice" },
            ].map(({ id: k, label }) => (
              <button
                key={k}
                type="button"
                onClick={() => { playSound("tab"); setTab(k); }}
                className={`flex-1 py-1.5 text-[12px] font-medium rounded-md transition-colors ${
                  tab === k
                    ? "bg-panel text-ink shadow-sm font-semibold border border-line"
                    : "text-muted hover:text-ink border border-transparent"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto max-h-[640px]">
            {tab === "telemetry" && <TelemetryTab t={t} sigma={sigma} />}
            {tab === "sensors" && <SensorsTab t={t} />}
            {tab === "planner" && <PlannerTab t={t} />}
            {tab === "voice" && (
              <VoiceTab
                t={t}
                speechSupported={false}
                speechUsable={false}
                webSpeechBroken={webSpeechBroken}
                listening={listening}
                toggleListening={() => setListening(!listening)}
                transcript={transcript}
                voiceError={voiceError}
                textCmd={textCmd}
                setTextCmd={setTextCmd}
                sendCommand={sendCommand}
                cmdInputRef={cmdInputRef}
                suggestions={COMMAND_HELP.map((c) => c.intent)}
                showSuggestions={showSuggestions}
                setShowSuggestions={setShowSuggestions}
                fillCommand={(c) => { setTextCmd(c); sendCommand(c); }}
                asrStatus={asrStatus}
                asrError={asrError}
                toggleRecording={() => {}}
                voiceMode={voiceMode}
                speakerInfo={speakerInfo}
                operator={operator}
                personalModel={personalModel}
                onCalibrate={() => setShowCalibrate(true)}
                pendingClip={pendingClip}
                feedbackCommands={[]}
                onFeedbackOpen={() => setShowFeedback(true)}
                onFix={() => {}}
                onSent={() => {}}
                liveAccuracy={null}
              />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function Legend({ swatch, label }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: swatch }} />
      <span>{label}</span>
    </span>
  );
}

function Metric({ label, value, unit, alarm, ok }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] text-muted mb-1">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className={`data text-[20px] leading-none font-semibold ${alarm ? "text-warn" : ok ? "text-ok" : "text-ink"}`}>
          {value}
        </span>
        {unit && <span className="data text-[11px] text-faint">{unit}</span>}
      </div>
    </div>
  );
}

function TelemetryTab({ t, sigma }) {
  return (
    <div>
      <PanelHeader label="Mission metrics" />
      <div className="grid grid-cols-2 divide-x divide-line border-t border-line">
        <Metric label="Sim time" value={t.t.toFixed(0)} unit="s" />
        <Metric label="Distance travelled" value={t.distanceTravelled.toFixed(1)} unit="m" />
      </div>

      <div className="flex justify-around py-4 border-t border-line">
        <Ring label="Water tank" value={t.tank} low={t.tank < 0.2} />
        <Ring label="Battery" value={t.battery} low={t.battery < 0.2} />
        <Ring label="Suppression" value={1 - t.fire.p} good={t.fire.p === 0} />
      </div>

      <div className="grid grid-cols-2 divide-x divide-line border-t border-line">
        <Metric label="Water dispensed" value={t.waterUsed.toFixed(2)} unit="L" />
        <Metric label="Collisions" value={t.collisions} alarm={t.collisions > 0} />
      </div>

      <PanelHeader label="Fire-source estimate (EIF)" />
      <div className="border-t border-line px-4 py-3 space-y-1.5">
        <Row k="Ground truth (x, y)" v={`${t.fire.x.toFixed(2)}, ${t.fire.y.toFixed(2)}`} />
        <Row k="Estimate (x, y)" v={t.estimate ? `${t.estimate.x.toFixed(2)}, ${t.estimate.y.toFixed(2)}` : "Unlocalized"} />
        <Row k="1σ uncertainty" v={sigma != null ? `${sigma.toFixed(2)} m` : "—"} ok={sigma != null && sigma < 0.5} />
        <Row k="Intensity remaining" v={`${(t.fire.p * 100).toFixed(0)}%`} alarm={t.fire.p > 0} ok={t.fire.p === 0} />
      </div>

      <PanelHeader label="Robot pose" />
      <div className="border-t border-line px-4 py-3 space-y-1.5">
        <Row k="Position (x, y)" v={`${t.robot.x.toFixed(2)}, ${t.robot.y.toFixed(2)}`} />
        <Row k="Heading" v={`${((t.robot.th * 180) / Math.PI).toFixed(0)}°`} />
        <Row
          k="Facing the fire"
          v={t.orientation ? `${t.orientation.facingFire ? "Yes" : "No"} · ${t.orientation.headingErrDeg.toFixed(0)}° off` : "—"}
          ok={t.orientation?.facingFire}
          alarm={t.orientation && !t.orientation.facingFire && t.state === "SPRAY"}
        />
      </div>

      <PanelHeader label="Occupancy grid SLAM" right={<span className="data text-[11px] text-muted">{t.slam.coverage.toFixed(0)}% mapped</span>} />
      <div className="border-t border-line px-4 py-3 space-y-1.5">
        <Row k="Pose error vs. truth" v={`${t.slam.poseError.toFixed(2)} m`} alarm={t.slam.poseError > 0.5} ok={t.slam.poseError < 0.15} />
        <Row k="Heading error vs. truth" v={`${t.slam.headingErrorDeg.toFixed(1)}°`} />
        <Row k="Scan matches" v={`${t.slam.stats.matched} / ${t.slam.stats.scans}`} />
      </div>
    </div>
  );
}

function Row({ k, v, alarm, ok }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-muted">{k}</span>
      <span className={`data font-medium ${alarm ? "text-warn" : ok ? "text-ok" : "text-ink"}`}>{v}</span>
    </div>
  );
}
