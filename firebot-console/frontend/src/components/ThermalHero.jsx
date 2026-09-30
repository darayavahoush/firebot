import React, { useEffect, useRef, useState } from "react";
import { playSound } from "../lib/sound.js";

const ROWS = 24, COLS = 32, CW = 640, CH = 480;

const PALETTES = {
  ironbow: {
    label: "Ironbow",
    stops: [
      [0, [14, 8, 32]],
      [0.25, [90, 26, 134]],
      [0.5, [196, 40, 111]],
      [0.75, [255, 138, 42]],
      [1, [255, 242, 201]],
    ],
  },
  inferno: {
    label: "Inferno",
    stops: [
      [0, [10, 5, 25]],
      [0.3, [120, 28, 129]],
      [0.6, [217, 72, 38]],
      [0.85, [248, 168, 48]],
      [1, [252, 255, 164]],
    ],
  },
  arctic: {
    label: "Cyber Arctic",
    stops: [
      [0, [6, 14, 30]],
      [0.35, [14, 80, 140]],
      [0.7, [38, 200, 220]],
      [0.9, [140, 245, 255]],
      [1, [255, 255, 255]],
    ],
  },
  nvg: {
    label: "Tactical NVG",
    stops: [
      [0, [2, 18, 8]],
      [0.3, [12, 60, 24]],
      [0.6, [40, 180, 70]],
      [0.85, [110, 245, 140]],
      [1, [230, 255, 235]],
    ],
  },
};

function colorFor(t, stops) {
  const v = Math.max(0, Math.min(1, (t - 22) / 48));
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i];
      const f = (v - a) / (b - a || 1);
      return ca.map((c, k) => Math.round(c + (cb[k] - c) * f));
    }
  }
  return stops[stops.length - 1][1];
}

