import React, { useEffect, useState, useCallback, useRef } from "react";
import Sidebar from "./components/Sidebar.jsx";
import TopBar from "./components/TopBar.jsx";
import LiveOps from "./pages/LiveOps.jsx";
import Simulator from "./pages/Simulator.jsx";
import History from "./pages/History.jsx";
import { connectTelemetry, sendCommand, sendEstop } from "./api/client.js";

export default function App() {
  const [page, setPage] = useState("live");
  const [frame, setFrame] = useState(null);
  const [linkOk, setLinkOk] = useState(true);
  const [mode, setModeState] = useState("auto");
  const [log, setLog] = useState([]);
  const [ack, setAck] = useState(null);
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
    setAck({ text: c.text, channel: c.channel, valid: c.valid, message: c.message });
    ackTimerRef.current = setTimeout(() => setAck(null), 3200);
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
        ArrowDown: "back",
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

  return (
    <div className="min-h-full flex">
      <Sidebar page={page} setPage={setPage} linkOk={frame ? linkOk : true} />

      <div className="flex-1 flex flex-col min-w-0 relative">
        <TopBar page={page} mode={mode} onEstop={onEstop} />

        {ack && (
          <div
            className={`absolute top-3 left-1/2 -translate-x-1/2 z-20 rounded-full border px-4 py-1.5 text-[12px] font-mono shadow-lg bg-panel ${
              ack.valid ? "border-telemetry text-telemetry" : "border-warn text-warn"
            }`}
          >
            {ack.valid ? "\u2713 command received: " : "\u26a0 not understood: "}
            <span className="text-ink">{"\u201c"}{ack.text}{"\u201d"}</span>
            <span className="text-faint"> ({ack.channel})</span>
          </div>
        )}

        {/* All three pages stay mounted once visited, toggled with display rather than
            conditional rendering, so the Simulator's in-memory engine (building, fire, robot
            position, planner state) survives switching to Live Ops/History and back instead of
            being torn down and recreated from scratch on every navigation. */}
        <div className={page === "live" ? "contents" : "hidden"}>
          <LiveOps
            frame={frame}
            mode={mode}
            setMode={setMode}
            log={log}
            onDrive={onDrive}
            onPump={onPump}
            onNozzle={onNozzle}
          />
        </div>
        <div className={page === "sim" ? "contents" : "hidden"}>
          <Simulator />
        </div>
        <div className={page === "history" ? "contents" : "hidden"}>
          <History />
        </div>
      </div>
    </div>
  );
}
