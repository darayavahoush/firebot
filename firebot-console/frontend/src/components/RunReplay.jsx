import React, { useEffect, useMemo, useRef, useState } from "react";
import ThermalFrame from "./ThermalFrame.jsx";

// Same default room the brain plans in (firebot.sim.world.DEFAULT_WALLS).
const W = 12, H = 8, CW = 960, CH = 640;
const WALLS = [[0, 0, 12, .1], [0, 7.9, 12, .1], [0, 0, .1, 8], [11.9, 0, .1, 8], [3, 1.5, .3, 3.5], [6.5, 3.5, 3, .3], [7.5, 6, .3, 1.9]];
const STOPS = [[0, [90, 26, 134]], [.5, [196, 40, 111]], [.75, [255, 138, 42]], [1, [255, 242, 201]]];
const RATES = [1, 4, 16];
const sx = (x) => (x / W) * CW;
const sy = (y) => CH - (y / H) * CH;

function heat(v) {
  for (let i = 1; i < STOPS.length; i++) {
    if (v <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
      const f = (v - a) / (b - a || 1);
      return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * f)).join(",")})`;
    }
  }
  return "rgb(255,242,201)";
}
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function RunReplay({ points, anomalies = [], seek, onT }) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(4);
  const canvas = useRef(null);
  const n = points.length;
  const tmax = n ? points[n - 1].t : 0;

  const thermalAt = useMemo(() => {
    let last = -1;
    return points.map((p, i) => (p.thermal ? (last = i) : last));
  }, [points]);

  useEffect(() => { setIdx(0); setPlaying(false); }, [points]);
  useEffect(() => {
    if (!seek || !n) return;
    let best = 0;
    for (let i = 0; i < n; i++) if (points[i].t <= seek.t) best = i;
    setIdx(best); setPlaying(false);
  }, [seek]);
  useEffect(() => {
    if (!playing) return;
    const h = setInterval(() => setIdx((i) => {
      if (i + rate >= n - 1) { setPlaying(false); return n - 1; }
      return i + rate;
    }), 100);
    return () => clearInterval(h);
  }, [playing, rate, n]);
  useEffect(() => { if (n) onT?.(points[Math.min(idx, n - 1)].t); }, [idx, points]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !n) return;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, CW, CH);
    g.fillStyle = "#0C0E12"; g.fillRect(0, 0, CW, CH);
    g.fillStyle = "rgba(255, 255, 255, 0.12)";
    WALLS.forEach(([x, y, w, h]) => g.fillRect(sx(x), sy(y + h), (w / W) * CW, (h / H) * CH));
    g.lineWidth = 3; g.lineCap = "round";
    for (let i = 1; i <= idx; i++) {
      g.strokeStyle = heat(i / Math.max(idx, 1));
      g.beginPath(); g.moveTo(sx(points[i - 1].x), sy(points[i - 1].y)); g.lineTo(sx(points[i].x), sy(points[i].y)); g.stroke();
    }
    const p = points[idx];
    if (p.est_x != null) {
      const r = 16 + Math.min(Math.max(p.est_sigma ?? 4, 0.1), 4) * 34;
      const grd = g.createRadialGradient(sx(p.est_x), sy(p.est_y), 0, sx(p.est_x), sy(p.est_y), r);
      grd.addColorStop(0, "rgba(232, 89, 12, 0.55)"); grd.addColorStop(1, "rgba(196, 40, 111, 0)");
      g.fillStyle = grd; g.beginPath(); g.arc(sx(p.est_x), sy(p.est_y), r, 0, 7); g.fill();
      g.strokeStyle = "rgba(255, 242, 201, 0.8)"; g.setLineDash([5, 5]); g.lineWidth = 1.5;
      g.beginPath(); g.arc(sx(p.est_x), sy(p.est_y), r * .55, 0, 7); g.stroke(); g.setLineDash([]);
    }
    const rx = sx(p.x), ry = sy(p.y), a = -p.theta;
    if (p.cmd_pump) {
      g.fillStyle = "rgba(14, 124, 123, 0.35)"; g.beginPath(); g.moveTo(rx, ry);
      g.arc(rx, ry, 120, a - .22, a + .22); g.closePath(); g.fill();
    }
    g.fillStyle = "#FFFFFF"; g.beginPath(); g.arc(rx, ry, 11, 0, 7); g.fill();
    g.strokeStyle = "rgb(14, 124, 123)"; g.lineWidth = 3;
    g.beginPath(); g.moveTo(rx, ry); g.lineTo(rx + Math.cos(a) * 20, ry + Math.sin(a) * 20); g.stroke();
  }, [points, idx]);

  if (!n) return <p className="text-muted text-[13px] py-6">This run has no recorded frames to replay.</p>;
  const p = points[Math.min(idx, n - 1)];
  const th = thermalAt[idx] >= 0 ? points[thermalAt[idx]].thermal.flat() : null;

  return (
    <div className="panel p-4 space-y-4">
      <div className="grid gap-4 md:grid-cols-[1fr_auto] items-start">
        <canvas
          ref={canvas}
          width={CW}
          height={CH}
          className="w-full rounded-lg border border-line bg-scope block"
          role="img"
          aria-label="Top-down replay of the robot path"
        />
        <div className="flex md:flex-col gap-4 items-start">
          <ThermalFrame frame={th} width={200} height={150} />
          <dl className="text-[12px] grid grid-cols-[auto_auto] gap-x-4 gap-y-1.5 w-full">
            <dt className="text-muted">Time</dt><dd className="data font-medium text-ink">{clock(p.t)} / {clock(tmax)}</dd>
            <dt className="text-muted">Tank</dt><dd className="data font-medium text-ink">{Math.round(p.tank * 100)}%</dd>
            <dt className="text-muted">Mode</dt><dd className="data font-medium text-ink capitalize">{p.mode ?? "n/a"}</dd>
            <dt className="text-muted">Fire fix</dt><dd className="data font-medium text-telemetry">{p.est_sigma != null ? `±${p.est_sigma.toFixed(1)} m` : "none"}</dd>
            <dt className="text-muted">Pump</dt><dd className={`data font-medium ${p.cmd_pump ? "text-ok" : "text-faint"}`}>{p.cmd_pump ? "Spraying" : "Off"}</dd>
          </dl>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2 border-t border-line">
        <button
          type="button"
          className="btn !py-1 !px-3 text-[12px]"
          onClick={() => { if (idx >= n - 1) setIdx(0); setPlaying(!playing); }}
        >
          {playing ? "Pause" : idx >= n - 1 ? "Replay" : "Play"}
        </button>

        <div className="relative flex-1">
          <div className="absolute inset-x-0 -top-2.5 h-2 pointer-events-none">
            {anomalies.map((a, k) => (
              <span
                key={k}
                title={a.message}
                className="absolute w-[3px] h-2 rounded-full"
                style={{
                  left: `${(a.t / (tmax || 1)) * 100}%`,
                  background: a.severity === "info" ? "rgb(var(--c-telemetry))" : "rgb(var(--c-flame))",
                }}
              />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={n - 1}
            value={idx}
            aria-label="Scrub through the run"
            onChange={(e) => { setIdx(+e.target.value); setPlaying(false); }}
            className="w-full accent-telemetry"
          />
        </div>

        <div className="flex gap-1" role="group" aria-label="Playback speed">
          {RATES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRate(r)}
              className={`chip text-[11px] ${rate === r ? "!bg-telemetry/15 !text-telemetry !border-telemetry/30 font-semibold" : ""}`}
            >
              {r}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
