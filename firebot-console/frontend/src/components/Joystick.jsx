import React, { useEffect, useRef, useState } from "react";

const R = 64, DEAD = 0.08, TICK_MS = 120;

// Analog drive stick. Up = forward speed, sideways = turn; there is no reverse gear.
// While held it re-sends every TICK_MS so the brain's 0.5 s dead-man timer never trips;
// letting go (or leaving the page) sends an explicit stop.
export default function Joystick({ enabled, onMove }) {
  const base = useRef(null), timer = useRef(null), cur = useRef({ v: 0, w: 0 });
  const [p, setP] = useState({ x: 0, y: 0 });

  const stop = (why) => {
    clearInterval(timer.current); timer.current = null;
    cur.current = { v: 0, w: 0 }; setP({ x: 0, y: 0 });
    onMove?.({ v: 0, w: 0, log: why });
  };
  useEffect(() => () => clearInterval(timer.current), []);
  useEffect(() => { if (!enabled && timer.current) stop("released"); }, [enabled]);

  const update = (e) => {
    const r = base.current.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const m = Math.hypot(dx, dy), k = m > R ? R / m : 1;
    dx *= k; dy *= k; setP({ x: dx, y: dy });
    const v = Math.max(0, -dy / R), w = -dx / R; // +w is counter-clockwise (left)
    cur.current = Math.hypot(dx, dy) / R < DEAD ? { v: 0, w: 0 } : { v, w };
  };
  const down = (e) => {
    if (!enabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    update(e);
    onMove?.({ ...cur.current, log: "engaged" });
    timer.current = setInterval(() => onMove?.({ ...cur.current }), TICK_MS);
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={base} onPointerDown={down} onPointerMove={(e) => timer.current && update(e)}
        onPointerUp={() => timer.current && stop("released")} onPointerCancel={() => timer.current && stop("released")}
        className={`relative touch-none select-none rounded-full border border-line ${enabled ? "cursor-grab" : "opacity-40"}`}
        style={{ width: R * 2 + 32, height: R * 2 + 32, background: "radial-gradient(circle, #211736 0%, #171027 70%)" }}
        role="application" aria-label="Drive stick. Push up to go forward, sideways to turn.">
        <div className="absolute left-1/2 top-1/2 w-[2px] h-[70%] -translate-x-1/2 -translate-y-1/2 bg-line" />
        <div className="absolute left-1/2 top-1/2 h-[2px] w-[70%] -translate-x-1/2 -translate-y-1/2 bg-line" />
        <div className="absolute left-1/2 top-1/2 w-14 h-14 -ml-7 -mt-7 rounded-full"
          style={{ transform: `translate(${p.x}px, ${p.y}px)`, transition: timer.current ? "none" : "transform .18s",
            background: "linear-gradient(135deg,#c4286f,#ff8a2a)", boxShadow: "0 6px 18px -6px rgba(196,40,111,.7)" }} />
      </div>
      <span className="text-[12px] text-faint">No reverse gear, so the lower half stops the robot</span>
    </div>
  );
}
