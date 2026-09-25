import React, { useEffect, useRef } from "react";
import { HFOV } from "../lib/simEngine.js";

// Palette pulled from tailwind.config.js — the canvas is a deliberately dark
// "instrument screen" (matches the camera/thermal viewport's `scope` color)
// sitting inside the light industrial-HMI shell, not a leftover dark theme.
const COLORS = {
  bg: "#12110D",
  floor: "#1C1A14",
  fog: "#0B0A07",
  fogHatch: "rgba(247,243,232,0.025)",
  grid: "rgba(247,243,232,0.035)",
  gridMajor: "rgba(247,243,232,0.09)",
  axis: "rgba(247,243,232,0.45)",
  robot: "#3FA7D6",
  fireTrue: "#E14A3A",
  fireEst: "#D69A3C",
  ellipse: "rgba(214,154,60,0.25)",
  path: "#4CAF6D",
  tree: "rgba(63,167,214,0.22)",
  cone: "rgba(63,167,214,0.08)",
};

// Exploration reveal: cheap "fog of war" that only ever grows, so the floor
// plan is *constructed* as the robot moves through it rather than shown all
// at once. Mirrors what a real SLAM stack would actually have observed —
// a close all-around ring (ultrasonic range) plus a longer forward wedge
// (camera FOV) — so the shape of the revealed area tells its own story.
const MASK_RES = 12;       // mask-canvas px per world metre, independent of view zoom
const REVEAL_NEAR = 2.1;   // m, all-around proximity reveal
const REVEAL_FAR = 6.0;    // m, forward camera-cone reveal

