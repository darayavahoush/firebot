import React from "react";

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
          "Current status: at 300k steps the trained policy trails the rule baseline, so the console runs the rule and RRT* stack.",
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

export default function About() {
  return (
    <main className="flex-1 overflow-y-auto p-6 bg-base">
      <div className="max-w-[980px] mx-auto space-y-8">
        <section>
          <h1 className="font-display text-[22px] font-extrabold tracking-tight text-ink">How NIRVANA works</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted max-w-[720px]">
            An autonomous firefighting robot: it searches a building, localises a fire from sensor bearings, plans a safe
            route to it and sprays. An operator can take over by voice, text or joystick. Below is each algorithm in the
            system, what it is for and how it works.
          </p>
        </section>

        {GROUPS.map((g) => (
          <section key={g.title}>
            <h2 className="font-mono text-[11px] tracking-[0.14em] uppercase text-telemetry mb-3">{g.title}</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {g.items.map((it) => (
                <article key={it.name} className="panel p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-[14px] font-medium text-ink">{it.name}</h3>
                    <code className="font-mono text-[10px] text-faint shrink-0">{it.where}</code>
                  </div>
                  <p className="mt-1.5 text-[12.5px] text-ink/90 leading-relaxed">{it.what}</p>
                  <ul className="mt-2.5 space-y-1.5">
                    {it.how.map((h, i) => (
                      <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-muted">
                        <span className="mt-[7px] h-[3px] w-[3px] shrink-0 bg-telemetry" />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
