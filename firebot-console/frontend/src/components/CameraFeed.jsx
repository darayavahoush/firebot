import React, { useEffect, useRef, useState } from "react";
import { PanelHeader } from "./TelemetryGauges.jsx";
import { Illustration } from "./ui";

const PRIMARY_FOOTAGE_URL = "./footage.mp4";
const FALLBACK_FOOTAGE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/transcoded/d/d0/The_Iris_Robot_of_the_Bureau_of_Fire_Protection.webm/The_Iris_Robot_of_the_Bureau_of_Fire_Protection.webm.480p.vp9.webm";

const THERM_ROWS = 24;
const THERM_COLS = 32;

function thermalPeak(thermal) {
  if (!thermal) return null;
  let peak = -Infinity;
  for (const row of thermal) for (const v of row) if (v > peak) peak = v;
  return Number.isFinite(peak) ? peak : null;
}

export default function CameraFeed({ frame }) {
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const rafRef = useRef(null);
  const frameRef = useRef(frame);
  const thermalRef = useRef(null);
  const [footageOk, setFootageOk] = useState(true);
  const motionRef = useRef({ phase: 0, pan: 0, lastNow: null });

  frameRef.current = frame;
  if (frame?.thermal) thermalRef.current = frame.thermal;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    function draw(now) {
      rafRef.current = requestAnimationFrame(draw);
      const el = canvas.parentElement;
      if (!el) return;
      const dpr = window.devicePixelRatio || 1;
      const cssW = el.clientWidth, cssH = el.clientHeight;
      if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
        canvas.width = cssW * dpr;
        canvas.height = cssH * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const t = now / 1000;
      const f = frameRef.current;
      const cx = cssW / 2, cy = cssH * 0.42;

      const m = motionRef.current;
      const dt = m.lastNow == null ? 0 : Math.min(0.1, (now - m.lastNow) / 1000);
      m.lastNow = now;
      const v = f?.cmd_v ?? 0;
      const w = f?.cmd_w ?? 0;
      m.phase += v * dt * 5.5;
      m.pan += (w * 26 - m.pan) * Math.min(1, dt * 6);

      if (footageOk) {
        ctx.clearRect(0, 0, cssW, cssH);
      } else {
        drawCorridor(ctx, cssW, cssH, cx, cy, f, t, m.phase, m.pan);
        if (v > 0.03) drawSpeedLines(ctx, cssW, cssH, cx, cy, v);
      }
      if (thermalRef.current) {
        drawThermalOverlay(ctx, cssW, cssH, thermalRef.current);
      } else if (!footageOk) {
        drawHeatSource(ctx, cssW, cssH, cx, cy, f, t);
      }
      drawGrain(ctx, cssW, cssH, t);
      drawScanlines(ctx, cssW, cssH, t);
    }
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [footageOk]);

  const peak = thermalPeak(thermalRef.current);
  const driving = frame && (Math.abs(frame.cmd_v ?? 0) > 0.03 || Math.abs(frame.cmd_w ?? 0) > 0.03);

  return (
    <div className="panel h-full flex flex-col">
      <PanelHeader
        label="Forward camera (CAM-01)"
        right={
          <span className="data text-[11px] text-faint">
            {frame ? `t+${frame.t.toFixed(1)}s` : "Standby"}
          </span>
        }
      />

      <div className="border-t border-line flex-1 relative bg-scope min-h-[280px] overflow-hidden">
        {!frame ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
            <Illustration name="no-signal" className="w-[180px] max-w-full" />
            <div className="text-[14px] font-semibold text-ink mt-3">No optical signal</div>
            <p className="text-[12px] text-muted max-w-[40ch] mt-1">
              Awaiting video stream from forward optical module CAM-01.
            </p>
          </div>
        ) : (
          <>
            {footageOk && (
              <video
                ref={videoRef}
                className="absolute inset-0 w-full h-full object-cover"
                style={{ filter: "saturate(0.7) brightness(0.75) contrast(1.15)" }}
                src={PRIMARY_FOOTAGE_URL}
                autoPlay
                loop
                muted
                playsInline
                onError={(e) => {
                  if (e.currentTarget.src !== FALLBACK_FOOTAGE_URL) {
                    e.currentTarget.src = FALLBACK_FOOTAGE_URL;
                  } else {
                    setFootageOk(false);
                  }
                }}
              />
            )}
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

            <CrosshairOverlay />
            <CornerBrackets />

            {/* Readout top */}
            <div className="absolute top-0 inset-x-0 flex items-center justify-between px-3 py-2 text-[10px] text-muted">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-alarm pulse-dot" />
                <span className="font-semibold text-ink">REC</span>
              </div>
              <span className="data text-faint">1280×720 • 15 FPS</span>
            </div>

            {/* Readout bottom */}
            <div className="absolute bottom-0 inset-x-0 flex items-center justify-between px-3 py-2 text-[10px] text-muted">
              <span>CAM-01 / FWD</span>
              <span className="data text-faint">
                {new Date().toISOString().replace("T", " ").slice(0, 19)}Z
              </span>
            </div>

            {peak != null && (
              <div className="absolute bottom-8 left-3 data text-[11px] text-flame font-semibold bg-panel/80 backdrop-blur-sm px-2 py-0.5 rounded border border-line">
                Thermal peak {peak.toFixed(1)}°C
              </div>
            )}

            {driving && (
              <div className="absolute bottom-8 right-3 data text-[11px] text-telemetry font-semibold bg-panel/80 backdrop-blur-sm px-2 py-0.5 rounded border border-line">
                {`v ${frame.cmd_v.toFixed(2)} m/s  w ${frame.cmd_w.toFixed(2)} rad/s`}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function drawThermalOverlay(ctx, w, h, thermal) {
  let min = Infinity, max = -Infinity;
  for (const row of thermal) for (const v of row) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = Math.max(1e-3, max - min);
  const cellW = w / THERM_COLS, cellH = h / THERM_ROWS;

  ctx.save();
  ctx.globalAlpha = 0.55;
  for (let r = 0; r < THERM_ROWS; r++) {
    for (let c = 0; c < THERM_COLS; c++) {
      const norm = (thermal[r][c] - min) / range;
      ctx.fillStyle = thermalColor(norm);
      ctx.fillRect(c * cellW, r * cellH, cellW + 0.5, cellH + 0.5);
    }
  }
  ctx.restore();

  let hr = 0, hc = 0, hv = -Infinity;
  for (let r = 0; r < THERM_ROWS; r++) {
    for (let c = 0; c < THERM_COLS; c++) {
      if (thermal[r][c] > hv) { hv = thermal[r][c]; hr = r; hc = c; }
    }
  }
  const hx = (hc + 0.5) * cellW, hy = (hr + 0.5) * cellH;
  const boxR = Math.max(cellW, cellH) * 1.6;
  ctx.strokeStyle = "rgba(232, 89, 12, 0.85)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(hx - boxR, hy - boxR, boxR * 2, boxR * 2);
  ctx.font = "10px sans-serif";
  ctx.fillStyle = "rgba(232, 89, 12, 0.95)";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(`Heat ${hv.toFixed(0)}°C`, hx - boxR, hy - boxR - 3);
}

function thermalColor(norm) {
  const stops = [
    [0.0, [12, 14, 18]],
    [0.35, [14, 124, 123]],
    [0.65, [232, 89, 12]],
    [1.0, [217, 45, 32]],
  ];
  let i = 0;
  while (i < stops.length - 2 && norm > stops[i + 1][0]) i++;
  const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
  const f = Math.max(0, Math.min(1, (norm - t0) / (t1 - t0)));
  const rC = Math.round(c0[0] + (c1[0] - c0[0]) * f);
  const gC = Math.round(c0[1] + (c1[1] - c0[1]) * f);
  const bC = Math.round(c0[2] + (c1[2] - c0[2]) * f);
  return `rgb(${rC},${gC},${bC})`;
}

function drawCorridor(ctx, w, h, cx, cy, f, t, phase = 0, pan = 0) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#0C0E12");
  bg.addColorStop(1, "#060709");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const idleWobble = Math.sin(t * 0.15) * (Math.abs(pan) > 1 ? 1 : 4);
  const vpX = cx + idleWobble + pan, vpY = cy;
  const floorY = h * 0.98, ceilY = h * 0.04;
  const leftX = w * 0.02, rightX = w * 0.98;

  ctx.fillStyle = "#12151B";
  ctx.beginPath();
  ctx.moveTo(leftX, floorY); ctx.lineTo(rightX, floorY);
  ctx.lineTo(vpX + 40, vpY + 6); ctx.lineTo(vpX - 40, vpY + 6);
  ctx.closePath(); ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
  ctx.lineWidth = 1;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + i * 46, floorY);
    ctx.lineTo(vpX + i * 6, vpY + 6);
    ctx.stroke();
  }
  const rungSpacing = 34;
  const rungOffset = ((phase * rungSpacing) % rungSpacing + rungSpacing) % rungSpacing;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  for (let rung = rungOffset; rung < floorY - vpY; rung += rungSpacing) {
    const frac = rung / (floorY - vpY);
    const y = vpY + 6 + rung;
    const halfW = 6 + frac * (rightX - leftX) * 0.5 * 0.94;
    ctx.beginPath();
    ctx.moveTo(vpX - halfW, y); ctx.lineTo(vpX + halfW, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#0F1218";
  ctx.beginPath();
  ctx.moveTo(leftX, ceilY); ctx.lineTo(rightX, ceilY);
  ctx.lineTo(vpX + 40, vpY - 30); ctx.lineTo(vpX - 40, vpY - 30);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = "#141720";
  ctx.beginPath();
  ctx.moveTo(leftX, ceilY); ctx.lineTo(leftX, floorY);
  ctx.lineTo(vpX - 40, vpY + 6); ctx.lineTo(vpX - 40, vpY - 30);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(rightX, ceilY); ctx.lineTo(rightX, floorY);
  ctx.lineTo(vpX + 40, vpY + 6); ctx.lineTo(vpX + 40, vpY - 30);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = "#0A0D12";
  ctx.fillRect(vpX - 22, vpY - 24, 44, 30);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(vpX - 22, vpY - 24, 44, 30);
}

function drawSpeedLines(ctx, w, h, cx, cy, v) {
  const n = 10;
  const alpha = Math.min(0.2, v * 0.1);
  ctx.save();
  ctx.strokeStyle = `rgba(14, 124, 123, ${alpha})`;
  ctx.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + v * 0.4;
    const rInner = 14, rOuter = 14 + Math.min(1, v / 1.5) * (Math.max(w, h) * 0.5);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * rInner, cy + Math.sin(a) * rInner);
    ctx.lineTo(cx + Math.cos(a) * rOuter, cy + Math.sin(a) * rOuter);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHeatSource(ctx, w, h, cx, cy, f, t) {
  if (!f) return;
  const heat = 0.4 + Math.sin(t * 0.5) * 0.15;
  const hx = cx + Math.sin(t * 0.2) * w * 0.14;
  const hy = h * 0.62 + Math.cos(t * 0.2) * h * 0.05;
  const r = 26 + heat * 40;

  const grad = ctx.createRadialGradient(hx, hy, 0, hx, hy, r);
  grad.addColorStop(0, `rgba(232, 89, 12, ${0.4 * heat})`);
  grad.addColorStop(0.6, `rgba(217, 45, 32, ${0.2 * heat})`);
  grad.addColorStop(1, "rgba(217, 45, 32, 0)");
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(hx, hy, r, 0, 7); ctx.fill();
}

function drawGrain(ctx, w, h, t) {
  const n = 35;
  ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
  for (let i = 0; i < n; i++) {
    const gx = (Math.sin(i * 12.9898 + t * 7) * 43758.5453) % 1;
    const gy = (Math.sin(i * 78.233 + t * 5) * 12543.132) % 1;
    ctx.fillRect(((gx + 1) % 1) * w, ((gy + 1) % 1) * h, 1, 1);
  }
}

function drawScanlines(ctx, w, h, t) {
  ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
  ctx.lineWidth = 1;
  const offset = (t * 14) % 3;
  ctx.beginPath();
  for (let y = -3 + offset; y < h; y += 3) {
    ctx.moveTo(0, y); ctx.lineTo(w, y);
  }
  ctx.stroke();
}

function CrosshairOverlay() {
  return (
    <svg
      className="absolute inset-0 w-full h-full opacity-10 pointer-events-none"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <line x1="50" y1="0" x2="50" y2="100" stroke="currentColor" strokeWidth="0.2" className="text-telemetry" />
      <line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" strokeWidth="0.2" className="text-telemetry" />
      <circle cx="50" cy="50" r="8" fill="none" stroke="currentColor" strokeWidth="0.2" className="text-telemetry" />
    </svg>
  );
}

function CornerBrackets() {
  const size = 16;
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
          className="absolute opacity-25 pointer-events-none text-telemetry"
          style={{ ...pos, transform: `rotate(${pos.rotate}deg)` }}
        >
          <path d="M1 8 V1 H8" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ))}
    </>
  );
}