export default function SimCanvas({ engineRef, showTree, showSensors, height = 560 }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const detailRef = useRef(null);
  if (!detailRef.current) detailRef.current = document.createElement("canvas");
  const maskRef = useRef(null);
  const worldRef = useRef(null);
  const coverageRef = useRef(0);
  const fireSeenRef = useRef(false);
  const tickRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    function ensureMask(world) {
      if (worldRef.current !== world) {
        worldRef.current = world;
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.ceil(world.width * MASK_RES));
        c.height = Math.max(1, Math.ceil(world.height * MASK_RES));
        maskRef.current = c;
        coverageRef.current = 0;
        fireSeenRef.current = false;
      }
      return maskRef.current;
    }

    function draw(now) {
      rafRef.current = requestAnimationFrame(draw);
      const controller = engineRef.current;
      if (!controller || !ctx) return;
      tickRef.current++;
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
      const t = now / 1000;
      const { x: rx0, y: ry0, th } = controller.robot;

      // ---- grow the explored mask around the robot ----
      const mask = ensureMask(world);
      const mctx = mask.getContext("2d");
      const mx = rx0 * MASK_RES, my = ry0 * MASK_RES;
      let rg = mctx.createRadialGradient(mx, my, REVEAL_NEAR * MASK_RES * 0.25, mx, my, REVEAL_NEAR * MASK_RES);
      rg.addColorStop(0, "rgba(255,255,255,0.85)");
      rg.addColorStop(1, "rgba(255,255,255,0)");
      mctx.fillStyle = rg;
      mctx.beginPath(); mctx.arc(mx, my, REVEAL_NEAR * MASK_RES, 0, Math.PI * 2); mctx.fill();
      if (showSensors) {
        mctx.globalAlpha = 0.3;
        mctx.fillStyle = "#fff";
        mctx.beginPath();
        mctx.moveTo(mx, my);
        mctx.arc(mx, my, REVEAL_FAR * MASK_RES, th - HFOV / 2, th + HFOV / 2);
        mctx.closePath(); mctx.fill();
        mctx.globalAlpha = 1;
      }

      // coverage % and fire-discovered flag are cheap CPU/GPU readbacks — throttle both
      if (tickRef.current % 25 === 0) {
        const sw = 20, sh = 14;
        const sc = document.createElement("canvas"); sc.width = sw; sc.height = sh;
        const sctx = sc.getContext("2d");
        sctx.drawImage(mask, 0, 0, sw, sh);
        const d = sctx.getImageData(0, 0, sw, sh).data;
        let sum = 0;
        for (let i = 3; i < d.length; i += 4) sum += d[i];
        coverageRef.current = Math.round((sum / (sw * sh * 255)) * 100);
      }
      const fire = controller.fire;
      if (fire.p > 0 && tickRef.current % 6 === 0) {
        const fx = Math.max(0, Math.min(mask.width - 1, Math.round(fire.x * MASK_RES)));
        const fy = Math.max(0, Math.min(mask.height - 1, Math.round(fire.y * MASK_RES)));
        fireSeenRef.current = mctx.getImageData(fx, fy, 1, 1).data[3] > 60;
      }

      // ---- fog backdrop across the whole floor footprint ----
      ctx.fillStyle = COLORS.fog;
      ctx.fillRect(X(0), Y(0), world.width * scale, world.height * scale);
      ctx.save();
      ctx.beginPath(); ctx.rect(X(0), Y(0), world.width * scale, world.height * scale); ctx.clip();
      ctx.strokeStyle = COLORS.fogHatch; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let d = -world.height * scale; d < world.width * scale; d += 10) {
        ctx.moveTo(X(0) + d, Y(0) + world.height * scale);
        ctx.lineTo(X(0) + d + world.height * scale, Y(0));
      }
      ctx.stroke();
      ctx.restore();

      // ---- known-map layer, built offscreen then clipped to what's been explored ----
      const detail = detailRef.current;
      if (detail.width !== canvas.width || detail.height !== canvas.height) {
        detail.width = canvas.width; detail.height = canvas.height;
      }
      const dctx = detail.getContext("2d");
      dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dctx.clearRect(0, 0, cssW, cssH);

      dctx.fillStyle = COLORS.floor;
      dctx.fillRect(X(0), Y(0), world.width * scale, world.height * scale);

      dctx.lineWidth = 1;
      dctx.beginPath(); dctx.strokeStyle = COLORS.grid;
      for (let gx = 0; gx <= world.width; gx++) { if (gx % 5 === 0) continue; dctx.moveTo(X(gx), Y(0)); dctx.lineTo(X(gx), Y(world.height)); }
      for (let gy = 0; gy <= world.height; gy++) { if (gy % 5 === 0) continue; dctx.moveTo(X(0), Y(gy)); dctx.lineTo(X(world.width), Y(gy)); }
      dctx.stroke();
      dctx.beginPath(); dctx.strokeStyle = COLORS.gridMajor;
      for (let gx = 0; gx <= world.width; gx += 5) { dctx.moveTo(X(gx), Y(0)); dctx.lineTo(X(gx), Y(world.height)); }
      for (let gy = 0; gy <= world.height; gy += 5) { dctx.moveTo(X(0), Y(gy)); dctx.lineTo(X(world.width), Y(gy)); }
      dctx.stroke();

      dctx.fillStyle = COLORS.axis; dctx.font = "9px 'JetBrains Mono', monospace";
      dctx.textAlign = "center"; dctx.textBaseline = "top";
      for (let gx = 0; gx <= world.width; gx += 5) dctx.fillText(`${gx}m`, X(gx), Y(world.height) + 4);
      dctx.textAlign = "right"; dctx.textBaseline = "middle";
      for (let gy = 0; gy <= world.height; gy += 5) dctx.fillText(`${gy}m`, X(0) - 5, Y(gy));

      for (const w of world.walls) {
        const px = X(w.x), py = Y(w.y), pw = w.w * scale, ph = w.h * scale;
        if (w.prop) drawCrate(dctx, px, py, pw, ph);
        else drawWall(dctx, px, py, pw, ph);
      }

      if (controller.visited?.length) {
        const n = controller.visited.length;
        controller.visited.forEach(([vx, vy], i) => {
          const a = (i / n) * 0.4;
          dctx.fillStyle = `rgba(63,167,214,${a})`;
          dctx.beginPath(); dctx.arc(X(vx), Y(vy), Math.max(1.6, 0.15 * scale), 0, 7); dctx.fill();
        });
      }

      dctx.globalCompositeOperation = "destination-in";
      dctx.drawImage(mask, 0, 0, mask.width, mask.height, X(0), Y(0), world.width * scale, world.height * scale);
      dctx.globalCompositeOperation = "source-over";

      ctx.drawImage(detail, 0, 0, cssW, cssH);

      // ---- overlays that ride on top of the map regardless of fog ----
      if (showTree && controller.tree?.length) {
        ctx.strokeStyle = COLORS.tree; ctx.lineWidth = 1;
        ctx.beginPath();
        for (const [a, b] of controller.tree) { ctx.moveTo(X(a[0]), Y(a[1])); ctx.lineTo(X(b[0]), Y(b[1])); }
        ctx.stroke();
      }
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

      const est = controller.eif.estimate();
      const sigma = Math.sqrt(Math.max(est.P[0][0], est.P[1][1], 1e-9));
      if (sigma < 20 && est.x > -2 && est.x < world.width + 2 && est.y > -2 && est.y < world.height + 2) {
        const erx = Math.min(Math.sqrt(Math.max(est.P[0][0], 1e-6)) * scale * 2, cssW);
        const ery = Math.min(Math.sqrt(Math.max(est.P[1][1], 1e-6)) * scale * 2, cssH);
        ctx.fillStyle = COLORS.ellipse;
        ctx.beginPath(); ctx.ellipse(X(est.x), Y(est.y), Math.max(4, erx), Math.max(4, ery), 0, 0, 7); ctx.fill();
        ctx.strokeStyle = COLORS.fireEst; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(X(est.x) - 6, Y(est.y)); ctx.lineTo(X(est.x) + 6, Y(est.y));
        ctx.moveTo(X(est.x), Y(est.y) - 6); ctx.lineTo(X(est.x), Y(est.y) + 6); ctx.stroke();
      }

      // true fire — withheld until the swept sensors have actually covered that cell
      if (fire.p > 0 && fireSeenRef.current) {
        drawFlame(ctx, X(fire.x), Y(fire.y), fire.p, t);
      }

      if (showSensors) {
        ctx.fillStyle = COLORS.cone;
        ctx.beginPath(); ctx.moveTo(X(rx0), Y(ry0));
        ctx.arc(X(rx0), Y(ry0), REVEAL_FAR * scale, th - HFOV / 2, th + HFOV / 2);
        ctx.closePath(); ctx.fill();
      }
      drawSonarPing(ctx, X(rx0), Y(ry0), scale, t);
      drawCar(ctx, X(rx0), Y(ry0), th, scale, controller.mode, controller.pumpOn, t);

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

      // coverage readout, bottom-left
      ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      ctx.fillText(`MAP COVERAGE ${coverageRef.current}%`, X(0), cssH - 6);
    }
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [engineRef, showTree, showSensors, height]);

  return <canvas ref={canvasRef} style={{ width: "100%", height }} className="block" />;
}

