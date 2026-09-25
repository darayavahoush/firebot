import React, { useEffect, useRef } from "react";

// Palette pulled from tailwind.config.js — the canvas is a deliberately dark
// "instrument screen" (matches the camera/thermal viewport's `scope` color)
// sitting inside the light industrial-HMI shell, not a leftover dark theme.
const COLORS = {
  bg: "#12110D",
  floor: "#1C1A14",
  wall: "#4A473C",
  wallEdgeLight: "rgba(247,243,232,0.16)",
  wallEdgeDark: "rgba(0,0,0,0.35)",
  prop: "#312F27",
  propHatch: "rgba(247,243,232,0.06)",
  grid: "rgba(247,243,232,0.035)",
  gridMajor: "rgba(247,243,232,0.09)",
  axis: "rgba(247,243,232,0.45)",
  robot: "#3FA7D6",
  robotHeading: "#EAE7E0",
  fireTrue: "#E14A3A",
  fireEst: "#D69A3C",
  ellipse: "rgba(214,154,60,0.25)",
  path: "#4CAF6D",
  tree: "rgba(63,167,214,0.22)",
  visited: "rgba(247,243,232,0.045)",
  spray: "#3FA7D6",
  cone: "rgba(63,167,214,0.09)",
};

export default function SimCanvas({ engineRef, showTree, showSensors, height = 560 }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    function draw() {
      rafRef.current = requestAnimationFrame(draw);
      const controller = engineRef.current;
      if (!controller || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth, cssH = height;
      if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
        canvas.width = cssW * dpr; canvas.height = cssH * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, cssW, cssH);

      const world = controller.world;
      const pad = 30;
      const scale = Math.min((cssW - pad * 2) / world.width, (cssH - pad * 2) / world.height);
      const ox = (cssW - world.width * scale) / 2, oy = (cssH - world.height * scale) / 2;
      const X = (x) => ox + x * scale, Y = (y) => oy + y * scale;

      // floor
      ctx.fillStyle = COLORS.floor;
      ctx.fillRect(X(0), Y(0), world.width * scale, world.height * scale);

      // grid: minor every 1m, major every 5m, with axis tick labels in meters
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.strokeStyle = COLORS.grid;
      for (let gx = 0; gx <= world.width; gx++) {
        if (gx % 5 === 0) continue;
        ctx.moveTo(X(gx), Y(0)); ctx.lineTo(X(gx), Y(world.height));
      }
      for (let gy = 0; gy <= world.height; gy++) {
        if (gy % 5 === 0) continue;
        ctx.moveTo(X(0), Y(gy)); ctx.lineTo(X(world.width), Y(gy));
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.strokeStyle = COLORS.gridMajor;
      for (let gx = 0; gx <= world.width; gx += 5) { ctx.moveTo(X(gx), Y(0)); ctx.lineTo(X(gx), Y(world.height)); }
      for (let gy = 0; gy <= world.height; gy += 5) { ctx.moveTo(X(0), Y(gy)); ctx.lineTo(X(world.width), Y(gy)); }
      ctx.stroke();

      ctx.fillStyle = COLORS.axis;
      ctx.font = "9px 'JetBrains Mono', monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      for (let gx = 0; gx <= world.width; gx += 5) ctx.fillText(`${gx}m`, X(gx), Y(world.height) + 4);
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      for (let gy = 0; gy <= world.height; gy += 5) ctx.fillText(`${gy}m`, X(0) - 5, Y(gy));

      // walls / props — beveled edges + hatch on props so they read as distinct
      for (const w of world.walls) {
        const px = X(w.x), py = Y(w.y), pw = w.w * scale, ph = w.h * scale;
        ctx.fillStyle = w.prop ? COLORS.prop : COLORS.wall;
        ctx.fillRect(px, py, pw, ph);
        ctx.strokeStyle = COLORS.wallEdgeLight; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, py + ph); ctx.lineTo(px, py); ctx.lineTo(px + pw, py); ctx.stroke();
        ctx.strokeStyle = COLORS.wallEdgeDark;
        ctx.beginPath(); ctx.moveTo(px + pw, py); ctx.lineTo(px + pw, py + ph); ctx.lineTo(px, py + ph); ctx.stroke();
        if (w.prop) {
          ctx.save();
          ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();
          ctx.strokeStyle = COLORS.propHatch; ctx.lineWidth = 1;
          ctx.beginPath();
          for (let d = -ph; d < pw; d += 6) { ctx.moveTo(px + d, py + ph); ctx.lineTo(px + d + ph, py); }
          ctx.stroke();
          ctx.restore();
        }
      }

      // visited trail (exploration coverage)
      if (controller.visited?.length) {
        ctx.fillStyle = COLORS.visited;
        for (const [vx, vy] of controller.visited) {
          ctx.beginPath(); ctx.arc(X(vx), Y(vy), Math.max(2, 0.35 * scale), 0, 7); ctx.fill();
        }
      }

      // RRT* tree
      if (showTree && controller.tree?.length) {
        ctx.strokeStyle = COLORS.tree; ctx.lineWidth = 1;
        ctx.beginPath();
        for (const [a, b] of controller.tree) { ctx.moveTo(X(a[0]), Y(a[1])); ctx.lineTo(X(b[0]), Y(b[1])); }
        ctx.stroke();
      }

      // planned path
      if (controller.path?.length > 1) {
        ctx.strokeStyle = COLORS.path; ctx.lineWidth = 2.5; ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(X(controller.path[0][0]), Y(controller.path[0][1]));
        for (const p of controller.path.slice(1)) ctx.lineTo(X(p[0]), Y(p[1]));
        ctx.stroke();
        if (controller.goal) {
          ctx.fillStyle = COLORS.path;
          ctx.beginPath(); ctx.arc(X(controller.goal[0]), Y(controller.goal[1]), 4, 0, 7); ctx.fill();
        }
      }

      // fire estimate + uncertainty ellipse
      const est = controller.eif.estimate();
      const sigma = Math.sqrt(Math.max(est.P[0][0], est.P[1][1], 1e-9));
      if (sigma < 20 && est.x > -2 && est.x < world.width + 2 && est.y > -2 && est.y < world.height + 2) {
        const rx = Math.min(Math.sqrt(Math.max(est.P[0][0], 1e-6)) * scale * 2, cssW);
        const ry = Math.min(Math.sqrt(Math.max(est.P[1][1], 1e-6)) * scale * 2, cssH);
        ctx.fillStyle = COLORS.ellipse;
        ctx.beginPath(); ctx.ellipse(X(est.x), Y(est.y), Math.max(4, rx), Math.max(4, ry), 0, 0, 7); ctx.fill();
        ctx.strokeStyle = COLORS.fireEst; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(X(est.x) - 6, Y(est.y)); ctx.lineTo(X(est.x) + 6, Y(est.y));
        ctx.moveTo(X(est.x), Y(est.y) - 6); ctx.lineTo(X(est.x), Y(est.y) + 6); ctx.stroke();
      }

      // true fire
      const fire = controller.fire;
      if (fire.p > 0) {
        const r = 5 + 4 * fire.p;
        const grad = ctx.createRadialGradient(X(fire.x), Y(fire.y), 0, X(fire.x), Y(fire.y), r * 3);
        grad.addColorStop(0, "rgba(225,74,58,0.5)"); grad.addColorStop(1, "rgba(225,74,58,0)");
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(X(fire.x), Y(fire.y), r * 3, 0, 7); ctx.fill();
        ctx.fillStyle = COLORS.fireTrue;
        ctx.beginPath(); ctx.arc(X(fire.x), Y(fire.y), r, 0, 7); ctx.fill();
      }

      // robot
      const { x: rx0, y: ry0, th } = controller.robot;
      if (showSensors) {
        ctx.fillStyle = COLORS.cone;
        ctx.beginPath(); ctx.moveTo(X(rx0), Y(ry0));
        ctx.arc(X(rx0), Y(ry0), 9 * scale, th - 0.48, th + 0.48);
        ctx.closePath(); ctx.fill();
      }
      ctx.save();
      ctx.translate(X(rx0), Y(ry0)); ctx.rotate(th);
      const rr = Math.max(6, 0.22 * scale);
      ctx.fillStyle = controller.mode === "STOPPED" ? COLORS.fireTrue : COLORS.robot;
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, 7); ctx.fill();
      ctx.fillStyle = COLORS.robotHeading;
      ctx.beginPath(); ctx.moveTo(rr * 1.5, 0); ctx.lineTo(-rr * 0.3, rr * 0.8); ctx.lineTo(-rr * 0.3, -rr * 0.8); ctx.closePath(); ctx.fill();
      if (controller.pumpOn) {
        ctx.strokeStyle = COLORS.spray; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(rr, 0); ctx.lineTo(rr + 14, 0); ctx.stroke();
      }
      ctx.restore();

      // scale bar, bottom-right
      const barM = world.width > 20 ? 5 : 1;
      const barPx = barM * scale, bx = cssW - pad - barPx, by = cssH - 14;
      ctx.strokeStyle = COLORS.axis; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by); ctx.lineTo(bx + barPx, by); ctx.lineTo(bx + barPx, by - 4);
      ctx.stroke();
      ctx.fillStyle = COLORS.axis; ctx.font = "9px 'JetBrains Mono', monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillText(`${barM} m`, bx + barPx / 2, by - 6);
    }
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [engineRef, showTree, showSensors, height]);

  return <canvas ref={canvasRef} style={{ width: "100%", height }} className="block" />;
}
