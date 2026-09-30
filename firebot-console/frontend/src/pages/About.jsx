import React, { useState, useMemo } from "react";

// Every entry mirrors code in this repo; `where` points at the module so the page stays checkable.
const GROUPS = [
  {
    title: "Perception & state estimation",
    items: [
      {
        name: "Extended Information Filter (bearing-only)",
        where: "fusion/eif.py",
        what: "Locates the fire from direction-only readings of the three flame sensors, with an uncertainty estimate.",
        how: [
          "Keeps an information matrix and vector for a static 2D fire position and adds each bearing as a linearised update.",
          "A small forgetting factor bleeds off certainty each step, so a bad lock from near-collinear bearings can recover.",
          "The amber ellipse on the map is the filter's 2-sigma position uncertainty; it shrinks as the robot views the fire from new angles.",
        ],
      },
      {
        name: "Pose EKF",
        where: "fusion/pose_ekf.py",
        what: "Estimates robot position and heading from wheel odometry, optionally corrected by a compass/IMU yaw.",
        how: [
          "Differential-drive motion model with process noise that scales with speed and turn rate, so a stationary robot does not accumulate drift.",
          "Hand-written in numpy so the update equations can be read directly.",
        ],
      },
      {
        name: "Explored-area mask (fog of war)",
        where: "Simulator canvas",
        what: "Shows only the part of the map the robot has actually sensed.",
        how: [
          "A ring around the robot (2.1 m, ultrasonic range) and a forward cone (6 m, camera field of view) are painted into a grow-only mask.",
          "Coverage % is a downsampled read of that mask; the fire is shown only once its cell has been swept.",
        ],
      },
      {
        name: "Telemetry anomaly detection",
        where: "fusion/anomaly.py",
        what: "Flags faults in a logged run in plain language, with no trained model.",
        how: [
          "Median/MAD robust statistics plus physical checks: stuck sensor, spike, pump running without tank drain, tank leak, slow compute, frame gap.",
          "Consecutive hits merge into one finding, so a 30 s fault is one line.",
        ],
      },
    ],
  },
  {
    title: "Planning & control",
    items: [
      {
        name: "RRT* path planning",
        where: "planning/rrtstar.py, ompl_planner.py",
        what: "Finds a collision-free route to the spray stand-off point next to the fire.",
        how: [
          "Grows a random tree on the occupancy grid, rewires nearby nodes for lower cost, then shortcuts the result.",
          "The grid is inflated by the robot radius plus a safety margin, so straight segments are safe for a point robot.",
          "An OMPL InformedRRT* planner is a drop-in swap; the browser demo runs the same algorithm in JavaScript. The faint blue lines on the map are the search tree.",
        ],
      },
      {
        name: "Pure-pursuit path following",
        where: "planning/controller.py",
        what: "Turns the planned path into forward speed and turn rate.",
        how: ["Steers toward a point a fixed lookahead distance ahead on the path, so corners are cut smoothly rather than stopped at."],
      },
      {
        name: "Rule-based controller (baseline)",
        where: "sim/controller.py, planning/controller.py",
        what: "Explore, track, then spray, driven only by the observation vector.",
        how: [
          "The planning controller wraps it and takes over only while the fire is localised but not yet in spray position, routing around walls.",
          "Being rule-based, it is the reference any learned policy is compared against.",
        ],
      },
      {
        name: "Lidar avoidance (ScanController)",
        where: "sim/scan_controller.py",
        what: "Steers around things the four ultrasonic beams miss, like tree trunks, shelf legs and doorframes.",
        how: [
          "A 36-ray, 360-degree sweep replaces the ultrasonic check. When the way ahead is blocked it steers toward the most open heading instead of spinning to one side.",
          "The explore / track / spray logic is the rule baseline's, unchanged. Simulation only: the real robot has no lidar yet.",
        ],
      },
      {
        name: "Frontier exploration (FrontierController)",
        where: "sim/frontier_controller.py",
        what: "Explores an unknown building on purpose instead of wandering.",
        how: [
          "Builds an occupancy grid from the lidar sweeps, finds the nearest reachable frontier (a free cell next to unknown), and follows a breadth-first path to it with pure pursuit. The green line on the MuJoCo tab is that path.",
          "Once a fire is seen it hands over to the same track and spray logic. It needs the robot's pose, which in simulation is exact and on hardware would come from odometry or SLAM.",
        ],
      },
      {
        name: "Command executor",
        where: "command/executor.py",
        what: "Runs validated commands as one of four modes.",
        how: [
          "IDLE, AUTO (search, approach, suppress), GOTO (drive a path, pump never on) and MANUAL (joystick with a 0.5 s dead-man timeout).",
          "STOP always wins and latches until the next motion command. Being blocked for 2 s triggers a replan.",
        ],
      },
    ],
  },
  {
    title: "Simulation",
    items: [
      {
        name: "MuJoCo 3-D world",
        where: "sim/mujoco_world.py, sim/mapgen.py",
        what: "A physics-backed building the controllers can be tested in, with real 3-D obstacles.",
        how: [
          "Rooms come from a recursive space partition with a doorway between every adjacent pair, so the fire is always reachable. Walls, trees, shrubs, barrels, shelves and crates are MuJoCo geoms.",
          "The lidar is an exact ray cast at scan height, and the planning grid is derived from the same solid geoms, so the planner and the physics cannot disagree. Tree canopies are visual only because they sit above the scan plane.",
          "It is a drop-in for the flat world, so the estimator, planner and controllers run unchanged.",
        ],
      },
      {
        name: "Live episode stream (MuJoCo tab)",
        where: "sim/stream.py, backend/mujoco_stream.py",
        what: "Plays a simulated episode in the browser, and can save it to History.",
        how: [
          "The backend steps the simulation and sends the map once, then a small update about ten times a second. The browser draws the 3-D scene, so the server needs no display.",
          "With Log this run on, each tick is stored with the same sensor names the real robot reports, plus the lidar scan, so a simulated run replays like a real one.",
        ],
      },
    ],
  },
  {
    title: "Voice & command understanding",
    items: [
      {
        name: "Local intent classifier",
        where: "voice_intent/",
        what: "Recognises a spoken command directly from audio, offline and fast.",
        how: [
          "A frozen Whisper encoder turns the clip into an embedding (mean-pooled over the voiced frames); a small MLP head picks the command.",
          "Trained on cached embeddings of synthetic text-to-speech clips plus real recordings, with per-class confidence thresholds: a false STOP is cheap, a false move or pump is not.",
        ],
      },
      {
        name: "ShadowRouter (Thompson sampling)",
        where: "voice_intent/router.py",
        what: "Decides when the local classifier can be trusted on its own and when to double-check with Groq.",
        how: [
          "A Beta-Bernoulli bandit per confidence decile learns how often the local answer agreed with Groq.",
          "Sampling balances exploring poorly-known buckets against trusting well-proven ones, and every bucket's stats are inspectable.",
        ],
      },
      {
        name: "Speech fallbacks",
        where: "server.py, speech/",
        what: "Keeps voice working when the local model is unsure or unavailable.",
        how: [
          "Order: local classifier, then offline Vosk if a model is installed, then Groq Whisper. An optional Silero VAD gate drops non-speech.",
        ],
      },
      {
        name: "Rule parser and optional SLM",
        where: "command/parser.py",
        what: "Converts text into one of a small set of validated intents.",
        how: [
          "Regular-expression rules in priority order: stop, coordinates, status, return home, go to a place, extinguish.",
          "Any stop word anywhere means STOP. An optional local small language model is a fallback; its output is treated as untrusted and validated.",
          "The console tolerates one-letter typos in place names (bounded Damerau-Levenshtein).",
        ],
      },
      {
        name: "Speaker identification",
        where: "speech/speaker_id.py",
        what: "Records which enrolled operator issued a command, for the audit trail.",
        how: ["Pretrained ECAPA-TDNN voiceprints compared by cosine similarity. It never changes what a command means."],
      },
    ],
  },
  {
    title: "Learning",
    items: [
      {
        name: "PPO with a 3-stage curriculum",
        where: "drl/curriculum.py",
        what: "Trains a reinforcement-learning policy to fight the fire.",
        how: [
          "Stage 1: one fixed room. Stage 2: the same room with the fire much further away. Stage 3: a new procedurally generated building every episode.",
          "One PPO policy carries across stages. Procedural buildings come from recursive space partition with a doorway cut between rooms.",
          "Current status: at 300k steps the trained policy trails the rule baseline, so the console runs the rule and RRT* stack, plus the lidar controllers in simulation.",
        ],
      },
    ],
  },
  {
    title: "Robot link & safety",
    items: [
      {
        name: "Brain / agent link and watchdog",
        where: "link/",
        what: "Splits the Pi (sensors, motors) from the PC (fusion, planning, commands).",
        how: [
          "Newline-delimited JSON over TCP; every frame and command is validated and malformed ones are dropped.",
          "The robot starts IDLE on every connection, and the Pi stops motors and pump if no valid command arrives within the watchdog window.",
          "An operator STOP is spotted the moment it is submitted and overrides the next outgoing command.",
        ],
      },
    ],
  },
];

