import React, { useEffect, useRef } from "react";
import { PanelHeader } from "./TelemetryGauges.jsx";

// Real camera render, driven by live telemetry. When a real 24x32 thermal
// grid is available (frames.thermal, sent every Nth frame — see
// src/firebot/link/pg.py) it's drawn as a color-mapped heatmap overlay on
// top of the synthetic corridor scene. Until the first real thermal frame
// arrives, a lightweight ambient heat blob fills in so the feed doesn't sit
// blank — it's cosmetic only and never reads real sensor data.
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
  const rafRef = useRef(null);
  const frameRef = useRef(frame);
  const thermalRef = useRef(null); // last known real thermal grid, persists between polls
  frameRef.current = frame;
  if (frame?.thermal) thermalRef.current = frame.thermal;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    function draw(now) {
      rafRef.current = requestAnimationFrame(draw);
      const el = canvas.parentElement;
      const dpr = window.devicePixelRatio || 1;
      const cssW = el.clientWidth, cssH = el.clientHeight;
      if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
        canvas.width = cssW * dpr; canvas.height = cssH * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const t = now / 1000;
      const f = frameRef.current;
      const cx = cssW / 2, cy = cssH * 0.42;

      drawCorridor(ctx, cssW, cssH, cx, cy, f, t);
      if (thermalRef.current) {
        drawThermalOverlay(ctx, cssW, cssH, thermalRef.current);
      } else {
        drawHeatSource(ctx, cssW, cssH, cx, cy, f, t);
      }
      drawGrain(ctx, cssW, cssH, t);
      drawScanlines(ctx, cssW, cssH, t);
    }
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const peak = thermalPeak(thermalRef.current);

  return (
    <div className="panel h-full flex flex-col">
      <PanelHeader
        label="Forward Camera"
        right={
          <span className="font-mono text-[11px] text-faint">
            {frame ? `t+${frame.t.toFixed(1)}s` : "—"}
          </span>
        }
      />
      <div className="border-t border-line flex-1 relative bg-scope min-h-[280px] overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

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

        {frame && peak != null && (
          <div className="absolute bottom-8 left-3 font-mono text-[10px] text-[#E8A33D]">
            THERMAL PEAK {peak.toFixed(1)}°C
          </div>
        )}
      </div>
    </div>
  );
}

// Color-mapped 24x32 thermal grid, alpha-blended over the corridor scene.
// Cool-to-hot palette (blue -> teal -> amber -> red), normalized per-frame
// so a cold room and a fire both render with visible contrast.
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

  // target-lock box around the hottest cell
  let hr = 0, hc = 0, hv = -Infinity;
  for (let r = 0; r < THERM_ROWS; r++) {
    for (let c = 0; c < THERM_COLS; c++) {
      if (thermal[r][c] > hv) { hv = thermal[r][c]; hr = r; hc = c; }
    }
  }
  const hx = (hc + 0.5) * cellW, hy = (hr + 0.5) * cellH;
  const boxR = Math.max(cellW, cellH) * 1.6;
  ctx.strokeStyle = "rgba(244,185,66,0.85)";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(hx - boxR, hy - boxR, boxR * 2, boxR * 2);
  ctx.font = "9px 'JetBrains Mono', monospace";
  ctx.fillStyle = "rgba(244,185,66,0.9)";
  ctx.textAlign = "left"; ctx.textBaseline = "bottom";
  ctx.fillText(`HEAT ${hv.toFixed(0)}\u00B0C`, hx - boxR, hy - boxR - 3);
}

