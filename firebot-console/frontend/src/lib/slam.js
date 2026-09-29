// Mapping, localisation and exploration for the in-browser simulator.
//
//   lidarScan      simulated 360 deg 2D range scanner (ground-truth raycast + noise)
//   OccupancyMap   log-odds occupancy grid built from scans (Bresenham free-space carving)
//   SlamLite       dead-reckoned pose (noisy odometry + gyro bias) corrected by correlative
//                  scan-to-map matching, then the scan is integrated at the corrected pose
//   MapCostMap     planner-facing view of the map (inflated by robot radius; unknown cells are
//                  either blocked -- exploration -- or optimistic -- goto / fire approach)
//   nextBestView   frontier clustering + raycast information gain, discounted by path cost
//
// Everything downstream of the scan (planner, controller, NBV) sees only this map and this pose
// estimate. Ground truth is used for physics, the sensor raycasts and the error readout only.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const hyp = (dx, dy) => Math.sqrt(dx * dx + dy * dy);

export const SCAN_BEAMS = 360, SCAN_RANGE = 7.0, MAP_RES = 0.15;
const L_OCC = 0.85, L_FREE = -0.35, L_MIN = -4, L_MAX = 4, OCC_T = 0.2;

const BEAM_ANGLES = new Float32Array(SCAN_BEAMS);
for (let i = 0; i < SCAN_BEAMS; i++) BEAM_ANGLES[i] = -Math.PI + (2 * Math.PI * i) / SCAN_BEAMS;

const gauss = (rng) => Math.sqrt(-2 * Math.log(1 - rng() + 1e-12)) * Math.cos(6.283185307 * rng());

/* ------------------------------- lidar ---------------------------------------------------- */
export function lidarScan(world, x, y, th, rng) {
  const ranges = new Float32Array(SCAN_BEAMS), hit = new Uint8Array(SCAN_BEAMS);
  for (let i = 0; i < SCAN_BEAMS; i++) {
    const r = world.ray(x, y, th + BEAM_ANGLES[i], SCAN_RANGE);
    if (r < SCAN_RANGE - 1e-6) { hit[i] = 1; ranges[i] = clamp(r + gauss(rng) * 0.015, 0.05, SCAN_RANGE); }
    else ranges[i] = SCAN_RANGE;
  }
  return { angles: BEAM_ANGLES, ranges, hit, maxR: SCAN_RANGE };
}

/* ------------------------------- binary heap (Dijkstra) ------------------------------------ */
class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop();
    const n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

/* ------------------------------- occupancy grid -------------------------------------------- */
export class OccupancyMap {
  constructor(width, height, res = MAP_RES) {
    this.res = res; this.width = width; this.height = height;
    this.nx = Math.ceil(width / res); this.ny = Math.ceil(height / res);
    this.L = new Float32Array(this.nx * this.ny);
    this.known = new Uint8Array(this.nx * this.ny);
    this.version = 0;
    this._infl = null; this._inflKey = '';
  }
  inB(ix, iy) { return ix >= 0 && iy >= 0 && ix < this.nx && iy < this.ny; }
  cx(x) { return Math.floor(x / this.res); }
  center(ix, iy) { return [(ix + 0.5) * this.res, (iy + 0.5) * this.res]; }
  isOcc(i) { return this.known[i] === 1 && this.L[i] > OCC_T; }
  _upd(i, d) { this.known[i] = 1; this.L[i] = clamp(this.L[i] + d, L_MIN, L_MAX); }

