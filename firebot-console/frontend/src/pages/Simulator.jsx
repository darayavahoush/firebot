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

const SPEEDS = [0.5, 1, 2, 4];

// SpeechRecognition error codes that mean "stop trying" rather than "hiccup, keep listening".
const FATAL_VOICE_ERRORS = new Set(["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"]);
const VOICE_ERROR_MESSAGES = {
  "not-allowed": "Microphone access was denied \u2014 allow it in your browser's site settings and try again.",
  "service-not-allowed": "Microphone access was denied \u2014 allow it in your browser's site settings and try again.",
  "audio-capture": "No microphone found. Check your device and try again.",
  "language-not-supported": "This browser doesn't support the en-US recognition language.",
};

// Opera exposes `webkitSpeechRecognition` (Chromium-based) but never wired it to a working
// backend -- Chrome's version talks to a Google-hosted recognition service Opera doesn't ship
// a key for, so it "listens" forever and returns zero results with zero errors. Brave, same
// story. Detect both so the UI can be honest about it instead of showing a dead "LIVE" state.
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
  const [asrStatus, setAsrStatus] = useState("idle"); // idle | recording | transcribing | error
  const [asrError, setAsrError] = useState("");
  // Which server speech path is live: "local" (trained model), "local-degraded", "groq", "unavailable"
  const [voiceMode, setVoiceMode] = useState(null);
  // Who the server thinks just spoke: {name|null, score} from /api/transcribe, or null if not checked.
  const [speakerInfo, setSpeakerInfo] = useState(null);
  const [operator, setOperatorState] = useState(getOperator);
  const [showCalibrate, setShowCalibrate] = useState(false);
  const [personalModel, setPersonalModel] = useState(null);
  const [pendingClip, setPendingClip] = useState(null);       // last voice clip awaiting the person's reaction
  const [feedbackCommands, setFeedbackCommands] = useState([]);
  const [liveAccuracy, setLiveAccuracy] = useState(null);
  const pendingRef = useRef(null);
  useEffect(() => { pendingRef.current = pendingClip; }, [pendingClip]);

  // Tell the backend what the person did with the last voice result, so their model can learn from it.
  const sendFeedback = useCallback(async (body) => {
    const p = pendingRef.current;
    if (!p) return null;
    pendingRef.current = null;
    setPendingClip(null);
    try {
      const res = await fetch("/api/voice/feedback", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: p.user, clip_id: p.id, ...body }) });
      const j = res.ok ? await res.json() : null;
      if (j?.live?.accuracy != null) setLiveAccuracy(j.live.accuracy);
      return j;
    } catch { return null; }
  }, []);
  const onSent = useCallback((sentText) => { sendFeedback({ sent_text: sentText }); }, [sendFeedback]);
  const loadFeedbackCommands = useCallback(async () => {
    const p = pendingRef.current;
    if (!p || feedbackCommands.length) return;
    try {
      const j = await (await fetch(`/api/voice/calibrate/status?user=${encodeURIComponent(p.user)}`)).json();
      setFeedbackCommands(j.classes || []);
    } catch { /* picker stays empty; sending as-is still works */ }
  }, [feedbackCommands.length]);
  const onFix = useCallback(async (label) => {
    const phrase = feedbackCommands.find((c) => c.label === label)?.phrase;
    await sendFeedback({ label });
    setTextCmd(label === "UNKNOWN" ? "" : phrase || "");
    cmdInputRef.current?.focus();
  }, [feedbackCommands, sendFeedback]);
  useEffect(() => {
    let alive = true;
    fetch("/api/voice/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j) setVoiceMode(j); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const recogRef = useRef(null);
  const restartTimerRef = useRef(null);
  const restartAttemptsRef = useRef(0);
  const rafRef = useRef(null);
  const lastRef = useRef(performance.now());
  const renderThrottleRef = useRef(0);
  const ackTimerRef = useRef(null);
  const cmdInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const micStreamRef = useRef(null);

  // Brave's "is this Brave" check is async (privacy: it can't be read synchronously off the
  // UA string like Opera's), so it lands a tick after mount.
  useEffect(() => {
    if (navigator?.brave?.isBrave) {
      navigator.brave.isBrave().then((isBrave) => {
        if (isBrave) setWebSpeechBroken(true);
      }).catch(() => {});
    }
  }, []);

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

  const newFire = useCallback(() => {
    engineRef.current.newFire();
    setTick((t) => t + 1);
  }, []);

  // Brief on-screen acknowledgment so the operator knows a voice/text command was actually
  // received and parsed, rather than having to go check the command/event log to find out.
  // Auto-dismisses; a new command replaces the old ack immediately rather than stacking.
  const showAck = useCallback((text, intent) => {
    if (ackTimerRef.current) clearTimeout(ackTimerRef.current);
    setAck({ text, intent: intent.name, understood: intent.name !== "UNKNOWN" });
    ackTimerRef.current = setTimeout(() => setAck(null), 3200);
  }, []);
  useEffect(() => () => { if (ackTimerRef.current) clearTimeout(ackTimerRef.current); }, []);

  const sendCommand = useCallback(
    async (text) => {
      if (!text.trim()) return;
      let intent = engineRef.current.say(text);
      if (intent.name === "UNKNOWN") {
        try {
          const res = await parseAndExecuteVoiceIntent(text, false, operator);
          if (res?.intent?.intent && res.intent.intent !== "UNKNOWN") {
            intent = engineRef.current.applyParsedIntent(res.intent.intent, res.intent.params || {}, text);
          }
        } catch (err) {
          // Fall back gracefully
        }
      }
      showAck(text, intent);
      setTick((t) => t + 1);
    },
    [showAck, operator]
  );

  // Web Speech API -- Chrome/Edge only; Safari partial; Firefox unsupported. Opera/Brave
  // *report* support (see detectBrokenWebSpeech above) but have no working engine behind it,
  // so `speechUsable` is the one to gate the mic button on, not `speechSupported` alone.
  const speechSupported = useMemo(
    () => typeof window !== "undefined" && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    []
  );
  const speechUsable = speechSupported && !webSpeechBroken;
  const toggleListening = useCallback(() => {
    if (!speechUsable) return;
    if (listening) {
      if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
      const r = recogRef.current; recogRef.current = null; r?.stop(); setListening(false); setTranscript("");
      return;
    }
    setVoiceError("");
    restartAttemptsRef.current = 0;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const start = () => {
      const r = new Recognition();
      r.continuous = true; r.interimResults = true; r.lang = "en-US";
      r.onresult = (e) => {
        restartAttemptsRef.current = 0; // a real result means the recognizer is healthy again
        let interim = "", final = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) final += t; else interim += t;
        }
        if (final) { sendCommand(final); setTranscript(""); } else setTranscript(interim);
      };
      r.onerror = (e) => {
        // Fatal: the browser has given up on this recognizer for good \u2014 restarting it in
        // onend would just loop the same error forever. Transient (no-speech, aborted,
        // occasional network blips) are normal mid-session noise; let onend restart quietly.
        if (FATAL_VOICE_ERRORS.has(e.error)) {
          recogRef.current = null; // stops onend from restarting it
          setListening(false);
          setVoiceError(VOICE_ERROR_MESSAGES[e.error] || `Speech recognition stopped (${e.error}).`);
        }
      };
      r.onend = () => {
        // Chrome ends the recognizer on its own after a stretch of silence even in continuous
        // mode; restart to keep "listening" actually listening. Calling start() again
        // immediately can throw (the browser's speech service hasn't fully torn down yet), and
        // that exception used to go uncaught here \u2014 the mic would silently go dead while the
        // UI still showed LIVE. A short delay plus a capped, backed-off retry with a real error
        // surfaced fixes both.
        if (recogRef.current !== r) return;
        restartAttemptsRef.current += 1;
        if (restartAttemptsRef.current > 5) {
          recogRef.current = null;
          setListening(false);
          setVoiceError("Speech recognition kept dropping and gave up restarting. Try the mic button again.");
          return;
        }
        const delay = Math.min(1500, 150 * restartAttemptsRef.current);
        restartTimerRef.current = setTimeout(() => {
          if (recogRef.current !== r) return;
          try { start(); } catch {
            recogRef.current = null;
            setListening(false);
            setVoiceError("Speech recognition stopped unexpectedly. Try the mic button again.");
          }
        }, delay);
      };
      recogRef.current = r;
      try {
        r.start();
      } catch {
        recogRef.current = null;
        setListening(false);
        setVoiceError("Couldn't start speech recognition. Try the mic button again.");
        return;
      }
      setListening(true);
    };
    start();
  }, [listening, speechUsable, sendCommand]);
  useEffect(() => () => {
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    const r = recogRef.current; recogRef.current = null; r?.stop();
  }, []);

  // Offline-browser voice fallback (click-to-record, not continuous) for when Web Speech is
  // missing or broken: record a clip, POST it to our backend, which forwards it to Groq's
  // hosted Whisper and hands back text. No model ships to the browser at all.
  const toggleRecording = useCallback(async () => {
    if (asrStatus === "recording") {
      mediaRecorderRef.current?.stop(); // onstop below does the upload
      return;
    }
    if (asrStatus === "transcribing") return;

    setAsrError("");
    setSpeakerInfo(null);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setAsrStatus("error");
      setAsrError("Microphone access was denied \u2014 allow it in your browser's site settings and try again.");
      return;
    }
    micStreamRef.current = stream;
    audioChunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    mediaRecorderRef.current = recorder;
    recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
    recorder.onstop = async () => {
      micStreamRef.current?.getTracks().forEach((tr) => tr.stop());
      micStreamRef.current = null;
      const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
      audioChunksRef.current = [];
      if (blob.size === 0) { setAsrStatus("idle"); return; }
      setAsrStatus("transcribing");
      try {
        // Upload 16 kHz mono WAV: the server's decoder handles it without ffmpeg. If the
        // browser can't decode its own recording, send the raw clip and let the server try.
        let upload = blob, uploadName = "clip.webm";
        try { upload = await blobToWav16k(blob); uploadName = "clip.wav"; } catch { /* raw fallback */ }
        const form = new FormData();
        form.append("file", upload, uploadName);
        if (operator) form.append("user", operator);
        const res = await fetch("/api/transcribe", { method: "POST", body: form });
        if (!res.ok) {
          const detail = await res.json().catch(() => null);
          throw new Error(detail?.detail || `Transcription failed (${res.status}).`);
        }
        const { text, speaker, speaker_score, speaker_scores, voice_model, clip_id, clip_user } = await res.json();
        setPersonalModel(voice_model || null);
        setPendingClip(clip_id && text ? { id: clip_id, user: clip_user, text } : null);
        setSpeakerInfo(speaker === undefined ? null : { name: speaker, score: speaker_score, scores: speaker_scores });
        fetch("/api/voice/status").then((r) => (r.ok ? r.json() : null)).then((j) => j && setVoiceMode(j)).catch(() => {});
        setAsrStatus("idle");
        if (text) { setTextCmd(text); cmdInputRef.current?.focus(); }
      } catch (err) {
        setAsrStatus("error");
        setAsrError(err?.message || "Couldn't reach the transcription service. Try again.");
      }
    };
    recorder.start();
    setAsrStatus("recording");
  }, [asrStatus, operator]);

  useEffect(() => () => {
    mediaRecorderRef.current?.state === "recording" && mediaRecorderRef.current.stop();
    micStreamRef.current?.getTracks().forEach((tr) => tr.stop());
  }, []);

  // Flat example-phrase list for the text-command autocomplete, built once from the same
  // reference list the "Eligible Commands" panel shows -- so suggestions never drift from it.
  const allExamples = useMemo(() => COMMAND_HELP.flatMap((c) => c.examples), []);
  const suggestions = useMemo(() => {
    const q = textCmd.trim().toLowerCase();
    if (!q) return [];
    const starts = allExamples.filter((ex) => ex.startsWith(q));
    const contains = allExamples.filter((ex) => !ex.startsWith(q) && ex.includes(q));
    return [...starts, ...contains].slice(0, 6);
  }, [textCmd, allExamples]);

  // Shared by clicking an autocomplete suggestion and clicking a past command in the log --
  // both just load the text into the box so the operator can review/edit before sending.
  const fillCommand = useCallback((text) => {
    setTextCmd(text);
    setShowSuggestions(false);
    cmdInputRef.current?.focus();
  }, []);

  const t = engineRef.current.telemetry();
  const sigma = t.estimate?.sigma;

  return (
    <main className="flex-1 flex flex-col relative">
      {ack && (
        <div
          className={`absolute top-3 left-1/2 -translate-x-1/2 z-20 rounded-full border px-4 py-1.5 text-[13px] shadow-lg transition-opacity ${
            ack.understood ? "border-telemetry text-telemetry bg-panel" : "border-warn text-warn bg-panel"
          }`}
        >
          {ack.understood ? "\u2713 command received: " : "\u26a0 not understood: "}
          <span className="text-ink">{"\u201c"}{ack.text}{"\u201d"}</span>
          {ack.understood && <span className="text-faint"> {"\u2192"} {ack.intent}</span>}
        </div>
      )}
      <div className="px-6 py-3 flex items-center gap-2.5 flex-wrap bg-base/80 backdrop-blur-md border-b border-line">
        <button onClick={() => { playSound("click"); newBuilding(); }} className="btn">
          <span>🏢</span> New Building
        </button>
        <button onClick={() => { playSound("click"); newFire(); }} className="btn">
          <span>🔥</span> Relocate Fire
        </button>
        <button onClick={() => { playSound("click"); setPaused((p) => !p); }} className="btn">
          {paused ? "▶ Resume" : "⏸ Pause"}
        </button>

        <div className="flex items-center gap-1 rounded-xl bg-panel2 p-1 border border-line" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => { playSound("click"); setSpeed(s); }}
              data-on={speed === s}
              className={`px-2.5 py-1 text-[11px] font-mono rounded-lg transition-all ${
                speed === s
                  ? "bg-telemetry text-base font-bold shadow-[0_0_8px_rgba(240,85,155,0.4)]"
                  : "text-muted hover:text-ink"
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 ml-1">
          <button
            className={`px-3 py-1.5 rounded-xl text-[12px] font-mono border transition-all ${
              showTree
                ? "border-telemetry bg-telemetry/15 text-telemetry font-bold"
                : "border-line text-muted hover:text-ink"
            }`}
            onClick={() => { playSound("click"); setShowTree((v) => !v); }}
          >
            RRT* Tree
          </button>
          <button
            className={`px-3 py-1.5 rounded-xl text-[12px] font-mono border transition-all ${
              showSensors
                ? "border-ok bg-ok/15 text-ok font-bold"
                : "border-line text-muted hover:text-ink"
            }`}
            onClick={() => { playSound("click"); setShowSensors((v) => !v); }}
          >
            Camera Cone
          </button>
          <button
            className={`px-3 py-1.5 rounded-xl text-[12px] font-mono border transition-all ${
              showSlam
                ? "border-warn bg-warn/15 text-warn font-bold"
                : "border-line text-muted hover:text-ink"
            }`}
            onClick={() => { playSound("click"); setShowSlam((v) => !v); }}
          >
            SLAM / NBV
          </button>
        </div>

        <button
          onClick={() => { playSound("estop"); sendCommand("stop"); }}
          aria-label="Emergency stop"
          className="estop-button ml-auto h-10 px-5 rounded-xl text-white font-display font-black text-[13px] tracking-wider uppercase flex items-center gap-2 cursor-pointer"
        >
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <span>STOP</span>
        </button>
      </div>

      <div className="flex-1 grid grid-cols-[1fr_360px] gap-5 bg-base overflow-hidden px-6 pb-6 pt-4">
        <div className="panel flex flex-col relative">
          <div className="absolute top-3 left-3 z-10 flex flex-wrap gap-2 pointer-events-none">
            <span className="rounded-xl bg-base/85 backdrop-blur-md border border-line px-3 py-1.5 text-[12px] font-mono flex items-center gap-2 shadow-lg">
              <span className={`h-2 w-2 rounded-full ${t.mode === "STOPPED" ? "bg-alarm pulse-dot" : t.state === "SAFE" ? "bg-ok" : "bg-telemetry pulse-dot"}`} />
              <b className="text-ink">{t.mode === "STOPPED" ? "STOPPED" : t.state}</b>
            </span>
            <span className="rounded-xl bg-base/85 backdrop-blur-md border border-line px-3 py-1.5 text-[12px] font-mono data shadow-lg">
              TANK <b className="text-telemetry">{(t.tank * 100).toFixed(0)}%</b>
            </span>
            <span className="rounded-xl bg-base/85 backdrop-blur-md border border-line px-3 py-1.5 text-[12px] font-mono data shadow-lg">
              FIRE <b className={t.fire.p > 0 ? "text-alarm" : "text-ok"}>{t.fire.p > 0 ? `${(t.fire.p * 100).toFixed(0)}%` : "OUT"}</b>
            </span>
          </div>
          <SimCanvas engineRef={engineRef} showTree={showTree} showSensors={showSensors} showSlam={showSlam} height={620} />
          <div className="border-t border-line bg-panel2/40 px-4 py-2.5 flex items-center gap-4 text-[11px] font-mono text-muted flex-wrap relative">
            <Legend swatch="#3FA7D6" label="robot" />
            <Legend swatch="#E14A3A" label="fire (truth)" />
            <Legend swatch="#D69A3C" label="EIF estimate" />
            <Legend swatch="#4CAF6D" label="path" />
            <Legend swatch="rgba(63,167,214,0.6)" label="RRT* tree" />
            <Legend swatch="#C4A0FF" label="NBV target" />
            <Legend swatch="#FFB238" label="SLAM pose" />
            <span className="ml-auto text-faint data">{t.world.width.toFixed(1)}m × {t.world.height.toFixed(1)}m • Seed {engineRef.current.seed}</span>
          </div>
        </div>

        <div className="panel flex flex-col overflow-hidden">
          <div className="flex bg-panel2/80 border-b border-line p-1 gap-1">
            {[
              { id: "telemetry", label: "Telemetry" },
              { id: "sensors", label: "Sensors" },
              { id: "planner", label: "Planner" },
              { id: "voice", label: "Voice" },
            ].map(({ id: k, label }) => (
              <button
                key={k}
                onClick={() => { playSound("tab"); setTab(k); }}
                className={`flex-1 py-2 text-[12px] font-mono uppercase tracking-wider rounded-lg transition-all ${
                  tab === k
                    ? "bg-panel text-ink font-bold shadow-[0_0_8px_rgba(240,85,155,0.3)] border border-telemetry/40 text-telemetry"
                    : "text-muted hover:text-ink hover:bg-panel/40 border border-transparent"
                }`}
              >
                {label}
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
                speechUsable={speechUsable}
                webSpeechBroken={webSpeechBroken}
                listening={listening}
                toggleListening={toggleListening}
                transcript={transcript}
                voiceError={voiceError}
                textCmd={textCmd}
                setTextCmd={setTextCmd}
                sendCommand={sendCommand}
                cmdInputRef={cmdInputRef}
                suggestions={suggestions}
                showSuggestions={showSuggestions}
                setShowSuggestions={setShowSuggestions}
                fillCommand={fillCommand}
                asrStatus={asrStatus}
                voiceMode={voiceMode}
                speakerInfo={speakerInfo}
                operator={operator}
                personalModel={personalModel}
                onCalibrate={() => setShowCalibrate(true)}
                pendingClip={pendingClip}
                feedbackCommands={feedbackCommands}
                onFeedbackOpen={loadFeedbackCommands}
                onFix={onFix}
                onSent={onSent}
                liveAccuracy={liveAccuracy}
                asrError={asrError}
                toggleRecording={toggleRecording}
              />
            )}
          </div>
          <EventLog events={t.events} />
        </div>
      </div>
      {showCalibrate && (
        <CalibratePanel operator={operator} onOperator={setOperatorState}
          onClose={() => setShowCalibrate(false)}
          onTrained={(r) => setPersonalModel(r?.has_model ? operator : null)} />
      )}
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
      <div className="flex justify-around py-5 border-t border-line">
        <Ring label="Water tank" value={t.tank} low={t.tank < 0.2} />
        <Ring label="Battery" value={t.battery} low={t.battery < 0.2} />
        <Ring label="Fire out" value={1 - t.fire.p} good />
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
        <Row
          k="Facing the fire"
          v={t.orientation ? `${t.orientation.facingFire ? "yes" : "no"} \u00b7 ${t.orientation.headingErrDeg.toFixed(0)}\u00b0 off` : "\u2014"}
          ok={t.orientation?.facingFire} alarm={t.orientation && !t.orientation.facingFire && t.state === "SPRAY"}
        />
      </div>
      <PanelHeader label="SLAM" right={<span className="data text-[12px] text-muted">{t.slam.coverage.toFixed(0)}% mapped</span>} />
      <div className="border-t border-line px-4 py-3 space-y-1.5">
        <Row k="Pose error vs. ground truth" v={`${t.slam.poseError.toFixed(2)} m`} alarm={t.slam.poseError > 0.5} ok={t.slam.poseError < 0.15} />
        <Row k="Heading error vs. ground truth" v={`${t.slam.headingErrorDeg.toFixed(1)}\u00b0`} />
        <Row k="Scan matches" v={`${t.slam.stats.matched} / ${t.slam.stats.scans}`} />
      </div>
      {t.extinguishReport?.length > 0 && (
        <>
          <PanelHeader label="Extinguish Log" />
          <div className="border-t border-line divide-y divide-line">
            {t.extinguishReport.slice(0, 5).map((r, i) => (
              <div key={i} className="px-4 py-2 text-[12px] flex items-center justify-between">
                <span className="text-muted">{r.t.toFixed(0)}s \u00b7 ({r.x.toFixed(1)}, {r.y.toFixed(1)})</span>
                <span className={`data ${r.facingFire ? "text-ok" : "text-warn"}`}>
                  {r.facingFire ? "facing fire" : `${r.headingErrDeg.toFixed(0)}\u00b0 off`}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
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
