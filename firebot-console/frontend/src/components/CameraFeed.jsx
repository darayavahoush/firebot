import React from "react";
import { PanelHeader } from "./TelemetryGauges.jsx";

export default function CameraFeed({ frame }) {
  return (
    <div className="panel h-full flex flex-col">
      <PanelHeader
        label="Forward Camera"
        right={
          <span className="font-mono text-[11px] text-faint">
            {frame ? `t+${frame.t}s` : "—"}
          </span>
        }
      />
      <div className="border-t border-line flex-1 relative bg-[#0A0D0F] min-h-[280px] overflow-hidden">
        {/* Wire this <img>/<video> to your MJPEG or WebRTC stream endpoint. */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-[11px] text-faint tracking-wide">
            NO FEED CONNECTED
          </span>
        </div>

        <CrosshairOverlay />
        <CornerBrackets />

        {/* HUD readout strip, top */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 py-2 font-mono text-[10px] text-muted/80">
          <div className="flex items-center gap-1.5">
            <span
              className={`h-[6px] w-[6px] rounded-full ${
                frame ? "bg-alarm pulse-dot" : "bg-faint"
              }`}
            />
            <span>{frame ? "REC" : "STANDBY"}</span>
          </div>
          <span>1280×720 · 15FPS</span>
        </div>

        {/* HUD readout strip, bottom */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-3 py-2 font-mono text-[10px] text-muted/80">
          <span>CAM-01 / FWD</span>
          <span>
            {frame
              ? new Date().toISOString().replace("T", " ").slice(0, 19) + "Z"
              : "—"}
          </span>
        </div>

        {frame && (
          <div className="absolute bottom-8 left-3 font-mono text-[10px] text-warn/90">
            THERMAL PEAK {frame.temp_c.toFixed(1)}°C
          </div>
        )}
      </div>
    </div>
  );
}

function CrosshairOverlay() {
  return (
    <svg
      className="absolute inset-0 w-full h-full opacity-[0.12] pointer-events-none"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <line x1="50" y1="0" x2="50" y2="100" stroke="#3FA7D6" strokeWidth="0.15" />
      <line x1="0" y1="50" x2="100" y2="50" stroke="#3FA7D6" strokeWidth="0.15" />
      <circle cx="50" cy="50" r="8" fill="none" stroke="#3FA7D6" strokeWidth="0.15" />
    </svg>
  );
}

function CornerBrackets() {
  const size = 16;
  const stroke = "#3FA7D6";
  const positions = [
    { top: 10, left: 10, rotate: 0 },
    { top: 10, right: 10, rotate: 90 },
    { bottom: 10, right: 10, rotate: 180 },
    { bottom: 10, left: 10, rotate: 270 },
  ];
  return (
    <>
      {positions.map((pos, i) => (
        <svg
          key={i}
          width={size}
          height={size}
          viewBox="0 0 16 16"
          className="absolute opacity-30 pointer-events-none"
          style={{ ...pos, transform: `rotate(${pos.rotate}deg)` }}
        >
          <path d="M1 8 V1 H8" fill="none" stroke={stroke} strokeWidth="1.5" />
        </svg>
      ))}
    </>
  );
}