  _trace(x0, y0, x1, y1, hit) {
    const nx = this.nx, ny = this.ny;
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, x = x0, y = y0;
    for (let guard = 0; guard < 4000; guard++) {
      if (x >= 0 && y >= 0 && x < nx && y < ny) {
        const last = x === x1 && y === y1;
        this._upd(y * nx + x, last && hit ? L_OCC : L_FREE);
      }
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }

  /** Carve free space along every beam and mark the return cell occupied. */
  integrate(px, py, th, scan) {
    const r = this.res, x0 = Math.floor(px / r), y0 = Math.floor(py / r);
    for (let k = 0; k < scan.ranges.length; k++) {
      const a = th + scan.angles[k], d = scan.ranges[k];
      const ex = px + Math.cos(a) * d, ey = py + Math.sin(a) * d;
      this._trace(x0, y0, Math.floor(ex / r), Math.floor(ey / r), scan.hit[k] === 1);
    }
    this.version++;
  }

  /** Occupied cells dilated by radius R metres (cached per map version). */
  inflated(R) {
    const key = `${this.version}:${R}`;
    if (this._inflKey === key) return this._infl;
    const n = Math.ceil(R / this.res), offs = [];
    for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) if (hyp(dx, dy) * this.res <= R + 1e-9) offs.push([dx, dy]);
    const out = new Uint8Array(this.nx * this.ny);
    for (let iy = 0; iy < this.ny; iy++) for (let ix = 0; ix < this.nx; ix++) {
      if (!this.isOcc(iy * this.nx + ix)) continue;
      for (const [dx, dy] of offs) {
        const x = ix + dx, y = iy + dy;
        if (x >= 0 && y >= 0 && x < this.nx && y < this.ny) out[y * this.nx + x] = 1;
      }
    }
    this._infl = out; this._inflKey = key;
    return out;
  }

  knownFreeCount() {
    let n = 0;
    for (let i = 0; i < this.known.length; i++) if (this.known[i] && this.L[i] <= OCC_T) n++;
    return n;
  }
  occupiedCount() {
    let n = 0;
    for (let i = 0; i < this.known.length; i++) if (this.isOcc(i)) n++;
    return n;
  }
  /** Same contract as World.lineOfSight (simEngine.js), but against what's actually been mapped:
   *  a known-occupied cell blocks the view, an unmapped cell does not. Used wherever the planner
   *  needs "can the robot's own understanding of the world see X", not ground truth. */
  lineOfSight(x0, y0, x1, y1) {
    const d = hyp(x1 - x0, y1 - y0), res = this.res;
    const n = Math.max(2, Math.ceil(d / (res * 0.9)));
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      const ix = Math.floor(x / res), iy = Math.floor(y / res);
      if (!this.inB(ix, iy)) continue;
      if (this.isOcc(iy * this.nx + ix)) return false;
    }
    return true;
  }
}

/* ------------------------------- planner-facing cost map ----------------------------------- */
export class MapCostMap {
  constructor(map, R, unknownFree) {
    this.map = map; this.R = R; this.unknownFree = unknownFree;
    this.blocked = map.inflated(R);
    this.edge = Math.ceil(R / map.res);
  }
  freeCell(ix, iy) {
    const m = this.map;
    if (ix < this.edge || iy < this.edge || ix >= m.nx - this.edge || iy >= m.ny - this.edge) return false;
    const i = iy * m.nx + ix;
    if (this.blocked[i]) return false;
    return m.known[i] === 1 ? true : this.unknownFree;
  }
  free(p) { return this.freeCell(Math.floor(p[0] / this.map.res), Math.floor(p[1] / this.map.res)); }
  segmentFree(a, b) {
    const n = Math.max(2, Math.ceil(hyp(b[0] - a[0], b[1] - a[1]) / 0.05) + 1);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (!this.free([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])) return false;
    }
    return true;
  }
  nearestFree(p, maxR = 1.0) {
    if (this.free(p)) return p.slice();
    for (let r = 0.05; r < maxR; r += 0.05) {
      const nAng = Math.max(8, Math.round((2 * Math.PI * r) / 0.05));
      for (let i = 0; i < nAng; i++) {
        const ang = (2 * Math.PI * i) / nAng, c = [p[0] + r * Math.cos(ang), p[1] + r * Math.sin(ang)];
        if (this.free(c)) return c;
      }
    }
    return null;
  }
  /** Sampling box for RRT*: known-traversable extent (exploration) or the whole floor. */
  sampleBox(extra = []) {
    const m = this.map;
    if (this.unknownFree) return [0, 0, m.width, m.height];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let iy = 0; iy < m.ny; iy++) for (let ix = 0; ix < m.nx; ix++) {
      if (!this.freeCell(ix, iy)) continue;
      x0 = Math.min(x0, ix); x1 = Math.max(x1, ix); y0 = Math.min(y0, iy); y1 = Math.max(y1, iy);
    }
    for (const p of extra) { x0 = Math.min(x0, p[0] / m.res); x1 = Math.max(x1, p[0] / m.res); y0 = Math.min(y0, p[1] / m.res); y1 = Math.max(y1, p[1] / m.res); }
    if (!isFinite(x0)) return [0, 0, m.width, m.height];
    return [(x0 - 2) * m.res, (y0 - 2) * m.res, (x1 + 3) * m.res, (y1 + 3) * m.res];
  }
}

