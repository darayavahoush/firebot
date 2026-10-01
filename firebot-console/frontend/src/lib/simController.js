import {
  mulberry32, generateBuilding, World, RRTStar, pathLength, followPath,
  readSensors, EIF, makePlaces, parseIntent, VMAX, WMAX, SPRAY_RANGE, SPRAY_CONE,
  EXTINGUISH_RATE, WATER_RATE, BATTERY_RATE, ROBOT_RADIUS,
} from './simEngine.js';
import { lidarScan, SlamLite, MapCostMap, nextBestView } from './slam.js';

const SCAN_PERIOD = 0.2;          // s of sim time between lidar/SLAM updates (5 Hz)
const FACE_FIRE_TOL = 0.35;       // rad (~20deg) nozzle/heading-to-fire error counted as "facing it"
const toDeg = (r) => (r * 180) / Math.PI;

const STANDOFF = 1.8, LOOKAHEAD = 0.6, REPLAN_EVERY = 4.0, RETRY_AFTER = 1.5, GOAL_SHIFT = 0.7;
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hyp = (dx, dy) => Math.sqrt(dx * dx + dy * dy);
const sigmaOf = (est) => Math.sqrt(Math.max(est.P[0][0], est.P[1][1], 1e-9));

/** Cheap frontier-ish exploration target: sample several candidates, prefer whichever is
 *  farthest from everywhere the robot has already lingered, so a big multi-room building gets
 *  covered systematically instead of the same nearby rooms getting re-sampled by chance. */