/* ------------------------------------------------------------------------ */
/* shape helpers                                                            */
/* ------------------------------------------------------------------------ */

function roundedRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Structural wall segment: beveled slab with a directional light edge so
// corridors read as solid built geometry, not flat colour blocks.
function drawWall(ctx, px, py, pw, ph) {
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(px, py + ph, pw, Math.min(4, Math.max(1, ph * 0.12)));

  const grad = ctx.createLinearGradient(px, py, px, py + ph);
  grad.addColorStop(0, "#5A5646");
  grad.addColorStop(1, "#2E2B21");
  ctx.fillStyle = grad;
  ctx.fillRect(px, py, pw, ph);

  ctx.strokeStyle = "rgba(247,243,232,0.20)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, py + ph); ctx.lineTo(px, py); ctx.lineTo(px + pw, py); ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath(); ctx.moveTo(px + pw, py); ctx.lineTo(px + pw, py + ph); ctx.lineTo(px, py + ph); ctx.stroke();
}

// Loose furniture/obstacle: a grounded crate with a hazard-dashed rim,
// corner rivets and a fold line — reads unmistakably as "obstacle", not wall.
function drawCrate(ctx, px, py, pw, ph) {
  const r = Math.min(pw, ph) * 0.2;

  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(px + pw / 2, py + ph + 1.5, pw * 0.55, Math.max(1.5, ph * 0.16), 0, 0, 7);
  ctx.fill();

  roundedRectPath(ctx, px, py, pw, ph, r);
  const grad = ctx.createLinearGradient(px, py, px + pw, py + ph);
  grad.addColorStop(0, "#524D3B");
  grad.addColorStop(1, "#221F16");
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.strokeStyle = "rgba(247,243,232,0.15)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, py + ph / 2); ctx.lineTo(px + pw, py + ph / 2); ctx.stroke();

  ctx.fillStyle = "rgba(247,243,232,0.3)";
  for (const [cx, cy] of [[px + 3, py + 3], [px + pw - 3, py + 3], [px + 3, py + ph - 3], [px + pw - 3, py + ph - 3]]) {
    if (cx > px + pw || cy > py + ph) continue;
    ctx.beginPath(); ctx.arc(cx, cy, 1, 0, 7); ctx.fill();
  }

  ctx.save();
  roundedRectPath(ctx, px + 1, py + 1, Math.max(0, pw - 2), Math.max(0, ph - 2), r);
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = "#F4B942"; ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// Layered, flickering flame with a glow halo and rising embers — sized by
// remaining fire intensity `p` (1 → freshly caught, 0 → fully suppressed).
function drawFlame(ctx, x, y, p, t) {
  const baseH = 15 + 22 * p;
  const baseW = baseH * 0.62;
  const flicker = 1 + Math.sin(t * 9) * 0.06 + Math.sin(t * 5.3 + 1) * 0.04;

  const glowR = baseH * 1.9;
  const glow = ctx.createRadialGradient(x, y - baseH * 0.3, 0, x, y - baseH * 0.3, glowR);
  glow.addColorStop(0, "rgba(225,74,58,0.45)");
  glow.addColorStop(1, "rgba(225,74,58,0)");
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(x, y - baseH * 0.3, glowR, 0, 7); ctx.fill();

  function layer(hMul, wMul, colorA, colorB, skew) {
    const h = baseH * hMul * flicker, w = baseW * wMul;
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.12);
    ctx.bezierCurveTo(x - w, y - h * 0.15 + skew, x - w * 0.55, y - h * 0.85, x, y - h);
    ctx.bezierCurveTo(x + w * 0.55, y - h * 0.85, x + w, y - h * 0.15 - skew, x, y + h * 0.12);
    ctx.closePath();
    const g = ctx.createLinearGradient(x, y + h * 0.12, x, y - h);
    g.addColorStop(0, colorA); g.addColorStop(1, colorB);
    ctx.fillStyle = g; ctx.fill();
  }
  layer(1.0, 1.0, "#E14A3A", "#8B1F16", Math.sin(t * 6) * 2);
  layer(0.72, 0.68, "#F4B942", "#E85A2A", Math.sin(t * 7 + 1) * 2);
  layer(0.42, 0.4, "#FFE9A8", "#F4B942", Math.sin(t * 8 + 2) * 1.5);

  for (let i = 0; i < 5; i++) {
    const ph = (t * 0.6 + i / 5) % 1;
    const ex = x + Math.sin(t * 3 + i * 2) * baseW * 0.5;
    const ey = y - baseH * 0.4 - ph * baseH * 1.6;
    ctx.fillStyle = `rgba(244,185,66,${(1 - ph) * 0.8})`;
    ctx.beginPath(); ctx.arc(ex, ey, 1.3 * (1 - ph * 0.5), 0, 7); ctx.fill();
  }
}