const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

/** Dijkstra over traversable cells. Returns metres-to-cell and parent pointers; stops early at `target`. */
export function dijkstra(cm, startXY, targetXY = null) {
  const m = cm.map, nx = m.nx, N = nx * m.ny, res = m.res;
  const dist = new Float32Array(N).fill(Infinity), parent = new Int32Array(N).fill(-1);
  const s = [Math.floor(startXY[0] / res), Math.floor(startXY[1] / res)];
  if (!cm.freeCell(s[0], s[1])) return { dist, parent, ok: false };
  const tIdx = targetXY ? Math.floor(targetXY[1] / res) * nx + Math.floor(targetXY[0] / res) : -1;
  const h = new MinHeap(); dist[s[1] * nx + s[0]] = 0; h.push(0, s[1] * nx + s[0]);
  // Lazy-deletion Dijkstra can push more than one entry per node (stale ones are just skipped
  // when popped), but it can never push more than once per relaxing edge -- so total pushes are
  // hard-bounded by edge count. Guard anyway so a future bug degrades to "gives up" rather than
  // growing the heap arrays without limit.
  const guardMax = N8.length * N + 64;
  let pushes = 1;
  while (h.size) {
    const i = h.pop(), ix = i % nx, iy = (i / nx) | 0, d0 = dist[i];
    if (i === tIdx) break;
    if (d0 > dist[i]) continue; // stale heap entry from an earlier, worse relaxation
    for (const [dx, dy, w] of N8) {
      const x = ix + dx, y = iy + dy;
      if (!cm.freeCell(x, y)) continue;
      const j = y * nx + x, nd = d0 + w * res;
      if (nd < dist[j]) {
        dist[j] = nd; parent[j] = i;
        if (pushes++ > guardMax) return { dist, parent, ok: true, tIdx };
        h.push(nd, j);
      }
    }
  }
  return { dist, parent, ok: true, tIdx };
}

/** Grid path (fallback / exploration) -> simplified waypoint list, or null. */
export function gridPath(cm, startXY, goalXY) {
  const s = cm.nearestFree(startXY, 1.0), g = cm.nearestFree(goalXY, 1.0);
  if (!s || !g) return null;
  const m = cm.map, { dist, parent, tIdx } = dijkstra(cm, s, g);
  if (!(dist[tIdx] < Infinity)) return null;
  const pts = []; let k = tIdx;
  while (k >= 0) { pts.push(m.center(k % m.nx, (k / m.nx) | 0)); k = parent[k]; }
  pts.reverse();
  pts[0] = startXY.slice(); pts.push(goalXY.slice());
  const out = [pts[0]]; let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !cm.segmentFree(pts[i], pts[j])) j--;
    out.push(pts[j]); i = j;
  }
  return out;
}

/* ------------------------------- SLAM front end -------------------------------------------- */
export class SlamLite {
  constructor(world, pose, rng, opts = {}) {
    this.world = world; this.rng = rng;
    this.map = new OccupancyMap(world.width, world.height, MAP_RES);
    this.pose = { x: pose.x, y: pose.y, th: pose.th };
    this.truth = { ...pose };
    this.gyroBias = (rng() - 0.5) * 2 * (opts.gyroBias ?? 0.0009);   // rad/s, unobservable to odometry
    this.transNoise = opts.transNoise ?? 0.02;                       // 2 % of distance
    this.rotNoise = opts.rotNoise ?? 0.012;
    this.freeTotal = world.countFree(MAP_RES);
    this.stats = { scans: 0, matched: 0, rejected: 0, lastShift: 0, lastScore: 0 };
    this.odomOnly = { x: pose.x, y: pose.y, th: pose.th };           // what dead-reckoning alone would say
    this.errHistory = [];
  }

  /** Integrate one tick of wheel/gyro odometry. dist and dth are the *true* motion; noise is added here. */
  predict(dist, dth, dt) {
    const rng = this.rng;
    const d = dist > 0 ? dist + gauss(rng) * (this.transNoise * dist + 0.0005) : 0;
    const dthm = dth + gauss(rng) * (this.rotNoise * Math.abs(dth) + 0.0004) + this.gyroBias * dt;
    for (const p of [this.pose, this.odomOnly]) {
      const thm = p.th + dthm / 2;
      p.x += d * Math.cos(thm); p.y += d * Math.sin(thm); p.th = wrapA(p.th + dthm);
    }
  }

