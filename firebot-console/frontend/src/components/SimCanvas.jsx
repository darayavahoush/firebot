import React, { useEffect, useRef } from "react";
import { HFOV } from "../lib/simEngine.js";

// Palette pulled from tailwind.config.js — the canvas is a deliberately true-black
// "instrument screen" (matches the camera/thermal viewport's `scope` color), a tactical
// plot rather than a lit floor plan.
const COLORS = {
  bg: "#0A0C0F",
  floor: "#14181C",
  fog: "#050607",
  border: "rgba(232,236,239,0.55)",
  wall: "#3B434C",
  wallEdge: "#7C8794",
  grid: "rgba(232,236,239,0.05)",
  gridMajor: "rgba(232,236,239,0.13)",
  axis: "rgba(232,236,239,0.6)",
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
const MASK_RES = 24;       // mask-canvas px per world metre, independent of view zoom
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
      const bw = Math.round(cssW * dpr), bh = Math.round(cssH * dpr);
      if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
      // sn: snap a CSS coordinate so a 1px stroke lands on exactly one device pixel row/column
      // (otherwise it straddles two and renders as a soft 2px smear). rp: snap for text/shapes.
      const sn = (v) => (Math.round(v * dpr - 0.5) + 0.5) / dpr;
      const rp = (v) => Math.round(v * dpr) / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, cssW, cssH);

      const world = controller.world;
      const pad = 30;
      const scale = Math.min((cssW - pad * 2) / world.width, (cssH - pad * 2) / world.height);
      // Canvas narrower than its padding (first layout pass, tiny window): nothing sensible to
      // draw, and a negative scale makes ctx.ellipse() throw on negative radii every frame.
      if (!(scale > 0)) return;
      const ox = (cssW - world.width * scale) / 2, oy = (cssH - world.height * scale) / 2;
      // World frame is +x east, +y NORTH (same as the Python side), but canvas y grows downward,
      // so flip y here or "north" would be drawn at the bottom of the map.
      const X = (x) => ox + x * scale, Y = (y) => oy + (world.height - y) * scale;
      const t = now / 1000;
      const { x: rx0, y: ry0, th } = controller.robot;

      // ---- grow the explored mask around the robot ----
      const mask = ensureMask(world);
      const mctx = mask.getContext("2d");
      const mx = rx0 * MASK_RES, my = ry0 * MASK_RES;
      let rg = mctx.createRadialGradient(mx, my, 0, mx, my, REVEAL_NEAR * MASK_RES);
      rg.addColorStop(0, "rgba(255,255,255,1)");
      rg.addColorStop(0.86, "rgba(255,255,255,1)");
      rg.addColorStop(1, "rgba(255,255,255,0)");
      mctx.fillStyle = rg;
      mctx.beginPath(); mctx.arc(mx, my, REVEAL_NEAR * MASK_RES, 0, Math.PI * 2); mctx.fill();
      if (showSensors) {
        mctx.globalAlpha = 0.9;
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
      ctx.fillRect(X(0), oy, world.width * scale, world.height * scale);
      // arena footprint outline, always visible so the map's extent is unambiguous
      ctx.strokeStyle = "rgba(232,236,239,0.22)"; ctx.lineWidth = 1;
      ctx.strokeRect(sn(X(0)), sn(oy), Math.round(world.width * scale), Math.round(world.height * scale));

      // ---- known-map layer, built offscreen then clipped to what's been explored ----
      const detail = detailRef.current;
      if (detail.width !== canvas.width || detail.height !== canvas.height) {
        detail.width = canvas.width; detail.height = canvas.height;
      }
      const dctx = detail.getContext("2d");
      dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dctx.clearRect(0, 0, cssW, cssH);

      dctx.fillStyle = COLORS.floor;
      dctx.fillRect(X(0), oy, world.width * scale, world.height * scale);

      dctx.lineWidth = 1;
      const gx0 = X(0), gx1 = X(world.width), gy0 = Y(0), gy1 = Y(world.height);
      const gridPass = (major, color) => {
        dctx.beginPath(); dctx.strokeStyle = color;
        for (let gx = 0; gx <= world.width; gx++) { if ((gx % 5 === 0) !== major) continue; const x = sn(X(gx)); dctx.moveTo(x, gy1); dctx.lineTo(x, gy0); }
        for (let gy = 0; gy <= world.height; gy++) { if ((gy % 5 === 0) !== major) continue; const y = sn(Y(gy)); dctx.moveTo(gx0, y); dctx.lineTo(gx1, y); }
        dctx.stroke();
      };
      gridPass(false, COLORS.grid);
      gridPass(true, COLORS.gridMajor);
      dctx.strokeStyle = COLORS.border;
      dctx.strokeRect(sn(gx0), sn(gy1), Math.round(gx1 - gx0), Math.round(gy0 - gy1));

      dctx.fillStyle = COLORS.axis; dctx.font = "10px 'JetBrains Mono', monospace";
      dctx.textAlign = "center"; dctx.textBaseline = "top";
      for (let gx = 0; gx <= world.width; gx += 5) dctx.fillText(`${gx}`, rp(X(gx)), rp(Y(0) + 5));
      dctx.textAlign = "right"; dctx.textBaseline = "middle";
      for (let gy = 0; gy <= world.height; gy += 5) dctx.fillText(`${gy}`, rp(X(0) - 6), rp(Y(gy)));

      for (const w of world.walls) {
        const px = X(w.x), py = Y(w.y + w.h), pw = w.w * scale, ph = w.h * scale;  // Y() is flipped: top edge = y + h
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
      // mask is stored in world coords (row 0 = y 0 = south): flip it vertically about the
      // map's centre when compositing onto the y-flipped canvas
      dctx.save();
      dctx.translate(0, 2 * oy + world.height * scale);
      dctx.scale(1, -1);
      dctx.drawImage(mask, 0, 0, mask.width, mask.height, X(0), oy, world.width * scale, world.height * scale);
      dctx.restore();
      dctx.globalCompositeOperation = "source-over";

      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(detail, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // ---- overlays that ride on top of the map regardless of fog ----
      if (showTree && controller.tree?.length) {
        ctx.strokeStyle = COLORS.tree; ctx.lineWidth = 1;
        ctx.beginPath();
        for (const [a, b] of controller.tree) { ctx.moveTo(X(a[0]), Y(a[1])); ctx.lineTo(X(b[0]), Y(b[1])); }
        ctx.stroke();
      }
      if (controller.path?.length > 1) {
        ctx.strokeStyle = COLORS.path; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(X(controller.path[0][0]), Y(controller.path[0][1]));
        for (const p of controller.path.slice(1)) ctx.lineTo(X(p[0]), Y(p[1]));
        ctx.stroke();
        if (controller.goal) {
          const gx = X(controller.goal[0]), gy = Y(controller.goal[1]);
          ctx.strokeStyle = COLORS.path; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(gx, gy, 7, 0, 7); ctx.stroke();
          ctx.fillStyle = COLORS.path; ctx.beginPath(); ctx.arc(gx, gy, 2.5, 0, 7); ctx.fill();
        }
      }

      const est = controller.eif.estimate();
      const sigma = Math.sqrt(Math.max(est.P[0][0], est.P[1][1], 1e-9));
      if (sigma < 20 && est.x > -2 && est.x < world.width + 2 && est.y > -2 && est.y < world.height + 2) {
        const erx = Math.min(Math.sqrt(Math.max(est.P[0][0], 1e-6)) * scale * 2, cssW);
        const ery = Math.min(Math.sqrt(Math.max(est.P[1][1], 1e-6)) * scale * 2, cssH);
        const ex = X(est.x), ey = Y(est.y);
        ctx.fillStyle = COLORS.ellipse;
        ctx.beginPath(); ctx.ellipse(ex, ey, Math.max(4, erx), Math.max(4, ery), 0, 0, 7); ctx.fill();
        ctx.strokeStyle = COLORS.fireEst; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.ellipse(ex, ey, Math.max(4, erx), Math.max(4, ery), 0, 0, 7); ctx.stroke();
        ctx.setLineDash([]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(ex - 7, ey); ctx.lineTo(ex + 7, ey); ctx.moveTo(ex, ey - 7); ctx.lineTo(ex, ey + 7); ctx.stroke();
        ctx.fillStyle = COLORS.fireEst; ctx.font = "10px 'JetBrains Mono', monospace";
        ctx.textAlign = "left"; ctx.textBaseline = "bottom";
        ctx.fillText("EST", rp(ex + 9), rp(ey - 5));
      }

      // true fire — withheld until the swept sensors have actually covered that cell
      if (fire.p > 0 && fireSeenRef.current) {
        drawFlame(ctx, X(fire.x), Y(fire.y), fire.p, t);
      }

      if (showSensors) {
        ctx.fillStyle = COLORS.cone;
        ctx.beginPath(); ctx.moveTo(X(rx0), Y(ry0));
        ctx.arc(X(rx0), Y(ry0), REVEAL_FAR * scale, -th - HFOV / 2, -th + HFOV / 2);  // -th: screen y is flipped
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "rgba(63,167,214,0.35)"; ctx.lineWidth = 1; ctx.stroke();
      }
      drawSonarPing(ctx, X(rx0), Y(ry0), scale, t);
      drawCar(ctx, X(rx0), Y(ry0), -th, scale, controller.mode, controller.pumpOn, t);

      // scale bar, bottom-right
      const barM = world.width > 20 ? 5 : 1;
      const barPx = barM * scale, bx = cssW - pad - barPx, by = cssH - 14;
      ctx.strokeStyle = COLORS.axis; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by); ctx.lineTo(bx + barPx, by); ctx.lineTo(bx + barPx, by - 4);
      ctx.stroke();
      ctx.fillStyle = COLORS.axis; ctx.font = "10px 'JetBrains Mono', monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillText(`${barM} m`, rp(bx + barPx / 2), rp(by - 6));

      // coverage readout, bottom-left
      ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      ctx.fillText(`MAP COVERAGE ${coverageRef.current}%`, rp(X(0)), rp(cssH - 6));
      // north arrow, top-left (+y is north, drawn up)
      const nx = rp(14), ny = rp(24);
      ctx.strokeStyle = COLORS.axis; ctx.fillStyle = COLORS.axis; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(nx, ny + 10); ctx.lineTo(nx, ny - 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(nx, ny - 10); ctx.lineTo(nx - 4, ny - 3); ctx.lineTo(nx + 4, ny - 3); ctx.closePath(); ctx.fill();
      ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText("N", nx, ny + 13);
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

// Flat, pixel-aligned geometry: solid fill + 1px edge, no gradients or drop shadows, so
// every element has a hard, unambiguous boundary like a CAD/plan drawing.
function snapRect(px, py, pw, ph) {
  const x0 = Math.round(px), y0 = Math.round(py);
  return [x0, y0, Math.max(1, Math.round(px + pw) - x0), Math.max(1, Math.round(py + ph) - y0)];
}

function drawWall(ctx, px, py, pw, ph) {
  const [x, y, w, h] = snapRect(px, py, pw, ph);
  ctx.fillStyle = COLORS.wall; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = COLORS.wallEdge; ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
}

// Loose obstacle: flat dark block, amber outline and a cross so it reads as "obstacle", not wall.
function drawCrate(ctx, px, py, pw, ph) {
  const [x, y, w, h] = snapRect(px, py, pw, ph);
  ctx.fillStyle = "#23282E"; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(255,176,0,0.35)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 1, y + 1); ctx.lineTo(x + w - 1, y + h - 1);
  ctx.moveTo(x + w - 1, y + 1); ctx.lineTo(x + 1, y + h - 1); ctx.stroke();
  ctx.strokeStyle = "#FFB000"; ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.75, y + 0.75, Math.max(0, w - 1.5), Math.max(0, h - 1.5));
}

// Fire (ground truth): solid red marker sized by remaining intensity `p`, a pulsing ring and
// a label. Deliberately a clean symbol rather than a rendered flame.
function drawFlame(ctx, x, y, p, t) {
  const r = 5 + 7 * p;
  const ph = (t * 1.1) % 1;
  ctx.strokeStyle = `rgba(225,74,58,${(1 - ph) * 0.6})`; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x, y, r + 3 + ph * 12, 0, 7); ctx.stroke();
  ctx.fillStyle = COLORS.fireTrue;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = "#FFE3B0";
  ctx.beginPath(); ctx.arc(x, y, r * 0.4, 0, 7); ctx.fill();
  ctx.fillStyle = "#FF8A78"; ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText("FIRE", Math.round(x), Math.round(y - r - 6));
}

// One thin ring expanding from the robot: a quiet cue that it is actively sensing.
function drawSonarPing(ctx, x, y, scale, t) {
  const phase = (t % 2.4) / 2.4;
  const alpha = (1 - phase) * 0.28;
  if (alpha <= 0.01) return;
  ctx.strokeStyle = `rgba(63,167,214,${alpha})`; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, y, Math.max(1, phase * scale * 2.6), 0, 7); ctx.stroke();
}

