import React, { useEffect, useState, useCallback, useRef } from "react";
import Sidebar from "./components/Sidebar.jsx";
import TopBar from "./components/TopBar.jsx";
import LiveOps from "./pages/LiveOps.jsx";
import Simulator from "./pages/Simulator.jsx";
import MuJoCo from "./pages/MuJoCo.jsx";
import VoiceCalibration from "./pages/VoiceCalibration.jsx";
import History from "./pages/History.jsx";
import About from "./pages/About.jsx";
import { connectTelemetry, sendCommand, sendEstop } from "./api/client.js";
import { notify, notifyEnabled, setNotifyEnabled, notifySupported } from "./lib/notify.js";
import { playSound } from "./lib/sound.js";

export default function App() {
  const [page, setPage] = useState("live");
  const [activeOperator, setActiveOperator] = useState("ananya");
  const [frame, setFrame] = useState(null);
  const [linkOk, setLinkOk] = useState(true);
  const [mode, setModeState] = useState("auto");
  const [log, setLog] = useState([]);
  const [ack, setAck] = useState(null);
  const [notifOn, setNotifOn] = useState(notifyEnabled);
  const prevRef = useRef({ link: null, lowTank: false, located: false, pump: false });
  const logRef = useRef(null);
  const lastFrameAtRef = useRef(0);
  const ackTimerRef = useRef(null);

  // `frame.link_ok` doesn't exist on the wire (the frames table has no such column), so this
  // used to read undefined and show "LINK LOST" permanently. Derive it instead from whether
  // telemetry is actually still arriving -- 2s is a few missed polls' worth of slack over the
  // console's 0.4s Postgres poll interval, well above normal jitter but still catches a stall.
  useEffect(() => {
    const id = setInterval(() => {
      setLinkOk(lastFrameAtRef.current !== 0 && Date.now() - lastFrameAtRef.current < 2000);
    }, 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const disconnect = connectTelemetry(
      (f) => {
        lastFrameAtRef.current = Date.now();
        setLinkOk(true);
        setFrame(f);
        if (f.mode) setModeState(f.mode);
      },
      (c) => {
        const label = c.valid ? c.text : `${c.text} — rejected: ${c.message ?? "invalid"}`;
        pushLog(c.channel, label);
        showAck(c);
      },
    );
    return disconnect;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Brief on-screen acknowledgment so the operator can tell at a glance that a voice/typed
  // command actually landed and was (or wasn't) understood, instead of having to go find it
  // in the scrolling Command Log. Auto-dismisses; a new command replaces the old one immediately.
  const showAck = useCallback((c) => {
    if (ackTimerRef.current) clearTimeout(ackTimerRef.current);
    playSound(c.valid ? "ack" : "estop");
    setAck({ text: c.text, channel: c.channel, valid: c.valid, message: c.message });
    ackTimerRef.current = setTimeout(() => setAck(null), 3400);
  }, []);
  useEffect(() => () => { if (ackTimerRef.current) clearTimeout(ackTimerRef.current); }, []);

  const pushLog = useCallback((source, text) => {
    setLog((prev) => {
      const entry = {
        time: new Date().toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        source,
        text,
      };
      const next = [entry, ...prev];
      return next.slice(0, 200);
    });
  }, []);

  const setMode = useCallback(
    (next) => {
      setModeState(next);
      sendCommand({ type: "SET_MODE", mode: next });
      pushLog("system", `mode → ${next}`);
    },
    [pushLog]
  );

  const onDrive = useCallback(
    ({ dir, speed }) => {
      sendCommand({ type: "DRIVE", dir, speed });
      pushLog("typed", `drive ${dir} @ ${speed}%`);
    },
    [pushLog]
  );

  const onAnalog = useCallback(
    ({ v, w, log: why }) => {
      sendCommand({ type: "DRIVE", v, w });
      if (why) pushLog("typed", `joystick ${why}`);
    },
    [pushLog]
  );

  const onPump = useCallback(
    (on) => {
      sendCommand({ type: "PUMP", on });
      pushLog("typed", `pump ${on ? "on" : "off"}`);
    },
    [pushLog]
  );

  const onNozzle = useCallback(
    (angle) => {
      sendCommand({ type: "NOZZLE", angle });
      pushLog("typed", `nozzle ${angle}°`);
    },
    [pushLog]
  );

  const onEstop = useCallback(() => {
    sendEstop();
    pushLog("system", "E-STOP triggered");
  }, [pushLog]);

  // Basic keyboard control while on the Live page in manual mode.
  useEffect(() => {
    const handler = (e) => {
      if (page !== "live" || mode !== "manual") return;
      const map = {
        ArrowUp: "fwd",
        ArrowLeft: "left",
        ArrowRight: "right",
        " ": "stop",
      };
      if (map[e.key]) {
        e.preventDefault();
        onDrive({ dir: map[e.key], speed: 50 });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [page, mode, onDrive]);

  const toggleNotif = useCallback(async () => {
    setNotifOn(await setNotifyEnabled(!notifOn));
  }, [notifOn]);

  // Alerts for the moments an operator would want to be pulled back to the tab.
  useEffect(() => {
    const p = prevRef.current;
    if (frame && p.link === true && !linkOk) notify("Robot link lost", "No telemetry for over 2 seconds.", "link");
    if (frame && p.link === false && linkOk) notify("Robot link restored", "Telemetry is flowing again.", "link");
    if (frame) p.link = linkOk;
    if (!frame) return;
    const low = frame.tank != null && frame.tank < 0.2;
    if (low && !p.lowTank) notify("Water tank low", `${Math.round(frame.tank * 100)}% left.`, "tank");
    if (frame.tank != null && frame.tank > 0.3) p.lowTank = false; else if (low) p.lowTank = true;
    const located = frame.est_sigma != null && frame.est_sigma < 0.5;
    if (located && !p.located) notify("Fire located", `Position known to within ${frame.est_sigma.toFixed(2)} m.`, "fire");
    if (frame.est_sigma != null && frame.est_sigma > 2) p.located = false; else if (located) p.located = true;
    if (frame.cmd_pump && !p.pump) notify("Spraying water", "The pump just switched on.", "pump");
    p.pump = !!frame.cmd_pump;
  }, [frame, linkOk]);

  return (
    <div className="min-h-full flex">
      <Sidebar page={page} setPage={setPage} linkOk={frame ? linkOk : true} notifOn={notifOn} onToggleNotif={notifySupported() ? toggleNotif : null} />

      <div className="flex-1 flex flex-col min-w-0 relative">
        <TopBar page={page} mode={mode} onEstop={onEstop} activeOperator={activeOperator} />

        {ack && (
          <div
            className={`absolute top-4 left-1/2 -translate-x-1/2 z-30 rounded-2xl border px-5 py-2.5 text-[12px] font-mono shadow-2xl backdrop-blur-xl flex items-center gap-2.5 transition-all duration-200 animate-fadeIn ${
              ack.valid
                ? "border-telemetry/40 bg-panel/95 text-ink shadow-[0_0_20px_rgba(240,85,155,0.35)]"
                : "border-warn/40 bg-panel/95 text-warn shadow-[0_0_20px_rgba(255,178,56,0.35)]"
            }`}
          >
            <span className={`text-[14px] font-bold ${ack.valid ? "text-telemetry" : "text-warn"}`}>
              {ack.valid ? "✓" : "⚠"}
            </span>
            <span>
              {ack.valid ? "Command received: " : "Not understood: "}
              <b className="text-ink">"{ack.text}"</b>
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-panel2 border border-line text-faint uppercase">
              {ack.channel}
            </span>
          </div>
        )}

        {/* All pages stay mounted once visited, toggled with display rather than
            conditional rendering, so engine states survive switching tabs. */}
        <div className={page === "live" ? "contents" : "hidden"}>
          <LiveOps
            frame={frame}
            mode={mode}
            setMode={setMode}
            log={log}
            onAnalog={onAnalog}
            onPump={onPump}
            onNozzle={onNozzle}
          />
        </div>
        <div className={page === "sim" ? "contents" : "hidden"}>
          <Simulator />
        </div>
        <div className={page === "mujoco" ? "contents" : "hidden"}>
          <MuJoCo />
        </div>
        <div className={page === "voice" ? "contents" : "hidden"}>
          <VoiceCalibration
            activeOperatorId={activeOperator}
            onSelectOperator={(id) => setActiveOperator(id)}
            onContinueToLiveOps={(id) => {
              setActiveOperator(id);
              setPage("live");
              playSound("tab");
            }}
          />
        </div>
        <div className={page === "history" ? "contents" : "hidden"}>
          <History />
        </div>
        <div className={page === "about" ? "contents" : "hidden"}>
          <About />
        </div>
      </div>
    </div>
  );
}
