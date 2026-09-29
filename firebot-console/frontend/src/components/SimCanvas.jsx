import React, { useEffect, useRef } from "react";
import { HFOV } from "../lib/simEngine.js";

// Palette pulled from tailwind.config.js — the canvas is a deliberately true-black
// "instrument screen" (matches the camera/thermal viewport's `scope` color), a tactical
// plot rather than a lit floor plan.
const COLORS = {
  bg: "#0E0919", floor: "#1E1533", fog: "#0A0612",
  border: "rgba(241,236,250,0.5)",
  wall: "#3A2A5C", wallEdge: "#8E78C2",
  grid: "rgba(241,236,250,0.045)", gridMajor: "rgba(241,236,250,0.12)", axis: "rgba(241,236,250,0.6)",
  robot: "#7DE3B0", fireTrue: "#FF6A2B", fireEst: "#F0559B",
  ellipse: "rgba(240,85,155,0.22)", path: "#7DE3B0",
  tree: "rgba(196,160,255,0.2)", cone: "rgba(125,227,176,0.10)",
};
// ironbow ramp shared with the thermal camera view: t in 0..1 -> rgb
const RAMP = [[27,10,60],[90,26,134],[196,40,111],[255,138,42],[255,242,201]];
function ironbow(t, a = 1) {
  const v = Math.max(0, Math.min(1, t)) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(v)), f = v - i;
  const c = RAMP[i].map((x, k) => Math.round(x + (RAMP[i + 1][k] - x) * f));
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

// Exploration reveal: cheap "fog of war" that only ever grows, so the floor
// plan is *constructed* as the robot moves through it rather than shown all
// at once. Mirrors what a real SLAM stack would actually have observed —
// a close all-around ring (ultrasonic range) plus a longer forward wedge
// (camera FOV) — so the shape of the revealed area tells its own story.
const hyp = (dx, dy) => Math.sqrt(dx * dx + dy * dy);
const MASK_RES = 24;       // mask-canvas px per world metre, independent of view zoom
const REVEAL_NEAR = 2.1;   // m, all-around proximity reveal
const REVEAL_FAR = 6.0;    // m, forward camera-cone reveal