  _pts(scan, stride) {
    const xs = [], ys = [];
    for (let i = 0; i < scan.ranges.length; i += stride) {
      if (!scan.hit[i]) continue;
      const a = scan.angles[i], r = scan.ranges[i];
      xs.push(r * Math.cos(a)); ys.push(r * Math.sin(a));
    }
    return { xs, ys, n: xs.length };
  }
  _score(pts, px, py, pth) {
    const m = this.map, res = m.res, nx = m.nx, ny = m.ny, c = Math.cos(pth), s = Math.sin(pth);
    let sc = 0;
    for (let k = 0; k < pts.n; k++) {
      const wx = px + c * pts.xs[k] - s * pts.ys[k], wy = py + s * pts.xs[k] + c * pts.ys[k];
      const ix = Math.floor(wx / res), iy = Math.floor(wy / res);
      if (ix < 1 || iy < 1 || ix >= nx - 1 || iy >= ny - 1) continue;
      const i = iy * nx + ix;
      if (m.isOcc(i)) sc += 1;
      else if (m.isOcc(i - 1) || m.isOcc(i + 1) || m.isOcc(i - nx) || m.isOcc(i + nx)) sc += 0.45;
    }
    return sc / Math.max(1, pts.n);
  }
  _obj(pts, x, y, th, p0, dLim, aLim) {
    const dxy = hyp(x - p0.x, y - p0.y), dth = wrapA(th - p0.th);
    return this._score(pts, x, y, th) - 0.15 * (dxy / dLim) ** 2 - 0.15 * (dth / aLim) ** 2;
  }

  /** Coarse-to-fine correlative scan matching around the dead-reckoned pose. */
  _match(scan) {
    if (this.map.occupiedCount() < 60) return false;
    const p0 = { ...this.pose };
    const coarse = this._pts(scan, 4);
    if (coarse.n < 25) return false;
    const search = (pts, cx, cy, cth, dxyMax, dxyStep, dthMax, dthStep, dLim, aLim) => {
      let best = -Infinity, bx = cx, by = cy, bth = cth;
      for (let ox = -dxyMax; ox <= dxyMax + 1e-9; ox += dxyStep)
        for (let oy = -dxyMax; oy <= dxyMax + 1e-9; oy += dxyStep)
          for (let ot = -dthMax; ot <= dthMax + 1e-9; ot += dthStep) {
            const o = this._obj(pts, cx + ox, cy + oy, cth + ot, p0, dLim, aLim);
            if (o > best) { best = o; bx = cx + ox; by = cy + oy; bth = cth + ot; }
          }
      return { best, x: bx, y: by, th: wrapA(bth) };
    };
    const c1 = search(coarse, p0.x, p0.y, p0.th, 0.3, 0.1, 0.12, 0.04, 0.3, 0.12);
    const fine = this._pts(scan, 2);
    const c2 = search(fine, c1.x, c1.y, c1.th, 0.06, 0.02, 0.03, 0.01, 0.3, 0.12);
    const base = this._obj(fine, p0.x, p0.y, p0.th, p0, 0.3, 0.12);
    if (c2.best < base + 0.02) return false;
    this.stats.lastShift = hyp(c2.x - p0.x, c2.y - p0.y);
    this.stats.lastScore = c2.best;
    this.pose.x = c2.x; this.pose.y = c2.y; this.pose.th = c2.th;
    return true;
  }

  /** One SLAM update: match the scan to the map, then fold it into the map at the corrected pose. */
  update(scan, truePose) {
    this.truth = { x: truePose.x, y: truePose.y, th: truePose.th };
    this.stats.scans++;
    if (this._match(scan)) this.stats.matched++; else this.stats.rejected++;
    this.map.integrate(this.pose.x, this.pose.y, this.pose.th, scan);
    this.errHistory.push(this.lastPoseError());
    if (this.errHistory.length > 400) this.errHistory.shift();
  }

  lastPoseError() { return hyp(this.pose.x - this.truth.x, this.pose.y - this.truth.y); }
  lastHeadingError() { return Math.abs(wrapA(this.pose.th - this.truth.th)); }
  odomOnlyError() { return hyp(this.odomOnly.x - this.truth.x, this.odomOnly.y - this.truth.y); }
  coverage() { return this.freeTotal > 0 ? clamp((100 * this.map.knownFreeCount()) / this.freeTotal, 0, 100) : 0; }
}

