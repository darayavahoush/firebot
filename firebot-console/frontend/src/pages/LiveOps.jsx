import React from "react";
import StatusStrip from "../components/StatusStrip.jsx";
import ThermalHero from "../components/ThermalHero.jsx";
import Ring from "../components/Ring.jsx";
import CameraFeed from "../components/CameraFeed.jsx";
import ControlPanel from "../components/ControlPanel.jsx";
import ModeSwitch from "../components/ModeSwitch.jsx";
import CommandLog from "../components/CommandLog.jsx";

export default function LiveOps({ frame, mode, setMode, log, onAnalog, onPump, onNozzle }) {
  const gas = Math.max(frame?.sensors?.mq2_front ?? 0, frame?.sensors?.mq2_rear ?? 0);
  const fix = frame?.est_sigma != null ? 1 - Math.min(frame.est_sigma, 4) / 4 : null;
  return (
    <>
      <StatusStrip frame={frame} mode={mode} logCount={log.length} />
      <div className="p-6 grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px] items-start">
        <div className="flex flex-col gap-6 min-w-0">
          <ThermalHero frame={frame} />
          {frame && (
            <div className="flex flex-wrap items-center gap-8">
              <Ring label="Water tank" value={frame.tank} low={frame.tank < 0.2} />
              <Ring label="Gas" value={gas} low={gas > 0.25} />
              {fix != null && <Ring label="Fire fix" value={fix} good />}
              <p className="data text-[13px] text-muted">x {frame.x.toFixed(2)}, y {frame.y.toFixed(2)}</p>
            </div>
          )}
          <div>
            <CameraFeed frame={frame} />
            <p className="text-[12px] text-faint mt-2">Placeholder footage. No camera stream is wired to the robot yet; the thermal view above is real sensor data.</p>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <ModeSwitch mode={mode} onChange={setMode} />
          <ControlPanel enabled={mode === "manual"} onAnalog={onAnalog} onPump={onPump} onNozzle={onNozzle} />
          <CommandLog entries={log} />
        </div>
      </div>
    </>
  );
}
