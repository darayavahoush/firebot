// Client-side mirror of the Python simulator (src/firebot/sim, src/firebot/planning,
// src/firebot/command) so this console can demonstrate the system end-to-end without a live
// backend. Field names, sensor angles and the command grammar are kept in lock-step with the
// real modules so the demo is representative, not decorative.

/* ------------------------------- RNG & math -------------------------------- */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const lerp = (a, b, t) => a + (b - a) * t;
const hyp = (dx, dy) => Math.sqrt(dx * dx + dy * dy);

/* ------------------------------- hardware constants (mirrors src/firebot/sensing.py) --- */
export const US_ANGLES = { us_front_left: 0.44, us_front_right: -0.44, us_left: 1.57, us_right: -1.57 };
export const FLAME_ANGLES = { flame_left: 0.52, flame_center: 0.0, flame_right: -0.52 };
export const THERM_ROWS = 24, THERM_COLS = 32, HFOV = 0.96, HOT_C = 45.0;
export const ROBOT_RADIUS = 0.22;
export const VMAX = 0.7, WMAX = 1.6, SPRAY_RANGE = 2.5, SPRAY_CONE = 0.2;
export const EXTINGUISH_RATE = 0.22, WATER_RATE = 0.028, BATTERY_RATE = 0.00035;

/* ------------------------------- procedural building (mirrors src/firebot/sim/mapgen.py) */
const WALL_T = 0.12, DOOR_W = 1.1, MIN_ROOM = 2.6;

function splitRect(rng, rect, depth) {
  const { x, y, w, h } = rect;
  if (depth <= 0 || (w < MIN_ROOM * 2.1 && h < MIN_ROOM * 2.1)) return [rect];
  const vertical = Math.abs(w - h) > 0.5 ? w > h : rng() < 0.5;
  const span = vertical ? w : h;
  if (span < MIN_ROOM * 2.1) return [rect];
  const cut = lerp(MIN_ROOM, span - MIN_ROOM, rng());
  const a = vertical ? { x, y, w: cut, h } : { x, y, w, h: cut };
  const b = vertical ? { x: x + cut, y, w: w - cut, h } : { x, y: y + cut, w, h: h - cut };
  return [...splitRect(rng, a, depth - 1), ...splitRect(rng, b, depth - 1)];
}

/** A fresh, randomly laid-out multi-room building -- bigger than a single room on purpose, and a
 *  different topology every call, so the planner and controller can't memorise one floor plan. */
export function generateBuilding(rng) {
  const width = lerp(16, 22, rng());
  const height = lerp(11, 15, rng());
  const depth = 3 + (rng() < 0.5 ? 0 : 1);
  const rooms = splitRect(rng, { x: 0, y: 0, w: width, h: height }, depth);
  const walls = [
    { x: 0, y: 0, w: width, h: WALL_T }, { x: 0, y: height - WALL_T, w: width, h: WALL_T },
    { x: 0, y: 0, w: WALL_T, h: height }, { x: width - WALL_T, y: 0, w: WALL_T, h: height },
  ];
  const seen = new Set();
  const key = (r) => [r.x, r.y, r.w, r.h].map((v) => Math.round(v * 100)).join(',');
  for (const room of rooms) {
    const edges = [
      { x: room.x, y: room.y, w: room.w, h: WALL_T },
      { x: room.x, y: room.y + room.h - WALL_T, w: room.w, h: WALL_T },
      { x: room.x, y: room.y, w: WALL_T, h: room.h },
      { x: room.x + room.w - WALL_T, y: room.y, w: WALL_T, h: room.h },
    ];
    for (const e of edges) {
      if (e.x <= 0.001 || e.y <= 0.001 || e.x + e.w >= width - 0.001 || e.y + e.h >= height - 0.001) continue;
      const k = key(e);
      if (seen.has(k)) continue;
      seen.add(k);
      if (e.w > e.h) {
        if (e.w < DOOR_W + 1.0) { walls.push(e); continue; }
        const gap = lerp(DOOR_W * 0.6, e.w - DOOR_W - DOOR_W * 0.6, rng());
        walls.push({ x: e.x, y: e.y, w: gap, h: e.h });
        walls.push({ x: e.x + gap + DOOR_W, y: e.y, w: e.w - gap - DOOR_W, h: e.h });
      } else {
        if (e.h < DOOR_W + 1.0) { walls.push(e); continue; }
        const gap = lerp(DOOR_W * 0.6, e.h - DOOR_W - DOOR_W * 0.6, rng());
        walls.push({ x: e.x, y: e.y, w: e.w, h: gap });
        walls.push({ x: e.x, y: e.y + gap + DOOR_W, w: e.w, h: e.h - gap - DOOR_W });
      }
    }
  }
  const nProps = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < nProps; i++) {
    const pw = lerp(0.4, 1.2, rng()), ph = lerp(0.4, 1.2, rng());
    const px = lerp(1.5, width - 1.5 - pw, rng()), py = lerp(1.5, height - 1.5 - ph, rng());
    walls.push({ x: px, y: py, w: pw, h: ph, prop: true });
  }
  return { width, height, walls, rooms };
}

