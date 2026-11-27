import React from "react";
import Stat from "./ui/Stat.jsx";

export default function StatusStrip({ frame, mode, logCount }) {
  const computeMs = frame?.compute_ms;
  const online = !!frame;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 px-6 py-4 border-b border-line">
      <div className="panel px-4 py-3">
        <Stat
          label="Robot link"
          value={online ? "Online" : "Connecting…"}
          tone={online ? "ok" : "alarm"}
          hint={online ? "Telemetry streaming" : "Waiting for first frame"}
        />
      </div>
      <div className="panel px-4 py-3">
        <Stat
          label="Control mode"
          value={<span className="capitalize">{mode}</span>}
          hint={mode === "auto" ? "EIF + RRT* autonomy" : mode === "manual" ? "Joystick teleop" : "Standby"}
        />
      </div>
      <div className="panel px-4 py-3">
        <Stat
          label="Perception latency"
          value={computeMs != null ? `${computeMs.toFixed(1)} ms` : "—"}
          tone={computeMs > 200 ? "warn" : undefined}
          hint={computeMs == null ? "Awaiting frame" : computeMs < 100 ? "Healthy" : "Elevated"}
        />
      </div>
      <div className="panel px-4 py-3">
        <Stat label="Commands sent" value={logCount} tone="info" hint="This session" />
      </div>
    </div>
  );
}
