import React, { useEffect, useRef } from "react";

const ROWS = 24, COLS = 32, CW = 640, CH = 480;
const STOPS = [[0, [14, 8, 32]], [.25, [90, 26, 134]], [.5, [196, 40, 111]], [.75, [255, 138, 42]], [1, [255, 242, 201]]];

function colorFor(t) {
  const v = Math.max(0, Math.min(1, (t - 22) / 48));
  for (let i = 1; i < STOPS.length; i++) {
    if (v <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
      const f = (v - a) / (b - a || 1);
      return ca.map((c, k) => Math.round(c + (cb[k] - c) * f));
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export default function ThermalHero({ frame }) {
  const cv = useRef(null);
  const last = useRef({ grid: null, at: 0 });
  if (frame?.thermal) last.current = { grid: frame.thermal.flat(), at: Date.now() };
  const { grid, at } = last.current;
  const live = !!frame?.thermal;
  let peak = -Infinity, pi = 0;
  if (grid) grid.forEach((v, i) => { if (v > peak) { peak = v; pi = i; } });
  const hot = grid && peak > 55;

  useEffect(() => {
    const c = cv.current, g = c.getContext("2d");
    g.fillStyle = "#0E0919"; g.fillRect(0, 0, CW, CH);
    if (!grid) return;
    const off = document.createElement("canvas"); off.width = COLS; off.height = ROWS;
    const og = off.getContext("2d"), img = og.createImageData(COLS, ROWS);
    grid.forEach((v, i) => { const [r, gg, b] = colorFor(v); img.data.set([r, gg, b, 255], i * 4); });
    og.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(off, 0, 0, CW, CH);
    const px = ((pi % COLS) + .5) / COLS * CW, py = (Math.floor(pi / COLS) + .5) / ROWS * CH;
    g.strokeStyle = "#fff2c9"; g.lineWidth = 2;
    g.beginPath(); g.arc(px, py, 16, 0, 7); g.moveTo(px - 26, py); g.lineTo(px - 10, py); g.moveTo(px + 10, py); g.lineTo(px + 26, py);
    g.moveTo(px, py - 26); g.lineTo(px, py - 10); g.moveTo(px, py + 10); g.lineTo(px, py + 26); g.stroke();
  }, [grid, pi]);

  return (
    <figure className="m-0">
      <div className="relative rounded-[12px] overflow-hidden border border-line" style={{ aspectRatio: "4 / 3", maxHeight: "60vh", background: "#0E0919" }}>
        <canvas ref={cv} width={CW} height={CH} className="w-full h-full block" role="img"
          aria-label={grid ? `Thermal camera view, hottest point ${peak.toFixed(0)} degrees Celsius` : "Thermal camera view, no data yet"} />
        {!grid && <p className="absolute inset-0 flex items-center justify-center text-muted text-[15px]">Waiting for a thermal frame from the robot…</p>}
        {grid && (
          <>
            <span className={`absolute left-3 top-3 rounded-full px-3 py-1 text-[13px] bg-base/70 backdrop-blur data ${hot ? "text-warn" : "text-ink"}`}>
              Hottest {peak.toFixed(1)} °C
            </span>
            <span className="absolute right-3 top-3 rounded-full px-3 py-1 text-[12px] bg-base/70 backdrop-blur text-muted">
              {live ? "Live" : `Held from ${Math.max(1, Math.round((Date.now() - at) / 1000))}s ago`}
            </span>
          </>
        )}
      </div>
      <figcaption className="flex items-center gap-3 mt-2 text-[12px] text-muted">
        <span className="data">22°</span>
        <span className="heatbar h-[6px] flex-1 rounded-full" />
        <span className="data">70°</span>
        <span className="hidden sm:inline">MLX90640 thermal sensor, 32 × 24 pixels</span>
      </figcaption>
    </figure>
  );
}