/* ------------------------------- next-best-view -------------------------------------------- */
const GAIN_RAYS = 32, GAIN_RANGE = 5.0, MIN_CLUSTER = 5, MIN_GAIN_M2 = 0.6, DIST_DECAY = 0.09;

function infoGain(map, x, y) {
  const res = map.res, step = res * 0.9, nx = map.nx;
  let unknown = 0;
  for (let k = 0; k < GAIN_RAYS; k++) {
    const a = (2 * Math.PI * k) / GAIN_RAYS, ca = Math.cos(a), sa = Math.sin(a);
    let lastI = -1;
    for (let d = res; d < GAIN_RANGE; d += step) {
      const ix = Math.floor((x + ca * d) / res), iy = Math.floor((y + sa * d) / res);
      if (!map.inB(ix, iy)) break;
      const i = iy * nx + ix;
      if (i === lastI) continue; lastI = i;
      if (map.isOcc(i)) break;
      if (!map.known[i]) unknown++;
    }
  }
  // each ray sample covers roughly one cell along a 1/GAIN_RAYS slice of the disc
  return (unknown / GAIN_RAYS) * (Math.PI * GAIN_RANGE) * res * 0.55;
}

/**
 * Pick the next viewpoint: cluster reachable frontier cells (known-free cells bordering unknown),
 * score each cluster's representative cell by expected new area (raycast information gain) times
 * exp(-decay * path length), and return the best plus everything considered (for the overlay).
 */
export function nextBestView(map, robotXY, opts = {}) {
  const R = opts.R ?? 0.3, blacklist = opts.blacklist ?? [];
  const cm = new MapCostMap(map, R, false);
  const s = cm.nearestFree(robotXY, 1.2);
  const empty = { target: null, candidates: [], frontier: [], reachableCells: 0 };
  if (!s) return empty;
  const { dist } = dijkstra(cm, s);
  const nx = map.nx, ny = map.ny;
  const isFront = new Uint8Array(nx * ny);
  const fr = [];
  let reachable = 0;
  for (let iy = 1; iy < ny - 1; iy++) for (let ix = 1; ix < nx - 1; ix++) {
    const i = iy * nx + ix;
    if (!(dist[i] < Infinity)) continue;
    reachable++;
    if (!map.known[i - 1] || !map.known[i + 1] || !map.known[i - nx] || !map.known[i + nx]) { isFront[i] = 1; fr.push(i); }
  }
  const seen = new Uint8Array(nx * ny), clusters = [];
  for (const start of fr) {
    if (seen[start]) continue;
    const stack = [start], cells = []; seen[start] = 1;
    while (stack.length) {
      const i = stack.pop(); cells.push(i);
      const ix = i % nx, iy = (i / nx) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const j = (iy + dy) * nx + ix + dx;
        if (isFront[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    if (cells.length >= MIN_CLUSTER) clusters.push(cells);
  }
  const candidates = [];
  for (const cells of clusters) {
    let mx = 0, my = 0;
    for (const i of cells) { mx += i % nx; my += (i / nx) | 0; }
    mx /= cells.length; my /= cells.length;
    let bi = cells[0], bd = Infinity;
    for (const i of cells) { const d = hyp((i % nx) - mx, ((i / nx) | 0) - my); if (d < bd) { bd = d; bi = i; } }
    const [x, y] = map.center(bi % nx, (bi / nx) | 0), d = dist[bi];
    if (blacklist.some(([bx, by, br]) => hyp(x - bx, y - by) < br)) continue;
    const gain = infoGain(map, x, y);
    candidates.push({ x, y, size: cells.length, dist: d, gain, score: gain * Math.exp(-DIST_DECAY * d) });
  }
  candidates.sort((a, b) => b.score - a.score);
  const usable = candidates.filter((c) => c.gain >= MIN_GAIN_M2);
  const frontier = [];
  const stride = Math.max(1, Math.ceil(fr.length / 700));
  for (let k = 0; k < fr.length; k += stride) frontier.push(map.center(fr[k] % nx, (fr[k] / nx) | 0));
  return { target: usable[0] ?? null, candidates: candidates.slice(0, 12), frontier, reachableCells: reachable };
}