// Expanding sonar-style rings from the robot — a quiet, continuous reminder
// that it's actively sweeping/mapping, not just a static icon on the floor.
function drawSonarPing(ctx, x, y, scale, t) {
  const period = 2.4;
  for (let i = 0; i < 2; i++) {
    const phase = ((t + i * (period / 2)) % period) / period;
    const alpha = (1 - phase) * 0.3;
    if (alpha <= 0.01) continue;
    ctx.strokeStyle = `rgba(63,167,214,${alpha})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, phase * scale * 3.0), 0, 7); ctx.stroke();
  }
}

// The robot itself, drawn as a small car: chassis, wheels, sensor turret,
// headlight beam and — when the pump is running — a spray of droplets.
function drawCar(ctx, x, y, th, scale, mode, pumpOn, t) {
  const rr = Math.max(7, 0.22 * scale);
  const len = rr * 2.6, wid = rr * 1.6;
  const stopped = mode === "STOPPED";
  const bodyLight = stopped ? "#FF9C8C" : "#8AD4F0";
  const bodyMain = stopped ? "#E1584A" : "#3FA7D6";
  const bodyDark = stopped ? "#7A241C" : "#1E5A78";

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(th);

  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, len * 1.4);
  glow.addColorStop(0, stopped ? "rgba(225,74,58,0.32)" : "rgba(63,167,214,0.28)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(0, 0, len * 1.4, 0, 7); ctx.fill();

  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath(); ctx.ellipse(0, wid * 0.2, len * 0.55, wid * 0.38, 0, 0, 7); ctx.fill();

  ctx.fillStyle = "#17150F";
  for (const wy of [-wid / 2, wid / 2]) {
    for (const wx of [-len * 0.26, len * 0.26]) {
      roundedRectPath(ctx, wx - rr * 0.32, wy - rr * 0.13, rr * 0.64, rr * 0.26, rr * 0.08);
      ctx.fill();
    }
  }

  roundedRectPath(ctx, -len / 2, -wid / 2, len, wid, wid * 0.32);
  const bodyGrad = ctx.createLinearGradient(0, -wid / 2, 0, wid / 2);
  bodyGrad.addColorStop(0, bodyLight);
  bodyGrad.addColorStop(0.5, bodyMain);
  bodyGrad.addColorStop(1, bodyDark);
  ctx.fillStyle = bodyGrad; ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1; ctx.stroke();

  ctx.beginPath(); ctx.arc(len * 0.06, 0, wid * 0.34, 0, 7);
  const cabGrad = ctx.createRadialGradient(len * 0.06 - 2, -2, 0, len * 0.06, 0, wid * 0.34);
  cabGrad.addColorStop(0, "#EAF6FA"); cabGrad.addColorStop(1, "#9FC9DA");
  ctx.fillStyle = cabGrad; ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1; ctx.stroke();

  ctx.fillStyle = "#FFF3C4";
  ctx.beginPath(); ctx.arc(len / 2 - 1, -wid * 0.28, rr * 0.14, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(len / 2 - 1, wid * 0.28, rr * 0.14, 0, 7); ctx.fill();

  const beam = ctx.createLinearGradient(len / 2, 0, len / 2 + rr * 2.2, 0);
  beam.addColorStop(0, "rgba(255,243,196,0.22)");
  beam.addColorStop(1, "rgba(255,243,196,0)");
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(len / 2, -wid * 0.4); ctx.lineTo(len / 2 + rr * 2.2, -wid * 0.9);
  ctx.lineTo(len / 2 + rr * 2.2, wid * 0.9); ctx.lineTo(len / 2, wid * 0.4); ctx.closePath(); ctx.fill();

  ctx.fillStyle = stopped ? "#FF6B54" : "#7A241C";
  ctx.beginPath(); ctx.arc(-len / 2 + 1, 0, rr * 0.12, 0, 7); ctx.fill();

  if (pumpOn) {
    for (let i = 0; i < 6; i++) {
      const ph = (t * 2 + i / 6) % 1;
      const dx = len / 2 + ph * rr * 3.2;
      const dy = Math.sin(t * 10 + i) * rr * 0.3 * ph;
      ctx.fillStyle = `rgba(63,167,214,${(1 - ph) * 0.8})`;
      ctx.beginPath(); ctx.arc(dx, dy, 1.4, 0, 7); ctx.fill();
    }
  }

  ctx.restore();
}
