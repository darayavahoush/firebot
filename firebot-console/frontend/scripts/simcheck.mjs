// Headless regression check for the in-browser simulator: runs N seeded scenarios to completion
// and reports how many ended with the fire out, plus collisions, heading-at-extinguish, coverage.
//   node scripts/simcheck.mjs [nSeeds=12] [maxSimSeconds=400]
import { SimController } from '../src/lib/simController.js';

const n = Number(process.argv[2] ?? 12), maxT = Number(process.argv[3] ?? 400);
let ok = 0;
const rows = [];
for (let s = 1; s <= n; s++) {
  const c = new SimController(s * 7919);
  const t0 = performance.now();
  const dt = 0.1;
  while (c.t < maxT && c.state !== 'SAFE') c.step(dt);
  const done = c.state === 'SAFE';
  if (done) ok++;
  const ex = c.extinguishReport?.[0];
  rows.push({
    seed: s, done, t: +c.t.toFixed(0), coll: c.collisions, plans: c.planStats.plans, fail: c.planStats.failures,
    cov: c.slam ? c.slam.coverage().toFixed(0) + '%' : '-',
    slamErr: c.slam ? c.slam.lastPoseError().toFixed(3) : '-',
    headErrDeg: ex ? ex.headingErrDeg.toFixed(1) : '-',
    ms: Math.round(performance.now() - t0),
  });
}
console.table(rows);
console.log(`fire out: ${ok}/${n}`);
process.exit(ok === n ? 0 : 1);