/* ------------------------------- world (rect-list occupancy, mirrors sim/world.py) --- */
export class World {
  constructor(width, height, walls) { this.width = width; this.height = height; this.walls = walls; }
  hit(x, y) {
    for (const w of this.walls) if (x > w.x && x < w.x + w.w && y > w.y && y < w.y + w.h) return true;
    return false;
  }
  isFree(x, y, r = 0) {
    if (x - r < 0 || y - r < 0 || x + r > this.width || y + r > this.height) return false;
    const offs = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [.7 * r, .7 * r], [-.7 * r, .7 * r], [.7 * r, -.7 * r], [-.7 * r, -.7 * r]];
    for (const [ox, oy] of offs) if (this.hit(x + ox, y + oy)) return false;
    return true;
  }
  ray(x, y, a, maxR) {
    const step = 0.04, ca = Math.cos(a), sa = Math.sin(a);
    for (let d = 0; d < maxR; d += step) if (this.hit(x + ca * d, y + sa * d)) return d;
    return maxR;
  }
  lineOfSight(x0, y0, x1, y1) {
    const d = hyp(x1 - x0, y1 - y0);
    return this.ray(x0, y0, Math.atan2(y1 - y0, x1 - x0), d) >= d - 0.2;
  }
  randomFreePoint(rng, margin = 0.5, avoid = null, minDist = 0) {
    for (let tries = 0; tries < 4000; tries++) {
      const x = lerp(1, this.width - 1, rng()), y = lerp(1, this.height - 1, rng());
      if (!this.isFree(x, y, margin)) continue;
      if (avoid && hyp(x - avoid[0], y - avoid[1]) < minDist) continue;
      return [x, y];
    }
    return [this.width / 2, this.height / 2];
  }
}

/* ------------------------------- RRT* planner (mirrors planning/rrtstar.py) ------------ */
export class CostMap {
  constructor(world, margin = 0.08) { this.world = world; this.r = ROBOT_RADIUS + margin; }
  free(p) { return this.world.isFree(p[0], p[1], this.r); }
  segmentFree(a, b) {
    const n = Math.max(2, Math.ceil(hyp(b[0] - a[0], b[1] - a[1]) / 0.05) + 1);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (!this.free([lerp(a[0], b[0], t), lerp(a[1], b[1], t)])) return false;
    }
    return true;
  }
  nearestFree(p, maxR = 1.0) {
    if (this.free(p)) return p.slice();
    for (let r = 0.05; r < maxR; r += 0.05) {
      const nAng = Math.max(8, Math.round((2 * Math.PI * r) / 0.05));
      for (let i = 0; i < nAng; i++) {
        const ang = (2 * Math.PI * i) / nAng;
        const c = [p[0] + r * Math.cos(ang), p[1] + r * Math.sin(ang)];
        if (this.free(c)) return c;
      }
    }
    return null;
  }
}