function thermalColor(norm) {
  const stops = [
    [0.0, [20, 40, 120]],
    [0.35, [40, 140, 160]],
    [0.65, [232, 163, 61]],
    [1.0, [225, 74, 58]],
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

// A simple one-point-perspective corridor: floor, two side walls, a door at
// the vanishing point, and a couple of structural beams for texture — reads
// immediately as "inside a building", which is what the demo needs to sell.
function drawCorridor(ctx, w, h, cx, cy, f, t) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#0B120F");
  bg.addColorStop(1, "#050807");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const vpX = cx + Math.sin(t * 0.15) * 4, vpY = cy;
  const floorY = h * 0.98, ceilY = h * 0.04;
  const leftX = w * 0.02, rightX = w * 0.98;

  // floor
  ctx.fillStyle = "#141B16";
  ctx.beginPath();
  ctx.moveTo(leftX, floorY); ctx.lineTo(rightX, floorY);
  ctx.lineTo(vpX + 40, vpY + 6); ctx.lineTo(vpX - 40, vpY + 6);
  ctx.closePath(); ctx.fill();

  // floor seams converging to the vanishing point
  ctx.strokeStyle = "rgba(127,216,160,0.10)"; ctx.lineWidth = 1;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + i * 46, floorY);
    ctx.lineTo(vpX + i * 6, vpY + 6);
    ctx.stroke();
  }

  // ceiling
  ctx.fillStyle = "#0E1512";
  ctx.beginPath();
  ctx.moveTo(leftX, ceilY); ctx.lineTo(rightX, ceilY);
  ctx.lineTo(vpX + 40, vpY - 30); ctx.lineTo(vpX - 40, vpY - 30);
  ctx.closePath(); ctx.fill();

  // side walls
  ctx.fillStyle = "#161F1A";
  ctx.beginPath();
  ctx.moveTo(leftX, ceilY); ctx.lineTo(leftX, floorY);
  ctx.lineTo(vpX - 40, vpY + 6); ctx.lineTo(vpX - 40, vpY - 30);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(rightX, ceilY); ctx.lineTo(rightX, floorY);
  ctx.lineTo(vpX + 40, vpY + 6); ctx.lineTo(vpX + 40, vpY - 30);
  ctx.closePath(); ctx.fill();

  // structural beams
  ctx.strokeStyle = "rgba(127,216,160,0.14)"; ctx.lineWidth = 1;
  for (const frac of [0.25, 0.55, 0.8]) {
    const bx1 = leftX + (vpX - 40 - leftX) * frac, by1t = ceilY + (vpY - 30 - ceilY) * frac, by1b = floorY + (vpY + 6 - floorY) * frac;
    const bx2 = rightX + (vpX + 40 - rightX) * frac;
    ctx.beginPath(); ctx.moveTo(bx1, by1t); ctx.lineTo(bx1, by1b); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx2, by1t); ctx.lineTo(bx2, by1b); ctx.stroke();
  }

  // door at the far end
  ctx.fillStyle = "#0A100C";
  ctx.fillRect(vpX - 22, vpY - 24, 44, 30);
  ctx.strokeStyle = "rgba(127,216,160,0.25)"; ctx.lineWidth = 1;
  ctx.strokeRect(vpX - 22, vpY - 24, 44, 30);
}

// Ambient heat blob shown only until the first real thermal frame arrives —
// purely cosmetic (time-driven), so the feed doesn't sit blank on load, and
// deliberately doesn't read any real telemetry field.
function drawHeatSource(ctx, w, h, cx, cy, f, t) {
  if (!f) return;
  const heat = 0.4 + Math.sin(t * 0.5) * 0.15;
  const hx = cx + Math.sin(t * 0.2) * w * 0.14;
  const hy = h * 0.62 + Math.cos(t * 0.2) * h * 0.05;
  const r = 26 + heat * 40;

  const grad = ctx.createRadialGradient(hx, hy, 0, hx, hy, r);
  grad.addColorStop(0, `rgba(232,163,61,${0.4 * heat})`);
  grad.addColorStop(0.6, `rgba(225,74,58,${0.2 * heat})`);
  grad.addColorStop(1, "rgba(225,74,58,0)");
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(hx, hy, r, 0, 7); ctx.fill();
}

// Cheap per-frame grain so the feed reads as a live sensor, not a still image.
function drawGrain(ctx, w, h, t) {
  const n = 40;
  ctx.fillStyle = "rgba(127,216,160,0.05)";
  for (let i = 0; i < n; i++) {
    const gx = (Math.sin(i * 12.9898 + t * 7) * 43758.5453) % 1;
    const gy = (Math.sin(i * 78.233 + t * 5) * 12543.132) % 1;
    ctx.fillRect(((gx + 1) % 1) * w, ((gy + 1) % 1) * h, 1, 1);
  }
}

// Slow-scrolling scanlines, the classic "instrument camera" tell.
function drawScanlines(ctx, w, h, t) {
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
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