const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export default function About() {
  const [search, setSearch] = useState("");

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return GROUPS;
    return GROUPS.map((g) => {
      const items = g.items.filter(
        (it) =>
          it.name.toLowerCase().includes(q) ||
          it.where.toLowerCase().includes(q) ||
          it.what.toLowerCase().includes(q) ||
          it.how.some((h) => h.toLowerCase().includes(q))
      );
      return { ...g, items };
    }).filter((g) => g.items.length > 0);
  }, [search]);

  return (
    <main className="flex-1 overflow-y-auto bg-base p-6">
      <div className="max-w-[1140px] mx-auto space-y-10">
        {/* Header with Search Input */}
        <header className="panel p-8 space-y-4">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-telemetry animate-pulse" />
            <span className="text-[11px] font-mono uppercase tracking-widest text-telemetry font-bold">
              FIREBOT TECHNICAL MANUAL & ARCHITECTURE
            </span>
          </div>
          <h1 className="font-display font-black text-[36px] lg:text-[44px] leading-[1.05] tracking-tight text-ink max-w-[20ch]">
            How the robot senses, plans, and suppresses fires
          </h1>
          <p className="text-[16px] text-muted max-w-[62ch]">
            Every module below is implemented as checked-in production code in this repository. Use this reference to trace state estimation, motion planning, and MuJoCo simulation pipelines.
          </p>

          <div className="pt-2 max-w-md">
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search algorithms, filters, models, or file paths…"
                className="w-full bg-panel2 border border-line rounded-xl px-4 py-2.5 pl-10 text-[13px] text-ink font-mono focus:border-telemetry transition-colors outline-none"
              />
              <span className="absolute left-3.5 top-3 text-faint">🔍</span>
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-2.5 text-[11px] font-mono text-faint hover:text-ink px-1.5 py-0.5 rounded bg-panel"
                >
                  CLEAR
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Categories Grid */}
        <div className="grid gap-10 md:grid-cols-[220px_1fr] items-start">
          <nav aria-label="Sections" className="md:sticky md:top-6 self-start panel p-4 space-y-2">
            <div className="text-[11px] font-mono uppercase tracking-wider text-faint pb-2 border-b border-line">
              Subsystems
            </div>
            <ul className="space-y-1">
              {GROUPS.map((g) => (
                <li key={g.title}>
                  <a
                    href={`#${slug(g.title)}`}
                    className="block text-[12px] font-mono text-muted hover:text-telemetry py-1 px-1.5 rounded transition-colors hover:bg-panel2"
                  >
                    {g.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="space-y-10 min-w-0">
            {filteredGroups.length === 0 && (
              <div className="panel p-12 text-center text-muted font-mono text-[14px]">
                No subsystems matched "{search}".
              </div>
            )}
            {filteredGroups.map((g) => (
              <section key={g.title} id={slug(g.title)} className="scroll-mt-6 panel p-6 space-y-6">
                <div className="flex items-center justify-between border-b border-line pb-3">
                  <h2 className="font-display font-extrabold text-[22px] tracking-tight text-ink">
                    {g.title}
                  </h2>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-panel2 text-faint border border-line">
                    {g.items.length} MODULES
                  </span>
                </div>

                <div className="divide-y divide-line/60">
                  {g.items.map((it) => (
                    <article key={it.name} className="py-6 first:pt-0 last:pb-0 grid gap-x-8 gap-y-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                      <div>
                        <h3 className="font-display font-bold text-[18px] text-ink leading-tight">
                          {it.name}
                        </h3>
                        <code className="data inline-block mt-2 px-2.5 py-1 rounded-md bg-panel2 text-[11px] font-mono text-telemetry border border-line">
                          {it.where}
                        </code>
                        <p className="mt-3 text-[14px] leading-relaxed text-muted">
                          {it.what}
                        </p>
                      </div>
                      <ul className="space-y-2 text-[13px] leading-relaxed text-ink/80 max-w-[62ch]">
                        {it.how.map((h, i) => (
                          <li key={i} className="pl-3.5 border-l-2 border-line hover:border-telemetry transition-colors">
                            {h}
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