/** Sampling-based motion planner, same interface the real backend's `Planner` protocol expects.
 *  In the Python codebase this is `RRTStar` (src/firebot/planning/rrtstar.py); an
 *  `OMPLPlanner` (src/firebot/planning/ompl_planner.py) backed by the real OMPL library --
 *  InformedRRTstar via `pip install ompl` -- is a drop-in swap there. OMPL itself is a C++/Python
 *  library with no browser build, so this in-page demo runs the same informed-RRT* *algorithm*
 *  in plain JS; the numbers won't be bit-identical to the server-side OMPL run, but the search
 *  behaviour -- tree growth, rewiring, shortcutting -- is the same family of planner. */
export class RRTStar {
  constructor(world, rng, opts = {}) {
    this.world = world; this.rng = rng; this.cmap = new CostMap(world);
    this.step = opts.step ?? 0.55; this.maxIter = opts.maxIter ?? 1400; this.goalBias = opts.goalBias ?? 0.12;
    this.goalTol = opts.goalTol ?? 0.28; this.gamma = opts.gamma ?? 2.5; this.smoothIter = opts.smoothIter ?? 50;
  }
  plan(start, goal) {
    const rng = this.rng;
    const s = this.cmap.nearestFree(start), g = this.cmap.nearestFree(goal);
    const tree = [];
    if (!s || !g) return { path: null, tree };
    if (this.cmap.segmentFree(s, g)) return { path: this._finish([start.slice(), g]), tree };
    const pts = [s], parent = [-1], cost = [0];
    let best = -1, bestCost = Infinity;
    for (let it = 0; it < this.maxIter; it++) {
      const q = rng() < this.goalBias ? g : [lerp(0, this.world.width, rng()), lerp(0, this.world.height, rng())];
      let bi = 0, bd = Infinity;
      for (let i = 0; i < pts.length; i++) { const d = hyp(pts[i][0] - q[0], pts[i][1] - q[1]); if (d < bd) { bd = d; bi = i; } }
      const d = Math.max(bd, 1e-9);
      const dirx = (q[0] - pts[bi][0]) / d, diry = (q[1] - pts[bi][1]) / d;
      const stepLen = Math.min(this.step, bd);
      const nw = [pts[bi][0] + dirx * stepLen, pts[bi][1] + diry * stepLen];
      if (!this.cmap.free(nw) || !this.cmap.segmentFree(pts[bi], nw)) continue;
      const n = pts.length;
      const r = Math.min(this.gamma * Math.sqrt(Math.log(n + 1) / (n + 1)) * 2.0, 2.0 * this.step);
      const near = [];
      for (let i = 0; i < pts.length; i++) { const dn = hyp(pts[i][0] - nw[0], pts[i][1] - nw[1]); if (dn <= Math.max(r, this.step)) near.push([i, dn]); }
      let pBest = bi, cBest = cost[bi] + hyp(nw[0] - pts[bi][0], nw[1] - pts[bi][1]);
      near.sort((A, B) => cost[A[0]] + A[1] - (cost[B[0]] + B[1]));
      for (const [j, dn] of near) {
        const cj = cost[j] + dn;
        if (cj < cBest && this.cmap.segmentFree(pts[j], nw)) { pBest = j; cBest = cj; break; }
      }
      pts.push(nw); parent.push(pBest); cost.push(cBest);
      const ni = pts.length - 1;
      tree.push([pts[pBest], nw]);
      for (const [j, dn] of near) {
        const cj = cBest + dn;
        if (cj < cost[j] && this.cmap.segmentFree(nw, pts[j])) { parent[j] = ni; cost[j] = cj; }
      }
      if (hyp(nw[0] - g[0], nw[1] - g[1]) < this.goalTol && this.cmap.segmentFree(nw, g)) {
        const total = cBest + hyp(g[0] - nw[0], g[1] - nw[1]);
        if (total < bestCost) { best = ni; bestCost = total; }
      }
    }
    if (best < 0) return { path: null, tree };
    let path = [g], k = best;
    while (k >= 0) { path.push(pts[k]); k = parent[k]; }
    path.reverse();
    path[0] = start.slice();
    return { path: this._finish(path), tree };
  }
  _finish(path) {
    for (let i = 0; i < this.smoothIter && path.length >= 3; i++) {
      let a = Math.floor(this.rng() * path.length), b = Math.floor(this.rng() * path.length);
      if (a > b) [a, b] = [b, a];
      if (b - a > 1 && this.cmap.segmentFree(path[a], path[b])) path = [...path.slice(0, a + 1), ...path.slice(b)];
    }
    return path;
  }
}
export function pathLength(path) {
  let L = 0;
  for (let i = 1; i < path.length; i++) L += hyp(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return L;
}
/** Pure-pursuit path follower (mirrors planning/controller.py::follow_path). Returns normalised
 *  [v, w] or null on arrival. */
export function followPath(path, pose, lookahead = 0.6) {
  const p = [pose[0], pose[1]];
  const last = path[path.length - 1];
  if (hyp(last[0] - p[0], last[1] - p[1]) < 0.25) return null;
  let k = 0, bestD = Infinity, bestProj = path[0];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const abx = b[0] - a[0], aby = b[1] - a[1];
    const segLen2 = Math.max(abx * abx + aby * aby, 1e-9);
    const t = clamp(((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / segLen2, 0, 1);
    const proj = [a[0] + abx * t, a[1] + aby * t];
    const d = hyp(proj[0] - p[0], proj[1] - p[1]);
    if (d < bestD) { bestD = d; k = i; bestProj = proj; }
  }
  let remaining = lookahead, pos = bestProj, i = k, target = last;
  for (;;) {
    const left = hyp(path[i + 1][0] - pos[0], path[i + 1][1] - pos[1]);
    if (left >= remaining) { const t = remaining / Math.max(left, 1e-9); target = [pos[0] + (path[i + 1][0] - pos[0]) * t, pos[1] + (path[i + 1][1] - pos[1]) * t]; break; }
    remaining -= left; pos = path[i + 1]; i += 1;
    if (i >= path.length - 1) { target = last; break; }
  }
  const err = wrapA(Math.atan2(target[1] - p[1], target[0] - p[0]) - pose[2]);
  const w = clamp(2.5 * err, -WMAX, WMAX);
  // cos(err) tapers continuously to 0 near +/-90 deg heading error and clips there -- no hard
  // cutoff, no speed floor (mirrors planning/controller.py::follow_path). Either of those makes
  // a discontinuity that a jittery pursuit-target angle (any path with a kink, RRT* included)
  // turns into visible stutter between full speed and a dead stop.
  const v = VMAX * clamp(Math.cos(err), 0.0, 1.0);
  return [v / VMAX, w / WMAX];
}

/* ------------------------------- sensors (mirrors sim/sensors.py) --------------------- */
export function readSensors(world, fire, rx, ry, th, rng) {
  const N = () => Math.sqrt(-2 * Math.log(1 - rng() + 1e-12)) * Math.cos(6.283185307 * rng());
  const dx = fire.x - rx, dy = fire.y - ry, d = hyp(dx, dy), ba = Math.atan2(dy, dx);
  const vis = fire.p > 0 && d < 9 && world.lineOfSight(rx, ry, fire.x, fire.y);
  const out = {};
  for (const [name, a] of Object.entries(US_ANGLES)) out[name] = clamp(world.ray(rx, ry, th + a, 4.0) + N() * 0.02, 0.02, 4.0);
  for (const [name, a] of Object.entries(FLAME_ANGLES)) {
    const b = wrapA(ba - th - a);
    const v = vis && Math.abs(b) < 0.6 ? fire.p * (1 - Math.abs(b) / 0.6) * Math.min(1.0, 3.0 / Math.max(d, 1e-3)) : 0;
    out[name] = v ? clamp(v + N() * 0.02, 0, 1) : Math.max(0, N() * 0.01);
  }
  const gas = fire.p * Math.exp(-d / 4.0);
  out.mq2_front = clamp(gas + N() * 0.02, 0, 1);
  out.mq2_rear = clamp(gas * 0.9 + N() * 0.02, 0, 1);
  const b0 = wrapA(ba - th);
  out.seen = vis && Math.abs(b0) < HFOV / 2;
  out.bearing = b0; out.dist = d;
  out.peakTemp = 25.0 + (out.seen ? (fire.p * 320) / (1 + d * d * 0.3) : 0) + N() * 0.4;
  const frame = new Float32Array(THERM_ROWS * THERM_COLS);
  for (let i = 0; i < frame.length; i++) frame[i] = 25.0 + N() * 0.3;
  if (out.seen) {
    const col = 15.5 - (b0 / HFOV) * THERM_COLS;
    const amp = out.peakTemp - 25;
    for (let r = 0; r < THERM_ROWS; r++) for (let c = 0; c < THERM_COLS; c++) {
      const dr = r - 12, dc = c - col;
      frame[r * THERM_COLS + c] += amp * Math.exp(-(dc * dc + dr * dr) / (2 * 1.5 * 1.5));
    }
  }
  out.thermal = frame;
  return out;
}

/* ------------------------------- EIF fire-source estimator ---------------------------- */
export class EIF {
  constructor() { this.Y = [[0.01, 0], [0, 0.01]]; this.yv = [0.06, 0.04]; }
  estimate() {
    const [[a, b], [c, d]] = this.Y;
    const det = a * d - b * c;
    const Pinv = [[d / det, -b / det], [-c / det, a / det]];
    const x = Pinv[0][0] * this.yv[0] + Pinv[0][1] * this.yv[1];
    const y = Pinv[1][0] * this.yv[0] + Pinv[1][1] * this.yv[1];
    return { x, y, P: Pinv };
  }
  update(z, sigma, rx, ry) {
    // small forgetting factor: bearing-only fusion from a single, slowly-moving observer is
    // prone to becoming falsely "confident" in a wrong direction when consecutive bearings are
    // nearly co-linear (a near-singular information matrix). Bleeding off a little certainty each
    // update keeps a bad lock recoverable instead of numerically permanent.
    const decay = 0.996;
    this.Y = this.Y.map((row) => row.map((v) => v * decay));
    this.yv = this.yv.map((v) => v * decay);
    const e = this.estimate();
    const dx = e.x - rx, dy = e.y - ry, r2 = dx * dx + dy * dy + 1e-6;
    const H = [-dy / r2, dx / r2];
    const ri = 1 / (sigma * sigma);
    const innov = wrapA(z - Math.atan2(dy, dx)) + H[0] * e.x + H[1] * e.y;
    for (let i = 0; i < 2; i++) {
      this.yv[i] += H[i] * ri * innov;
      for (let j = 0; j < 2; j++) this.Y[i][j] += H[i] * H[j] * ri;
    }
  }
}

/* ------------------------------- voice / command grammar (mirrors command/{intents,parser}.py) */
const CMD_MARGIN = 0.5;
export function makePlaces(world) {
  const W = world.width, H = world.height;
  return {
    home: [1.3, 1.1], base: [1.3, 1.1], dock: [1.3, 1.1],
    center: [W / 2, H / 2], middle: [W / 2, H / 2],
    north: [W / 2, H - 1.2], south: [W / 2, 1.2], east: [W - 1.2, H / 2], west: [1.2, H / 2],
    northeast: [W - 1.2, H - 1.2], northwest: [1.2, H - 1.2], southeast: [W - 1.2, 1.2], southwest: [1.2, 1.2],
  };
}
const ALIASES = { top: 'north', bottom: 'south', right: 'east', left: 'west', upper: 'north', lower: 'south' };
const RE_STOP = /\b(stop|halt|freeze|abort|cancel|emergency|e-?stop|hold (on|up|position)|shut ?(it )?(off|down)|kill (it|the pump)|enough|whoa)\b/;
const RE_STATUS = /\b(status|report|state|how (much|is|are)|where are you|what do you see|any (fire|flame)|tank|water level|battery|what'?s (going on|happening))\b/;
const RE_HOME = /\b(go|come|head|return|get|move|drive)?\s*(back )?(to )?\b(home|base|dock|charging)\b|\bcome back\b|\breturn\b/;
const RE_GOTO = /\b(go|move|drive|head|navigate|travel|proceed|come|position)\b/;
const RE_FIRE = /\b(fire|flame|flames|blaze|burning|smoke)\b/;
const RE_EXT = /\b(put out|extinguish|douse|suppress|spray|fight|find|search|start|begin|resume|carry on|continue|auto|autonomous|patrol|explore|deal with|handle)\b/;
const RE_COORD = /\bx\s*[=:]?\s*(-?\d+(?:\.\d+)?)[\s,;and]*y\s*[=:]?\s*(-?\d+(?:\.\d+)?)|\(?\s*(-?\d+(?:\.\d+)?)\s*(?:,|\s)\s*(-?\d+(?:\.\d+)?)\s*\)?/;
function normalise(t) { return t.toLowerCase().trim().replace(/[^\w\s.,()=:;-]/g, ' ').replace(/\s+/g, ' '); }
function placeFor(t, places) {
  const words = (t.match(/[a-z]+/g) || []).map((w) => ALIASES[w] || w);
  for (const name of Object.keys(places)) {
    if (['north', 'south', 'east', 'west'].includes(name)) continue;
    if (words.includes(name)) return places[name];
  }
  const ns = words.find((w) => w === 'north' || w === 'south') || '';
  const ew = words.find((w) => w === 'east' || w === 'west') || '';
  const key = ns + ew;
  if (places[key]) return places[key];
  return places[ns || ew] || null;
}
export function parseIntent(text, world) {
  const t = normalise(text);
  const places = makePlaces(world);
  const mk = (name, params = {}) => ({ name, params, text: t, confidence: 1.0, source: 'rules' });
  if (RE_STOP.test(t)) return mk('STOP');
  const m = RE_GOTO.test(t) || t.includes('x') ? RE_COORD.exec(t) : null;
  if (m) {
    const g = [m[1], m[2], m[3], m[4]].filter((v) => v != null);
    if (g.length >= 2) {
      const x = clamp(parseFloat(g[0]), CMD_MARGIN, world.width - CMD_MARGIN);
      const y = clamp(parseFloat(g[1]), CMD_MARGIN, world.height - CMD_MARGIN);
      return mk('GOTO', { x, y });
    }
  }
  if (RE_STATUS.test(t) && !RE_EXT.test(t)) return mk('STATUS');
  if (RE_HOME.test(t)) return mk('RETURN_HOME');
  if (RE_GOTO.test(t) && !RE_FIRE.test(t)) {
    const xy = placeFor(t, places);
    if (xy) return mk('GOTO', { x: xy[0], y: xy[1] });
  }
  if (RE_EXT.test(t) || RE_FIRE.test(t)) return mk('EXTINGUISH');
  if (RE_STATUS.test(t)) return mk('STATUS');
  return { name: 'UNKNOWN', params: {}, text: t, confidence: 0.0, source: 'rules' };
}
