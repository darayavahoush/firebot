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
      <div className="border-t border-line flex-1 relative bg-scope min-h-[280px] overflow-hidden">
        {/* Wire this <img>/<video> to your MJPEG or WebRTC stream endpoint
            once camera hardware is on the Pi. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="opacity-30">
            <path
              d="M3 7h4l1.5-2h7L17 7h4v12H3V7z"
              stroke="#8A9A8E"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="13" r="3.2" stroke="#8A9A8E" strokeWidth="1.3" />
          </svg>
          <span className="font-mono text-[11px] text-[#8A9A8E] tracking-wide">
            NO CAMERA HARDWARE
          </span>
          <span className="font-mono text-[10px] text-[#8A9A8E]/60">
            feed will appear here once connected
          </span>
        </div>

        <CrosshairOverlay />
        <CornerBrackets />

        {/* HUD readout strip, top */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 py-2 font-mono text-[10px] text-[#7FD8A0]/85">
          <div className="flex items-center gap-1.5">
            <span
              className={`h-[6px] w-[6px] rounded-full ${
                frame ? "bg-alarm pulse-dot" : "bg-[#4A5750]"
              }`}
            />
            <span>{frame ? "REC" : "STANDBY"}</span>
          </div>
          <span>1280×720 · 15FPS</span>
        </div>

        {/* HUD readout strip, bottom */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-3 py-2 font-mono text-[10px] text-[#7FD8A0]/85">
          <span>CAM-01 / FWD</span>
          <span>
            {frame
              ? new Date().toISOString().replace("T", " ").slice(0, 19) + "Z"
              : "—"}
          </span>
        </div>

        {frame && (
          <div className="absolute bottom-8 left-3 font-mono text-[10px] text-[#E8A33D]">
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
      <line x1="50" y1="0" x2="50" y2="100" stroke="#4ADE80" strokeWidth="0.15" />
      <line x1="0" y1="50" x2="100" y2="50" stroke="#4ADE80" strokeWidth="0.15" />
      <circle cx="50" cy="50" r="8" fill="none" stroke="#4ADE80" strokeWidth="0.15" />
    </svg>
  );
}

function CornerBrackets() {
  const size = 16;
  const stroke = "#4ADE80";
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