function pickExploreTarget(world, rng, visited) {
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < 10; i++) {
    const p = world.randomFreePoint(rng, 0.5);
    let minD = Infinity;
    for (const v of visited) minD = Math.min(minD, hyp(p[0] - v[0], p[1] - v[1]));
    const score = visited.length ? minD : rng();
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

function standoffPoint(world, cmap, fire, robot) {
  let best = null, bestD = Infinity;
  for (const r of [STANDOFF, STANDOFF - 0.3, STANDOFF + 0.4, STANDOFF + 0.9, STANDOFF - 0.7]) {
    for (let i = 0; i < 32; i++) {
      const a = (2 * Math.PI * i) / 32;
      const p = [fire[0] + r * Math.cos(a), fire[1] + r * Math.sin(a)];
      if (cmap.free(p) && world.lineOfSight(p[0], p[1], fire[0], fire[1])) {
        const d = hyp(p[0] - robot[0], p[1] - robot[1]);
        if (d < bestD) { best = p; bestD = d; }
      }
    }
  }
  if (best) return best;
  // cramped room, no clean ring point: walk in from the robot's own position until close enough
  // to spray range and still holding line of sight -- worse approach geometry, but it terminates.
  const d0 = hyp(fire[0] - robot[0], fire[1] - robot[1]);
  for (let t = 0; t <= 1; t += 0.04) {
    const p = [robot[0] + (fire[0] - robot[0]) * t, robot[1] + (fire[1] - robot[1]) * t];
    if (!cmap.free(p)) break;
    if (world.lineOfSight(p[0], p[1], fire[0], fire[1]) && (d0 - hyp(p[0] - robot[0], p[1] - robot[1])) <= d0 - 1.0) best = p;
  }
  return best;
}

/** Everything the Simulator page needs to run one scenario: procedurally generated building,
 *  robot + fire physics, mock sensor stream, EIF fire-source fusion, an RRT* planner for
 *  exploration/standoff routing, and a command layer that voice or typed text can drive through
 *  the same STOP / GOTO / EXTINGUISH / RETURN_HOME / STATUS intents the real robot accepts. */
export class SimController {
  constructor(seed) { this.newBuilding(seed); }

  newBuilding(seed) {
    const s = seed ?? Math.floor(Math.random() * 2 ** 31);
    this.seed = s;
    this.rng = mulberry32(s);
    const { width, height, walls, rooms } = generateBuilding(this.rng);
    this.world = new World(width, height, walls);
    this.rooms = rooms;
    this.places = makePlaces(this.world);
    const home = this.world.isFree(1.3, 1.1, 0.4) ? [1.3, 1.1] : this.world.randomFreePoint(this.rng, 0.4);
    this.home = home;
    this.robot = { x: home[0], y: home[1], th: 0.5 };
    const [fx, fy] = this.world.randomFreePoint(this.rng, 0.5, home, Math.min(width, height) * 0.5);
    this.fire = { x: fx, y: fy, p: 1.0 };
    this.eif = new EIF();
    // SLAM front end: builds its own occupancy grid from simulated lidar + noisy odometry, and
    // is what next-best-view exploration and the "known map" overlay actually see -- ground
    // truth (`this.world`) is only used for physics, raycasts and the pose-error readout.
    this.slam = new SlamLite(this.world, this.robot, this.rng);
    this.sinceScan = 0;
    this.nbv = { target: null, candidates: [], frontier: [] };
    this.exploreBlacklist = [];   // frontier targets that proved unreachable/stale: [x, y, radius]
    this.extinguishReport = [];   // {t, x, y, headingDeg, bearingToFireDeg, headingErrDeg, facingFire}
    this.orientation = null;
    this._firePrevP = 1.0;
    this.t = 0;
    this.tank = 1.0;
    this.battery = 1.0;
    this.collisions = 0;
    this.waterUsed = 0;
    this.distanceTravelled = 0;
    this.mode = 'AUTO';           // AUTO | STOPPED | GOTO
    this.state = 'EXPLORE';       // EXPLORE | TRACK | PLAN | SPRAY | SAFE
    this.path = null; this.tree = []; this.goal = null; this.goalKind = null;
    this.sincePlan = Infinity; this.fireEstAtPlan = null; this.stuckT = 0; this.lastSpeed = 0;
    this.recoveryT = 0; this.recoveryDir = 1;
    this.explorePoint = null;
    this.visited = [];
    this.sinceVisitLog = 0;
    this.trackStallT = 0;
    this.trackCooldown = 0;    this.lost = 0; this.spinT = 0;
    this.planStats = { plans: 0, failures: 0, length: 0, algorithm: 'Informed RRT* (client) \u2192 OMPL InformedRRTstar server-side' };
    this.commandLog = [];
    this.events = [];
    this.errHistory = [];
    this.lastSense = null;
    this._logEvent('scenario', `New building generated \u2013 ${width.toFixed(1)}m \u00d7 ${height.toFixed(1)}m, ${rooms.length} rooms (seed ${s})`);
  }

  /** Relocate the fire within the *current* building instead of regenerating the whole layout --
   *  for repeatedly exercising the approach-and-extinguish behavior without waiting on a fresh
   *  building or a full blind search each time. Robot position and the world/rooms are left
   *  alone; everything specific to the previous fire (EIF estimate, planner state, state
   *  machine, tank/battery so a drained tank from the last run doesn't block the next one) is
   *  reset. The point of this button is exercising TRACK -> PLAN -> SPRAY, not EXPLORE, so the
   *  EIF is seeded with a coarse initial fix (as if from a building alarm panel ping) rather than
   *  the wide-open prior `new EIF()` starts with, and the state machine drops straight into
   *  TRACK instead of EXPLORE. k=4 gives sigma=0.5, comfortably under the sigma<1.0 gate TRACK
   *  needs to start planning a standoff approach immediately; a small jitter keeps it an initial
   *  estimate rather than an omniscient one, so normal bearing fusion still has to refine it once
   *  the robot gets a direct line of sight. */
  newFire() {
    const [fx, fy] = this.world.randomFreePoint(
      this.rng, 0.5, [this.robot.x, this.robot.y], Math.min(this.world.width, this.world.height) * 0.5
    );
    this.fire = { x: fx, y: fy, p: 1.0 };
    const k = 4;
    const jx = fx + (this.rng() - 0.5) * 0.6, jy = fy + (this.rng() - 0.5) * 0.6;
    this.eif = new EIF();
    this.eif.Y = [[k, 0], [0, k]];
    this.eif.yv = [k * jx, k * jy];
    this.tank = 1.0;
    this.battery = 1.0;
    this.mode = 'AUTO';
    this.state = 'TRACK';
    this.path = null; this.tree = []; this.goal = null; this.goalKind = null;
    this.sincePlan = Infinity; this.fireEstAtPlan = null; this.stuckT = 0; this.lastSpeed = 0;
    this.recoveryT = 0; this.recoveryDir = 1;
    this.explorePoint = null;
    this.trackStallT = 0; this.trackCooldown = 0; this.lost = 0; this.spinT = 0;
    this.errHistory = [];
    this.lastSense = null;
    this.exploreBlacklist = [];
    this._firePrevP = 1.0;
    this._logEvent('scenario', `New fire placed at (${fx.toFixed(1)}, ${fy.toFixed(1)}) \u2013 approaching to extinguish (tank/battery reset)`);
  }

  _logEvent(kind, text) {
    this.events.unshift({ t: this.t, kind, text });
    if (this.events.length > 300) this.events.length = 300;
  }

  /** Feed a voice/text utterance through the same grammar the real robot's speech pipeline uses. */
  say(text) {
    const intent = this._parseAndValidate(text);
    this.commandLog.unshift({ t: this.t, text, intent: intent.name, params: intent.params, confidence: intent.confidence });
    if (this.commandLog.length > 100) this.commandLog.length = 100;
    this._applyIntent(intent);
    return intent;
  }

  applyParsedIntent(name, params = {}, text = "") {
    const intent = { name, params, text, confidence: 0.95, source: "slm" };
    this.commandLog.unshift({ t: this.t, text: text || name, intent: name, params, confidence: 0.95 });
    if (this.commandLog.length > 100) this.commandLog.length = 100;
    this._applyIntent(intent);
    return intent;
  }

  _parseAndValidate(text) {
    return parseIntent(text, this.world);
  }

  _applyIntent(intent) {
    switch (intent.name) {
      case 'STOP':
        this.mode = 'STOPPED'; this.path = null; this.pumpOn = false;
        this._logEvent('command', 'STOP \u2013 halted, pump off, latched until next command');
        break;
      case 'EXTINGUISH':
        this.mode = 'AUTO'; this.path = null;
        this._logEvent('command', 'EXTINGUISH \u2013 resuming autonomous search & suppress');
        break;
      case 'PATROL':
      case 'EXPLORE':
      case 'SEARCH':
        this.mode = 'AUTO'; this.state = 'EXPLORE'; this.explorePoint = null; this.path = null;
        this._logEvent('command', 'SEARCH \u2013 exploring structure for fires & thermal anomalies');
        break;
      case 'RETURN_HOME':
        this.mode = 'GOTO'; this.goalXY = this.home; this.path = null; this.sincePlan = Infinity;
        this._logEvent('command', 'RETURN_HOME \u2013 routing to dock');
        break;
      case 'GOTO':
        if (intent.params && intent.params.x != null && intent.params.y != null) {
          this.mode = 'GOTO'; this.goalXY = [intent.params.x, intent.params.y]; this.path = null; this.sincePlan = Infinity;
          this._logEvent('command', `GOTO (${intent.params.x.toFixed(1)}, ${intent.params.y.toFixed(1)})`);
        } else {
          this._logEvent('command', 'GOTO \u2013 missing coordinate target');
        }
        break;
      case 'DRIVE':
      case 'DRIVE_FORWARD':
      case 'DRIVE_BACK':
      case 'TURN_LEFT':
      case 'TURN_RIGHT': {
        const dir = (intent.name.startsWith('DRIVE_') || intent.name.startsWith('TURN_'))
          ? (intent.name === 'DRIVE_FORWARD' ? 'fwd' : intent.name === 'DRIVE_BACK' ? 'back' : intent.name === 'TURN_LEFT' ? 'left' : 'right')
          : (intent.params?.dir || 'fwd');
        if (dir === 'left') {
          this.robot.th = wrapA(this.robot.th + Math.PI / 4);
          this._logEvent('command', `DRIVE \u2013 pivot left 45\u00b0 (heading ${toDeg(this.robot.th).toFixed(0)}\u00b0)`);
        } else if (dir === 'right') {
          this.robot.th = wrapA(this.robot.th - Math.PI / 4);
          this._logEvent('command', `DRIVE \u2013 pivot right 45\u00b0 (heading ${toDeg(this.robot.th).toFixed(0)}\u00b0)`);
        } else if (dir === 'back' || dir === 'reverse') {
          const tx = clamp(this.robot.x - 1.2 * Math.cos(this.robot.th), 0.5, this.world.width - 0.5);
          const ty = clamp(this.robot.y - 1.2 * Math.sin(this.robot.th), 0.5, this.world.height - 0.5);
          this.mode = 'GOTO'; this.goalXY = [tx, ty]; this.path = null; this.sincePlan = Infinity;
          this._logEvent('command', `DRIVE \u2013 reversing to (${tx.toFixed(1)}, ${ty.toFixed(1)})`);
        } else if (dir === 'stop') {
          this.mode = 'STOPPED'; this.path = null;
          this._logEvent('command', 'DRIVE \u2013 halted');
        } else {
          const tx = clamp(this.robot.x + 1.5 * Math.cos(this.robot.th), 0.5, this.world.width - 0.5);
          const ty = clamp(this.robot.y + 1.5 * Math.sin(this.robot.th), 0.5, this.world.height - 0.5);
          this.mode = 'GOTO'; this.goalXY = [tx, ty]; this.path = null; this.sincePlan = Infinity;
          this._logEvent('command', `DRIVE \u2013 advancing forward to (${tx.toFixed(1)}, ${ty.toFixed(1)})`);
        }
        break;
      }
      case 'PUMP': {
        const on = intent.params?.on !== false;
        this.pumpOn = on;
        if (on) {
          this.mode = 'AUTO'; this.state = 'SPRAY';
          this._logEvent('command', 'PUMP \u2013 water pump engaged');
        } else {
          this._logEvent('command', 'PUMP \u2013 water pump disengaged');
        }
        break;
      }
      case 'STATUS': {
        const sig = sigmaOf(this.eif.estimate());
        this._logEvent('status', `tank ${(this.tank * 100 | 0)}% \u00b7 battery ${(this.battery * 100 | 0)}% \u00b7 state ${this.state} \u00b7 fire \u03c3 ${sig < 20 ? sig.toFixed(2) + 'm' : 'unlocalised'}`);
        break;
      }
      default:
        this._logEvent('command', `"${intent.text || intent.name}" not understood`);
    }
  }

  /** Planner-facing cost map built from the robot's own SLAM occupancy grid, not ground truth:
   *  cells the map has actually seen occupied are blocked (inflated by the robot's radius);
   *  everything else -- free or simply not yet scanned -- is treated as passable. That's what
   *  lets the robot plan into a frontier it hasn't fully mapped yet or toward a commanded goal
   *  across unexplored territory, the same way a real global planner runs optimistically against
   *  its current map and leans on the reactive ultrasonic backstop (see step(), below) plus
   *  replanning if something it didn't know about turns out to be in the way. */
  _slamCostMap(margin = 0.08) {
    return new MapCostMap(this.slam.map, ROBOT_RADIUS + margin, true);
  }

  _replanFor(goalXY, kind) {
    this.sincePlan = 0;
    const cmap = this._slamCostMap();
    const planner = new RRTStar(this.slam.map, this.rng, { maxIter: 1400, cmap });
    const { path, tree } = planner.plan([this.robot.x, this.robot.y], goalXY);
    this.tree = tree;
    if (!path) { this.planStats.failures += 1; this.path = null; this.goal = goalXY; this.goalKind = kind; return; }
    this.planStats.plans += 1;
    this.planStats.length = pathLength(path);
    this.path = path; this.goal = goalXY; this.goalKind = kind;
  }

  step(dt) {
    if (this.state === 'SAFE' && this.mode !== 'GOTO') { this.t += dt; return; }
    this.t += dt;
    this.sinceVisitLog += dt;
    if (this.sinceVisitLog > 1.5) {
      this.sinceVisitLog = 0;
      this.visited.push([this.robot.x, this.robot.y]);
      if (this.visited.length > 200) this.visited.shift();
    }
    const sense = readSensors(this.world, this.fire, this.robot.x, this.robot.y, this.robot.th, this.rng);
    this.lastSense = sense;
    const flamePeak = Math.max(sense.flame_left, sense.flame_center, sense.flame_right);
    const detected = sense.seen || flamePeak > 0.12;

    if (sense.seen) this.eif.update(sense.bearing, 0.04, this.robot.x, this.robot.y, this.robot.th);
    else {
      const fs = sense.flame_left + sense.flame_center + sense.flame_right;
      if (fs > 0.15) {
        const bearing = (sense.flame_left * 0.52 + sense.flame_center * 0 + sense.flame_right * -0.52) / fs;
        this.eif.update(bearing, 0.3, this.robot.x, this.robot.y, this.robot.th);
      }
    }
    const est = this.eif.estimate();
    const sigma = sigmaOf(est);
    const errTrue = hyp(est.x - this.fire.x, est.y - this.fire.y);
    this.errHistory.push(errTrue);
    if (this.errHistory.length > 600) this.errHistory.shift();

    let v = 0, w = 0, pump = false;
    this.sincePlan += dt;

    if (this.mode === 'STOPPED') {
      // hold position, pump off; STOP is a fast-path backstop that overrides in-flight commands
    } else if (this.mode === 'GOTO') {
      const stuck = this.lastSpeed < 0.05 * VMAX && this.path && this.sincePlan > 1.0;
      const retry = !this.path && this.sincePlan > RETRY_AFTER;
      if (!this.path || stuck || retry) this._replanFor(this.goalXY, 'command');
      if (this.path) {
        const a = followPath(this.path, [this.robot.x, this.robot.y, this.robot.th], LOOKAHEAD);
        if (a) { [v, w] = a; this.state = 'PLAN'; }
        else { this.mode = 'AUTO'; this.state = 'EXPLORE'; this._logEvent('command', 'Arrived \u2013 resuming autonomous mode'); }
      }
    } else {
      // AUTO: EXPLORE -> TRACK -> PLAN(standoff) -> SPRAY -> SAFE, mirrors sim/controller.py + planning/controller.py
      this.trackStallT = this.state === 'TRACK' || this.state === 'PLAN' ? this.trackStallT + dt : 0;
      if ((this.state === 'TRACK' || this.state === 'PLAN') && this.trackStallT > 55) {
        // repeated failed approaches (cramped geometry around the estimate): back off, bleed
        // off filter certainty so a stale lock doesn't immediately re-trap it, and re-scan.
        this.state = 'EXPLORE'; this.path = null; this.explorePoint = null; this.trackStallT = 0;
        this.trackCooldown = 8.0;
        this.eif.Y = this.eif.Y.map((r) => r.map((v) => v * 0.05));
        this.eif.yv = this.eif.yv.map((v) => v * 0.05);
        this._logEvent('state', 'Approach stalled \u2013 backing off and re-scanning');
      }
      this.trackCooldown = Math.max(0, this.trackCooldown - dt);
      if (this.state === 'SAFE') { /* fire out, hold */ }
      else if (this.state === 'EXPLORE') {
        if (detected && this.trackCooldown <= 0) { this.state = 'TRACK'; this.path = null; this._logEvent('state', 'Fire detected (flame/thermal) \u2013 tracking'); }
        else {
          const arrived = this.explorePoint && hyp(this.explorePoint[0] - this.robot.x, this.explorePoint[1] - this.robot.y) < 0.4;
          const stuck = this.lastSpeed < 0.05 * VMAX && this.path && this.sincePlan > 1.0;
          const failedToPlan = !this.path && this.sincePlan > 8.0;
          if (this.explorePoint && (arrived || failedToPlan)) {
            // retire this frontier -- reached it (so it's no longer a frontier once the next
            // scan folds it in) or gave up planning to it -- so next-best-view doesn't just
            // re-offer the same point immediately.
            this.exploreBlacklist.push([this.explorePoint[0], this.explorePoint[1], 0.9]);
            if (this.exploreBlacklist.length > 40) this.exploreBlacklist.shift();
            this.explorePoint = null;
          }
          if (!this.explorePoint || stuck || this.sincePlan > 8.0) {
            // Next-best-view: cluster the SLAM map's frontier (known-free bordering unknown),
            // score each cluster by raycast information gain discounted by path length, and head
            // for the best one. Falls back to a random free point only once the reachable frontier
            // is exhausted (map fully covered, or every frontier is behind a blacklisted dead end).
            this.nbv = nextBestView(this.slam.map, [this.robot.x, this.robot.y], { R: ROBOT_RADIUS + 0.08, blacklist: this.exploreBlacklist });
            this.explorePoint = this.nbv.target ? [this.nbv.target.x, this.nbv.target.y] : pickExploreTarget(this.world, this.rng, this.visited);
            this._replanFor(this.explorePoint, 'explore');
          }
          if (this.path) {
            const a = followPath(this.path, [this.robot.x, this.robot.y, this.robot.th], LOOKAHEAD);
            if (a) [v, w] = a; else { this.path = null; v = 0.2; w = 0.4; }
          } else { v = 0.15; w = 0.5 * Math.sin(this.t * 0.6); }
          if (sense.mq2_front > 0.3) { v = 0.1; w = 0.9; }
        }
      } else if (this.state === 'TRACK') {
        this.lost = detected ? 0 : this.lost + dt;
        const dist = hyp(est.x - this.robot.x, est.y - this.robot.y);
        const inPosition = sense.seen && dist < Math.min(STANDOFF + 0.6, SPRAY_RANGE - 0.1);
        if (inPosition) { this.state = 'SPRAY'; this.path = null; this._logEvent('state', 'Pump ON \u2013 suppressing'); }
        else if (sigma < 1.0 || sense.seen) {
          const moved = this.fireEstAtPlan && hyp(est.x - this.fireEstAtPlan[0], est.y - this.fireEstAtPlan[1]) > GOAL_SHIFT;
          const stuck = this.lastSpeed < 0.05 * VMAX && this.path && this.sincePlan > 1.0;
          const retry = !this.path && this.sincePlan > RETRY_AFTER;
          const first = !this.fireEstAtPlan;
          // never replan more than once a second even if the (still-noisy) estimate drifted --
          // otherwise a not-yet-converged filter can trigger a new RRT* solve almost every tick
          if (first || stuck || retry || this.sincePlan > REPLAN_EVERY || (moved && this.sincePlan > 1.0)) {
            const goal = standoffPoint(this.slam.map, this._slamCostMap(), [est.x, est.y], [this.robot.x, this.robot.y]);
            this.fireEstAtPlan = [est.x, est.y];
            if (goal) this._replanFor(goal, 'standoff'); else { this.planStats.failures += 1; this.path = null; }
          }
          if (this.path) {
            const a = followPath(this.path, [this.robot.x, this.robot.y, this.robot.th], LOOKAHEAD);
            if (a) { [v, w] = a; this.state = 'PLAN'; } else this.path = null;
          } else {
            if (this.lost > 1.2) { w = 0.9; v = 0.0; } // no sensor confirmation for a while: sweep in place rather than chase a possibly-stale bearing estimate
            else {
              const tgt = sense.seen ? sense.bearing : wrapA(Math.atan2(est.y - this.robot.y, est.x - this.robot.x) - this.robot.th);
              w = clamp(tgt * 2.2, -1.6, 1.6); v = Math.abs(tgt) > 0.7 ? 0.1 : 0.7;
            }
          }
        } else { v = 0.1; w = 0.9; }
        if (this.lost > 3) { this.state = 'EXPLORE'; this.path = null; this._logEvent('state', 'Target lost \u2013 resuming search'); }
      } else if (this.state === 'PLAN') {
        // following a standoff-approach path laid down while in TRACK
        const stuck = this.lastSpeed < 0.05 * VMAX && this.sincePlan > 1.0;
        if (stuck || this.sincePlan > REPLAN_EVERY) { this.state = 'TRACK'; this.path = null; }
        else if (this.path) {
          const a = followPath(this.path, [this.robot.x, this.robot.y, this.robot.th], LOOKAHEAD);
          if (a) [v, w] = a; else { this.path = null; this.state = 'TRACK'; }
        } else this.state = 'TRACK';
        if (detected && sense.seen) {
          const dist = hyp(est.x - this.robot.x, est.y - this.robot.y);
          if (dist < Math.min(STANDOFF + 0.6, SPRAY_RANGE - 0.1)) { this.state = 'SPRAY'; this.path = null; this._logEvent('state', 'Pump ON \u2013 suppressing'); }
        }
      } else if (this.state === 'SPRAY') {
        w = clamp(sense.bearing * 3, -1, 1); v = 0;
        pump = Math.abs(sense.bearing) < SPRAY_CONE && this.tank > 0 && sense.seen;
        if (pump) {
          this.fire.p = Math.max(0, this.fire.p - EXTINGUISH_RATE * dt);
          this.tank = Math.max(0, this.tank - WATER_RATE * dt);
          this.waterUsed += WATER_RATE * dt;
          if (this.fire.p <= 0) { this.state = 'SAFE'; this._logEvent('state', 'Fire out \u2013 verified ambient'); }
        }
        this.spinT = sense.seen ? 0 : this.spinT + dt;
        if (!sense.seen && this.spinT > 2) { this.state = 'TRACK'; this.spinT = 0; }
      }
    }

    // stuck recovery: commanded to move but wheel odometry says we aren't -- rotate in place to
    // break free. Without this a planner re-targeting an unreachable standoff point (small/oddly
    // shaped room around the fire) can wedge the robot into a corner indefinitely.
    if (this.state !== 'SPRAY' && this.mode !== 'STOPPED') {
      const commandedMove = Math.abs(v) > 0.05;
      this.stuckT = commandedMove && this.lastSpeed < 0.3 * Math.abs(v) * VMAX ? this.stuckT + dt : 0;
      if (this.stuckT > 0.35 && this.recoveryT <= 0) { this.recoveryT = 1.6; this.recoveryDir = -(this.recoveryDir || 1); this.stuckT = 0; this.path = null; }
      if (this.recoveryT > 0) { this.recoveryT -= dt; v = 0; w = 1.7 * this.recoveryDir; }
    }

    // reactive ultrasonic backstop -- always has final say on forward speed, including over a
    // recovery maneuver's own proposal, so a spin-to-clear can never itself drive into a wall.
    if (this.state !== 'SPRAY' && this.mode !== 'STOPPED') {
      const front = Math.min(sense.us_front_left, sense.us_front_right);
      if (front < 0.55) { v = front < 0.35 ? 0 : Math.min(v, 0.1); w = this.recoveryT > 0 ? w : (sense.us_front_left > sense.us_front_right ? 1 : -1) * 1.7; }
      else if (this.recoveryT <= 0) { if (sense.us_left < 0.32) w -= 0.5; if (sense.us_right < 0.32) w += 0.5; }
    }

    v = clamp(v, 0, 1) * VMAX; w = clamp(w, -1, 1) * WMAX;
    const prevTh = this.robot.th;
    this.robot.th = wrapA(this.robot.th + w * dt);
    const nx = this.robot.x + Math.cos(this.robot.th) * v * dt;
    const ny = this.robot.y + Math.sin(this.robot.th) * v * dt;
    const collided = v > 0 && !this.world.isFree(nx, ny, ROBOT_RADIUS);
    let moved = 0;
    if (collided) this.collisions += 1;
    else {
      moved = hyp(nx - this.robot.x, ny - this.robot.y);
      this.distanceTravelled += moved;
      this.robot.x = nx; this.robot.y = ny;
    }
    this.lastSpeed = collided ? 0 : v;
    if (this.mode !== 'STOPPED') this.battery = Math.max(0, this.battery - BATTERY_RATE * dt * (0.6 + v / VMAX));
    this.pumpOn = pump;

    // ---- SLAM: dead-reckon every tick, correct against the map + rebuild it from lidar at 5 Hz.
    // This mirrors a real stack's separation of a fast, drifting odometry rate from a slower
    // scan-matching rate; ground truth (this.robot/this.world) never feeds the estimate directly.
    this.slam.predict(moved, wrapA(this.robot.th - prevTh), dt);
    this.sinceScan += dt;
    if (this.sinceScan >= SCAN_PERIOD) {
      this.sinceScan = 0;
      const scan = lidarScan(this.world, this.robot.x, this.robot.y, this.robot.th, this.rng);
      this.slam.update(scan, this.robot);
    }

    // ---- orientation-to-fire: how square the robot (and nozzle) is on the fire right now,
    // independent of whether it's currently in view -- computed from ground-truth bearing so the
    // number is always meaningful, not just while SPRAY has a lock. Logged once, permanently, at
    // the instant a fire actually goes out, so "did it face the fire when it put it out" is an
    // answerable fact afterwards rather than something only visible live.
    {
      const dxF = this.fire.x - this.robot.x, dyF = this.fire.y - this.robot.y;
      const trueBearing = wrapA(Math.atan2(dyF, dxF) - this.robot.th);
      this.orientation = {
        headingDeg: toDeg(wrapA(this.robot.th)),
        bearingToFireDeg: toDeg(trueBearing),
        headingErrDeg: toDeg(Math.abs(trueBearing)),
        facingFire: Math.abs(trueBearing) < FACE_FIRE_TOL,
      };
      if (this._firePrevP > 0 && this.fire.p <= 0) {
        this.extinguishReport.unshift({
          t: this.t, x: this.robot.x, y: this.robot.y,
          headingDeg: this.orientation.headingDeg, bearingToFireDeg: this.orientation.bearingToFireDeg,
          headingErrDeg: this.orientation.headingErrDeg, facingFire: this.orientation.facingFire,
        });
        if (this.extinguishReport.length > 20) this.extinguishReport.length = 20;
        this._logEvent('state', `Extinguished while ${this.orientation.facingFire ? 'facing' : `${this.orientation.headingErrDeg.toFixed(0)}\u00b0 off`} the fire (nozzle bearing ${this.orientation.bearingToFireDeg.toFixed(0)}\u00b0)`);
      }
      this._firePrevP = this.fire.p;
    }
  }

  telemetry() {
    const est = this.eif.estimate();
    const sigma = sigmaOf(est);
    const locked = sigma < 20;
    return {
      t: this.t, mode: this.mode, state: this.state,
      robot: { ...this.robot }, fire: { ...this.fire },
      estimate: locked ? { x: est.x, y: est.y, sigma } : null,
      tank: this.tank, battery: this.battery, collisions: this.collisions,
      waterUsed: this.waterUsed, distanceTravelled: this.distanceTravelled,
      path: this.path, tree: this.tree, goal: this.goal, goalKind: this.goalKind,
      planStats: { ...this.planStats }, sense: this.lastSense, pumpOn: this.pumpOn,
      events: this.events.slice(0, 30), commandLog: this.commandLog.slice(0, 20),
      errHistory: this.errHistory, world: this.world, home: this.home,
      orientation: this.orientation, extinguishReport: this.extinguishReport,
      slam: {
        map: this.slam.map, pose: { ...this.slam.pose }, truth: { ...this.slam.truth },
        coverage: this.slam.coverage(), poseError: this.slam.lastPoseError(),
        headingErrorDeg: toDeg(this.slam.lastHeadingError()), stats: { ...this.slam.stats },
      },
      nbv: this.nbv,
    };
  }
}