export default function SimCanvas({ engineRef, showTree, showSensors, showSlam, height = 560 }) {
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

      const fg = dctx.createLinearGradient(0, oy, 0, oy + world.height * scale);
      fg.addColorStop(0, "#251A40"); fg.addColorStop(1, "#191029");
      dctx.fillStyle = fg;
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

      dctx.fillStyle = COLORS.axis; dctx.font = "10px 'Martian Mono', monospace";
      dctx.textAlign = "center"; dctx.textBaseline = "top";
      for (let gx = 0; gx <= world.width; gx += 5) dctx.fillText(`${gx}`, rp(X(gx)), rp(Y(0) + 5));
      dctx.textAlign = "right"; dctx.textBaseline = "middle";
      for (let gy = 0; gy <= world.height; gy += 5) dctx.fillText(`${gy}`, rp(X(0) - 6), rp(Y(gy)));

      for (const w of world.walls) {
        const px = X(w.x), py = Y(w.y + w.h), pw = w.w * scale, ph = w.h * scale;  // Y() is flipped: top edge = y + h
        if (w.prop) drawProp(dctx, w.kind, px, py, pw, ph, scale);
        else drawWall(dctx, px, py, pw, ph);
      }

      if (controller.visited?.length) {
        const n = controller.visited.length;
        controller.visited.forEach(([vx, vy], i) => {
          dctx.fillStyle = ironbow(0.15 + (i / n) * 0.8, 0.15 + (i / n) * 0.5);
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

      if (fire.p > 0 && fireSeenRef.current) {
        const fxp = X(fire.x), fyp = Y(fire.y), gr = (2.2 + 3.2 * fire.p) * scale * (1 + 0.04 * Math.sin(t * 5));
        const hg = ctx.createRadialGradient(fxp, fyp, 0, fxp, fyp, gr);
        hg.addColorStop(0, ironbow(1, 0.55 * fire.p + 0.15)); hg.addColorStop(0.35, ironbow(0.62, 0.3 * fire.p));
        hg.addColorStop(0.7, ironbow(0.3, 0.14 * fire.p)); hg.addColorStop(1, ironbow(0.1, 0));
        ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(fxp, fyp, gr, 0, 7); ctx.fill();
      }

      // ---- overlays that ride on top of the map regardless of fog ----
      if (showTree && controller.tree?.length) {
        ctx.strokeStyle = COLORS.tree; ctx.lineWidth = 1;
        ctx.beginPath();
        for (const [a, b] of controller.tree) { ctx.moveTo(X(a[0]), Y(a[1])); ctx.lineTo(X(b[0]), Y(b[1])); }
        ctx.stroke();
      }

      // ---- SLAM / next-best-view overlay: the frontier the robot's own occupancy grid sees,
      // the viewpoint NBV picked from it, and how far dead-reckoning + scan-matching has drifted
      // from ground truth -- i.e. what the robot itself believes, not what the world actually is.
      if (showSlam) {
        const nbv = controller.nbv;
        if (nbv?.frontier?.length) {
          ctx.fillStyle = "rgba(125,227,176,0.55)";
          for (const [fx, fy] of nbv.frontier) { ctx.beginPath(); ctx.arc(X(fx), Y(fy), 1.6, 0, 7); ctx.fill(); }
        }
        if (nbv?.candidates?.length) {
          for (const c of nbv.candidates) {
            const cx = X(c.x), cy = Y(c.y);
            ctx.fillStyle = "rgba(196,160,255,0.55)";
            ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 7); ctx.fill();
          }
        }
        if (nbv?.target) {
          const tx = X(nbv.target.x), ty = Y(nbv.target.y), s6 = 6 + Math.sin(t * 4) * 1.5;
          ctx.strokeStyle = "#C4A0FF"; ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(tx, ty - s6); ctx.lineTo(tx + s6, ty); ctx.lineTo(tx, ty + s6); ctx.lineTo(tx - s6, ty); ctx.closePath();
          ctx.stroke();
          ctx.fillStyle = "#C4A0FF"; ctx.font = "10px 'Martian Mono', monospace";
          ctx.textAlign = "center"; ctx.textBaseline = "bottom";
          ctx.fillText("NBV", tx, ty - s6 - 3);
        }
        const slamPose = controller.slam?.pose;
        if (slamPose) {
          const px = X(slamPose.x), py = Y(slamPose.y), errPx = hyp(X(slamPose.x) - X(rx0), Y(slamPose.y) - Y(ry0));
          if (errPx > 2) {
            ctx.strokeStyle = "rgba(255,178,56,0.65)"; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(X(rx0), Y(ry0)); ctx.lineTo(px, py); ctx.stroke(); ctx.setLineDash([]);
          }
          ctx.strokeStyle = "#FFB238"; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(px, py, 4, 0, 7); ctx.stroke();
        }
      }
      if (controller.path?.length > 1) {
        ctx.strokeStyle = COLORS.path; ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.setLineDash([9, 7]); ctx.lineDashOffset = -t * 26; ctx.shadowColor = COLORS.path; ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(X(controller.path[0][0]), Y(controller.path[0][1]));
        for (const p of controller.path.slice(1)) ctx.lineTo(X(p[0]), Y(p[1]));
        ctx.stroke(); ctx.setLineDash([]); ctx.shadowBlur = 0;
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
        ctx.fillStyle = COLORS.fireEst; ctx.font = "10px 'Martian Mono', monospace";
        ctx.textAlign = "left"; ctx.textBaseline = "bottom";
        ctx.fillText("estimate", rp(ex + 9), rp(ey - 5));
      }

      // true fire — withheld until the swept sensors have actually covered that cell
      if (fire.p > 0 && fireSeenRef.current) {
        drawFlame(ctx, X(fire.x), Y(fire.y), fire.p, t);
      }

      if (showSensors) {
        const cg = ctx.createRadialGradient(X(rx0), Y(ry0), 0, X(rx0), Y(ry0), REVEAL_FAR * scale);
        cg.addColorStop(0, "rgba(125,227,176,0.30)"); cg.addColorStop(1, "rgba(125,227,176,0.02)");
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.moveTo(X(rx0), Y(ry0));
        ctx.arc(X(rx0), Y(ry0), REVEAL_FAR * scale, -th - HFOV / 2, -th + HFOV / 2);  // -th: screen y is flipped
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "rgba(125,227,176,0.4)"; ctx.lineWidth = 1; ctx.stroke();
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
      ctx.fillStyle = COLORS.axis; ctx.font = "10px 'Martian Mono', monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillText(`${barM} m`, rp(bx + barPx / 2), rp(by - 6));

      // coverage readout, bottom-left
      ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      ctx.fillText(`Explored ${coverageRef.current}%`, rp(X(0)), rp(cssH - 6));
      // north arrow, top-left (+y is north, drawn up)
      const nx = rp(14), ny = rp(24);
      ctx.strokeStyle = COLORS.axis; ctx.fillStyle = COLORS.axis; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(nx, ny + 10); ctx.lineTo(nx, ny - 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(nx, ny - 10); ctx.lineTo(nx - 4, ny - 3); ctx.lineTo(nx + 4, ny - 3); ctx.closePath(); ctx.fill();
      ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText("N", nx, ny + 13);
    }
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [engineRef, showTree, showSensors, showSlam, height]);

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
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 10; ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 4;
  ctx.fillStyle = COLORS.wall; ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.fillStyle = COLORS.wall; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = COLORS.wallEdge; ctx.fillRect(x, y, w, 2);
  ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.fillRect(x, y + 2, Math.min(w, 2), Math.max(0, h - 2));
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

// Flat rectangular furniture: a shelf/table read as long low blocks with a top highlight edge,
// distinct from a wall (no shadow, lighter warm tone) and from a crate (no hazard cross).
function drawFurniture(ctx, px, py, pw, ph) {
  const [x, y, w, h] = snapRect(px, py, pw, ph);
  ctx.fillStyle = "#3B2E23"; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "rgba(196,150,110,0.55)"; ctx.fillRect(x, y, w, Math.min(h, 2));
  ctx.strokeStyle = "rgba(196,150,110,0.4)"; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
}

// Round canopy foliage (tree/shrub) and a barrel: drawn as discs so they read as "planted" or
// "cylindrical" clutter rather than more geometric obstacle blocks.
function drawFoliage(ctx, px, py, pw, ph, kind) {
  const cx = px + pw / 2, cy = py + ph / 2, r = Math.max(2, Math.min(pw, ph) / 2);
  if (kind === "tree") {
    ctx.fillStyle = "rgba(70,40,20,0.9)"; ctx.fillRect(cx - Math.max(1, r * 0.12), cy, Math.max(2, r * 0.24), r * 0.9);
    const canopy = ["#1F6B4A", "#2E8F63", "#48B37F"];
    canopy.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(cx - r * 0.15 * i, cy - r * 0.12 * i, r * (1 - i * 0.22), 0, 7); ctx.fill();
    });
    ctx.strokeStyle = "rgba(72,179,127,0.5)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
  } else if (kind === "shrub") {
    ctx.fillStyle = "#2E8F63"; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(72,179,127,0.6)"; ctx.lineWidth = 1; ctx.stroke();
  } else { // barrel
    ctx.fillStyle = "#3A2F1A"; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(255,176,0,0.55)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.62, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
  }
}

function drawProp(ctx, kind, px, py, pw, ph, scale) {
  if (kind === "tree" || kind === "shrub" || kind === "barrel") drawFoliage(ctx, px, py, pw, ph, kind);
  else if (kind === "shelf" || kind === "table") drawFurniture(ctx, px, py, pw, ph);
  else drawCrate(ctx, px, py, pw, ph);
}

// Fire (ground truth): solid red marker sized by remaining intensity `p`, a pulsing ring and
// a label. Deliberately a clean symbol rather than a rendered flame.
function drawFlame(ctx, x, y, p, t) {
  const r = 8 + 14 * p;
  const tongue = (k, scale, col, sway) => {
    const h = r * scale * (1 + 0.14 * Math.sin(t * 9 + k * 2));
    const w = r * 0.62 * scale, dx = Math.sin(t * 6 + k * 3) * r * sway;
    ctx.fillStyle = col; ctx.beginPath();
    ctx.moveTo(x - w, y + r * 0.3);
    ctx.quadraticCurveTo(x - w * 1.1, y - h * 0.4, x + dx, y - h * 1.6);
    ctx.quadraticCurveTo(x + w * 1.1, y - h * 0.4, x + w, y + r * 0.3);
    ctx.quadraticCurveTo(x, y + r * 0.8, x - w, y + r * 0.3);
    ctx.fill();
  };
  ctx.save(); ctx.shadowColor = "rgba(255,120,40,0.9)"; ctx.shadowBlur = 18;
  tongue(0, 1.0, "#E0341F", 0.25);
  ctx.restore();
  tongue(1, 0.78, "#FF8A2A", 0.18);
  tongue(2, 0.5, "#FFF2C9", 0.1);
  for (let i = 0; i < 7; i++) {
    const ph = (t * 0.7 + i / 7) % 1, ex = x + Math.sin(t * 3 + i * 5) * r * 0.9 * ph, ey = y - r * 0.5 - ph * r * 3.4;
    ctx.fillStyle = `rgba(255,190,90,${(1 - ph) * 0.9})`; ctx.beginPath(); ctx.arc(ex, ey, 1.6 * (1 - ph) + 0.4, 0, 7); ctx.fill();
  }
  ctx.fillStyle = "#FFB99A"; ctx.font = "10px 'Martian Mono', monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.fillText(`fire ${Math.round(p * 100)}%`, Math.round(x), Math.round(y + r + 6));
}

// One thin ring expanding from the robot: a quiet cue that it is actively sensing.
function drawSonarPing(ctx, x, y, scale, t) {
  const phase = (t % 2.4) / 2.4;
  const alpha = (1 - phase) * 0.28;
  if (alpha <= 0.01) return;
  ctx.strokeStyle = `rgba(125,227,176,${alpha})`; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, y, Math.max(1, phase * scale * 2.6), 0, 7); ctx.stroke();
}

// Robot: flat top-down glyph -- outlined body, four wheel blocks and a solid heading chevron,
// so orientation is readable at a glance. Red when STOPPED.
function drawCar(ctx, x, y, th, scale, mode, pumpOn, t) {
  const rr = Math.max(8, 0.22 * scale);
  const len = rr * 2.2, wid = rr * 1.5;
  const stopped = mode === "STOPPED";
  const col = stopped ? "#FF4A2B" : "#7DE3B0";

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(th);

  ctx.fillStyle = "#06090B";
  for (const wy of [-wid / 2 - 1.5, wid / 2 - 1.5]) {
    for (const wx of [-len * 0.3, len * 0.3 - rr * 0.5]) ctx.fillRect(wx - rr * 0.1, wy, rr * 0.6, 3);
  }
  roundedRectPath(ctx, -len / 2, -wid / 2, len, wid, 2.5);
  ctx.fillStyle = stopped ? "#3A1512" : "#F1ECFA"; ctx.fill();
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
