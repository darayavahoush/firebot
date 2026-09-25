import React from "react";
import TelemetryGauges from "../components/TelemetryGauges.jsx";
import CameraFeed from "../components/CameraFeed.jsx";
import ControlPanel from "../components/ControlPanel.jsx";
import ModeSwitch from "../components/ModeSwitch.jsx";
import CommandLog from "../components/CommandLog.jsx";

export default function LiveOps({
  frame,
  mode,
  setMode,
  log,
  onDrive,
  onPump,
  onNozzle,
}) {
  return (
    <div className="grid grid-cols-12 gap-4 p-6">
      <div className="col-span-8 flex flex-col gap-4">
        <CameraFeed frame={frame} />
        <ControlPanel
          enabled={mode === "manual"}
          onDrive={onDrive}
          onPump={onPump}
          onNozzle={onNozzle}
        />
      </div>

      <div className="col-span-4 flex flex-col gap-4">
        <ModeSwitch mode={mode} onChange={setMode} />
        <TelemetryGauges frame={frame} />
        <CommandLog entries={log} />
      </div>
    </div>
  );
}