// Robot: flat top-down glyph -- outlined body, four wheel blocks and a solid heading chevron,
// so orientation is readable at a glance. Red when STOPPED.
function drawCar(ctx, x, y, th, scale, mode, pumpOn, t) {
  const rr = Math.max(8, 0.22 * scale);
  const len = rr * 2.2, wid = rr * 1.5;
  const stopped = mode === "STOPPED";
  const col = stopped ? "#E1584A" : "#3FA7D6";

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(th);

  ctx.fillStyle = "#06090B";
  for (const wy of [-wid / 2 - 1.5, wid / 2 - 1.5]) {
    for (const wx of [-len * 0.3, len * 0.3 - rr * 0.5]) ctx.fillRect(wx - rr * 0.1, wy, rr * 0.6, 3);
  }
  roundedRectPath(ctx, -len / 2, -wid / 2, len, wid, 2.5);
  ctx.fillStyle = stopped ? "#3A1512" : "#0E2836"; ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();

  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(len / 2 + rr * 0.55, 0);
  ctx.lineTo(len / 2 - rr * 0.25, -wid * 0.34);
  ctx.lineTo(len / 2 - rr * 0.25, wid * 0.34);
  ctx.closePath(); ctx.fill();

  ctx.beginPath(); ctx.arc(-len * 0.08, 0, rr * 0.2, 0, 7); ctx.fill();

  if (pumpOn) {
    for (let i = 0; i < 6; i++) {
      const ph = (t * 2 + i / 6) % 1;
      const dx = len / 2 + rr * 0.6 + ph * rr * 3.2;
      const dy = Math.sin(t * 10 + i) * rr * 0.3 * ph;
      ctx.fillStyle = `rgba(63,167,214,${(1 - ph) * 0.85})`;
      ctx.beginPath(); ctx.arc(dx, dy, 1.5, 0, 7); ctx.fill();
    }
  }
  ctx.restore();
}
