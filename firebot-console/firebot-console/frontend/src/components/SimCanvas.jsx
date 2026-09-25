import React, { useEffect, useRef } from "react";

const COLORS = {
  bg: "#0F1417",
  floor: "#141A1F",
  wall: "#39434C",
  prop: "#2A323A",
  grid: "rgba(255,255,255,0.025)",
  robot: "#3FA7D6",
  robotHeading: "#E7EDF2",
  fireTrue: "#E8432F",
  fireEst: "#F5A623",
  ellipse: "rgba(245,166,35,0.35)",
  path: "#4CAF6D",
  tree: "rgba(63,167,214,0.18)",
  visited: "rgba(255,255,255,0.05)",
  spray: "#3FA7D6",
  cone: "rgba(63,167,214,0.08)",
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
      const pad = 18;
      const scale = Math.min((cssW - pad * 2) / world.width, (cssH - pad * 2) / world.height);
      const ox = (cssW - world.width * scale) / 2, oy = (cssH - world.height * scale) / 2;
      const X = (x) => ox + x * scale, Y = (y) => oy + y * scale;

      // floor
      ctx.fillStyle = COLORS.floor;
      ctx.fillRect(X(0), Y(0), world.width * scale, world.height * scale);
      // faint 1m grid
      ctx.strokeStyle = COLORS.grid; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = 0; gx <= world.width; gx++) { ctx.moveTo(X(gx), Y(0)); ctx.lineTo(X(gx), Y(world.height)); }
      for (let gy = 0; gy <= world.height; gy++) { ctx.moveTo(X(0), Y(gy)); ctx.lineTo(X(world.width), Y(gy)); }
      ctx.stroke();

      // walls / props
      for (const w of world.walls) {
        ctx.fillStyle = w.prop ? COLORS.prop : COLORS.wall;
        ctx.fillRect(X(w.x), Y(w.y), w.w * scale, w.h * scale);
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

      // true fire (ground truth -- shown for the demo; the robot only ever acts on the estimate)
      const fire = controller.fire;
      if (fire.p > 0) {
        const r = 5 + 4 * fire.p;
        const grad = ctx.createRadialGradient(X(fire.x), Y(fire.y), 0, X(fire.x), Y(fire.y), r * 3);
        grad.addColorStop(0, "rgba(232,67,47,0.5)"); grad.addColorStop(1, "rgba(232,67,47,0)");
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
      ctx.fillStyle = controller.mode === "STOPPED" ? "#E8432F" : COLORS.robot;
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, 7); ctx.fill();
      ctx.fillStyle = COLORS.robotHeading;
      ctx.beginPath(); ctx.moveTo(rr * 1.5, 0); ctx.lineTo(-rr * 0.3, rr * 0.8); ctx.lineTo(-rr * 0.3, -rr * 0.8); ctx.closePath(); ctx.fill();
      if (controller.pumpOn) {
        ctx.strokeStyle = COLORS.spray; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(rr, 0); ctx.lineTo(rr + 14, 0); ctx.stroke();
      }
      ctx.restore();
    }
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [engineRef, showTree, showSensors, height]);

  return <canvas ref={canvasRef} style={{ width: "100%", height }} className="block" />;
}
