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
  const [mode, setModeState] = useState("auto");
  const [log, setLog] = useState([]);
  const logRef = useRef(null);

  useEffect(() => {
    const disconnect = connectTelemetry((f) => {
      setFrame(f);
      if (f.mode) setModeState(f.mode);
    });
    return disconnect;
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
      <Sidebar page={page} setPage={setPage} linkOk={frame ? frame.link_ok : true} />

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