export default function ThermalHero({ frame }) {
  const cv = useRef(null);
  const last = useRef({ grid: null, at: 0 });
  const [paletteKey, setPaletteKey] = useState("ironbow");

  if (frame?.thermal) last.current = { grid: frame.thermal.flat(), at: Date.now() };
  const { grid, at } = last.current;
  const live = !!frame?.thermal;

  let peak = -Infinity, pi = 0;
  let min = Infinity, sum = 0;

  if (grid) {
    grid.forEach((v, i) => {
      if (v > peak) { peak = v; pi = i; }
      if (v < min) { min = v; }
      sum += v;
    });
  }
  const avg = grid ? sum / grid.length : 0;
  const hot = grid && peak > 55;

  const currentPalette = PALETTES[paletteKey] || PALETTES.ironbow;

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const g = c.getContext("2d");
    g.fillStyle = "#0E0919";
    g.fillRect(0, 0, CW, CH);

    if (!grid) return;

    const off = document.createElement("canvas");
    off.width = COLS;
    off.height = ROWS;
    const og = off.getContext("2d");
    const img = og.createImageData(COLS, ROWS);

    grid.forEach((v, i) => {
      const [r, gg, b] = colorFor(v, currentPalette.stops);
      img.data.set([r, gg, b, 255], i * 4);
    });
    og.putImageData(img, 0, 0);

    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(off, 0, 0, CW, CH);

    // Reticle crosshair and targeting lock around hottest peak
    const px = (((pi % COLS) + 0.5) / COLS) * CW;
    const py = ((Math.floor(pi / COLS) + 0.5) / ROWS) * CH;

    // Glowing target bracket
    g.strokeStyle = hot ? "#FF4A2B" : "#FFF2C9";
    g.lineWidth = 2;
    g.shadowColor = hot ? "rgba(255,74,43,0.8)" : "rgba(255,242,201,0.6)";
    g.shadowBlur = 8;

    // Target reticle ring
    g.beginPath();
    g.arc(px, py, 20, 0, Math.PI * 2);
    g.stroke();

    // Crosshair ticks
    g.beginPath();
    g.moveTo(px - 32, py); g.lineTo(px - 10, py);
    g.moveTo(px + 10, py); g.lineTo(px + 32, py);
    g.moveTo(px, py - 32); g.lineTo(px, py - 10);
    g.moveTo(px, py + 10); g.lineTo(px, py + 32);
    g.stroke();

    g.shadowBlur = 0; // reset
  }, [grid, pi, paletteKey, hot, currentPalette]);

  const selectPalette = (k) => {
    playSound("click");
    setPaletteKey(k);
  };

  return (
    <figure className="m-0 panel p-4">
      {/* Top Header Controls */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-line gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="font-display font-bold text-[15px] tracking-tight text-ink flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-telemetry animate-pulse" />
            FLIR MLX90640 Thermal Imager
          </span>
          <span className="text-[11px] font-mono text-faint bg-panel2 px-2 py-0.5 rounded border border-line">
            32 × 24 ARRAY
          </span>
        </div>

        {/* Color Palette Switcher */}
        <div className="flex items-center gap-1 rounded-lg bg-panel2 p-1 border border-line" role="group" aria-label="Color Palette">
          {Object.entries(PALETTES).map(([k, v]) => (
            <button
              key={k}
              onClick={() => selectPalette(k)}
              data-on={paletteKey === k}
              className={`text-[11px] font-mono px-2.5 py-1 rounded-md transition-all ${
                paletteKey === k
                  ? "bg-telemetry text-base font-bold shadow-[0_0_8px_rgba(240,85,155,0.4)]"
                  : "text-muted hover:text-ink"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Viewport */}
      <div
        className="relative rounded-xl overflow-hidden border border-line bg-[#0E0919] tactical-grid shadow-inner"
        style={{ aspectRatio: "4 / 3", maxHeight: "56vh" }}
      >
        <canvas
          ref={cv}
          width={CW}
          height={CH}
          className="w-full h-full block"
          role="img"
          aria-label={grid ? `Thermal view, peak ${peak.toFixed(0)} degrees` : "Thermal sensor awaiting data"}
        />

        {/* HUD Corner Reticles */}
        <div className="absolute top-2.5 left-2.5 text-[10px] font-mono text-[#F1ECFA]/40 select-none">
          ┌ REC 01
        </div>
        <div className="absolute top-2.5 right-2.5 text-[10px] font-mono text-[#F1ECFA]/40 select-none">
          FLIR 72° FOV ┐
        </div>
        <div className="absolute bottom-2.5 left-2.5 text-[10px] font-mono text-[#F1ECFA]/40 select-none">
          └ SENSOR: MLX90640
        </div>
        <div className="absolute bottom-2.5 right-2.5 text-[10px] font-mono text-[#F1ECFA]/40 select-none">
          GRID 768px ┘
        </div>

        {!grid && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted gap-2 bg-base/60 backdrop-blur-sm">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin text-telemetry">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <p className="text-[14px] font-mono">Calibrating thermal sensor array…</p>
          </div>
        )}

        {grid && (
          <>
            {/* Top Status Badges */}
            <div className="absolute left-3 top-3 flex items-center gap-2">
              <span className={`rounded-lg px-3 py-1.5 text-[12px] font-mono font-bold backdrop-blur-md border shadow-lg ${
                hot
                  ? "bg-alarm/25 border-alarm/50 text-white shadow-[0_0_12px_rgba(255,74,43,0.4)]"
                  : "bg-base/80 border-line text-ink"
              }`}>
                PEAK {peak.toFixed(1)} °C
              </span>
              {hot && (
                <span className="rounded-lg px-2.5 py-1.5 text-[11px] font-mono font-bold bg-alarm text-base flex items-center gap-1.5 animate-pulse">
                  <span>🔥</span> FIRE SIGNATURE
                </span>
              )}
            </div>

            <div className="absolute right-3 top-3">
              <span className="rounded-lg px-2.5 py-1 text-[11px] font-mono bg-base/80 backdrop-blur-md border border-line text-muted">
                {live ? "● STREAMING" : `HELD ${Math.max(1, Math.round((Date.now() - at) / 1000))}s AGO`}
              </span>
            </div>

            {/* Bottom HUD stats */}
            <div className="absolute bottom-3 inset-x-3 flex items-center justify-between px-3 py-1.5 rounded-lg bg-base/85 backdrop-blur-md border border-line text-[11px] font-mono">
              <div className="flex items-center gap-4 text-muted">
                <span>MIN: <b className="text-ink">{min.toFixed(1)}°C</b></span>
                <span>AVG: <b className="text-ink">{avg.toFixed(1)}°C</b></span>
                <span>HOT CELL: <b className="text-telemetry">[{pi % COLS}, {Math.floor(pi / COLS)}]</b></span>
              </div>
              <span className="text-faint">RANGE: 22°–70°C</span>
            </div>
          </>
        )}
      </div>

      {/* Calibration Spectrum Footnote */}
      <figcaption className="flex items-center gap-3 mt-3 text-[12px] text-muted">
        <span className="data font-mono font-bold text-faint">22°C</span>
        <div className="flex-1 h-2 rounded-full overflow-hidden border border-line">
          <div
            className="h-full w-full"
            style={{
              background: `linear-gradient(90deg, ${currentPalette.stops
                .map(([pos, rgb]) => `rgb(${rgb.join(",")}) ${pos * 100}%`)
                .join(", ")})`,
            }}
          />
        </div>
        <span className="data font-mono font-bold text-warn">70°C+</span>
      </figcaption>
    </figure>
  );
}
