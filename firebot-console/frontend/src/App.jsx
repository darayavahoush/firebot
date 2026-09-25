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
  const logRef = useRef(null);
  const lastFrameAtRef = useRef(0);

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
      },
    );
    return disconnect;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar page={page} mode={mode} onEstop={onEstop} />

        {page === "live" ? (
          <LiveOps
            frame={frame}
            mode={mode}
            setMode={setMode}
            log={log}
            onDrive={onDrive}
            onPump={onPump}
            onNozzle={onNozzle}
          />
        ) : page === "sim" ? (
          <Simulator />
        ) : (
          <History />
        )}
      </div>
    </div>
  );
}
