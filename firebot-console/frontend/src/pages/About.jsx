import React, { useState, useMemo } from "react";

// Every entry mirrors code in this repo; `where` points at the module so the page stays checkable.
const GROUPS = [
  {
    title: "Natural Language SLM Intent Engine & Groq Acceleration",
    items: [
      {
        name: "Groq-Hosted SLM Intent Engine (Allam & Qwen)",
        where: "backend/slm_intent.py, firebot/command/parser.py",
        what: "Translates free-form spoken natural language into strictly validated robotics intent JSON in sub-200ms.",
        how: [
          "Powered by active Groq-hosted SLMs (allam-2-7b with qwen/qwen3.8-27b dynamic fallback) with zero temperature and structured JSON outputs.",
          "Translates complex, conversational tactical phrasing ('douse the blaze in the north wing', 'advance half a meter', 'emergency stop right now') into canonical robotics intents.",
          "Strict JSON schema validation: commands (STOP, EXTINGUISH, RETURN_HOME, STATUS, DRIVE, PUMP, GOTO) with normalized direction, target, speed, and confidence bounds.",
          "Three-tiered parsing cascade: Hosted Groq SLM -> Local acoustic template matcher -> Deterministic regex rules with typo-tolerant Damerau-Levenshtein distance.",
        ],
      },
      {
        name: "Autonomous Execution & Command Dispatch",
        where: "frontend/src/lib/simController.js, frontend/src/pages/Simulator.jsx, backend/server.py",
        what: "Directly binds natural language intents to physical and simulated robot actuators without manual intervention.",
        how: [
          "Immediate voice dispatch: microphone input automatically transcribes, classifies intent, and issues real-time actuator directives.",
          "STOP immediately halts differential drive motors and water pump with latched e-stop override.",
          "EXTINGUISH aligns towards localized fire coordinates, engages the water pump, and modulates suppression cones.",
          "DRIVE applies omnidirectional velocity vectors (forward, reverse, turn left/right), while GOTO plans collision-free RRT* waypoints.",
        ],
      },
    ],
  },
  {
    title: "Hugging Face Model Cloud & Distributed Persistence",
    items: [
      {
        name: "Hugging Face Model Hub Registry (firebot-voice-intent)",
        where: "backend/hf_sync.py, Model Hub: anabaena/firebot-voice-intent",
        what: "Official centralized model registry hosting all operator-specific checkpoints and acoustic voiceprints.",
        how: [
          "Stores per-operator personalized Whisper classifier heads (checkpoints/users/<user>.pt), evaluation reports (<user>.json), and retrain logs (<user>.history.jsonl).",
          "Stores 192-dimensional ECAPA-TDNN acoustic embeddings (data/voiceprints/<user>.npy) for biometric operator verification.",
          "Stores base model artifacts (intent_head.pt, intent_prototypes.pt) and active operator profiles (profiles.json).",
          "Publicly accessible for zero-friction anonymous pulling by cloud container instances, with authenticated write-back on training.",
        ],
      },
      {
        name: "Bidirectional Cloud Sync & Startup Hydration",
        where: "backend/server.py, backend/calibration.py, frontend/src/pages/VoiceCalibration.jsx",
        what: "Synchronizes local operator checkpoints with Hugging Face Hub, ensuring persistence across ephemeral cloud restarts.",
        how: [
          "On server startup, the backend checks local disk storage and automatically hydrates missing operator models from Hugging Face Hub in the background.",
          "Whenever an operator records takes and calibrates or enrolls a voiceprint, the updated weights and profiles are automatically pushed to Hugging Face.",
          "Voice Studio console provides an interactive Hugging Face status card with live sync badges and manual Pull/Push triggers.",
          "Exposes REST endpoints: GET /api/voice/hf/status, POST /api/voice/hf/sync, and POST /api/voice/hf/push.",
        ],
      },
      {
        name: "Hugging Face Static Space Deployment (firebot-console)",
        where: "scripts/deploy_space.py, Space: anabaena/firebot-console",
        what: "Globally accessible tactical command dashboard hosted directly on Hugging Face Spaces.",
        how: [
          "Static Space deployment at anabaena-firebot-console.static.hf.space providing sub-second edge distribution.",
          "Stages all operator models and voiceprints into /models/users/ and /models/voiceprints/ for direct static HTTP access.",
          "Seamlessly communicates with the Render FastAPI backend (firebot-api.onrender.com) for real-time WebSocket telemetry and speech inference.",
        ],
      },
    ],
  },
  {
    title: "Operator Voice Studio & Personal Acoustic Adaptation",
    items: [
      {
        name: "AudioWorklet 16 kHz Mono Acoustic Pipeline",
        where: "frontend/src/lib/audioRecorder.js, frontend/src/pages/VoiceCalibration.jsx",
        what: "Low-latency browser audio capture conditioned specifically for tactical speech recognition.",
        how: [
          "Captures raw microphone audio via Web Audio API, downsampling to 16,000 Hz single-channel PCM format with linear interpolation.",
          "Real-time RMS audio energy monitoring and dynamic HTML5 canvas waveform visualizer with active voice activity indicators.",
          "Per-operator take manager supporting multi-sample calibration takes for verified team members (ananya and avinandan).",
        ],
      },
      {
        name: "Personalized Whisper Classifier Head & Acoustic Templates",
        where: "voice_intent/personalize.py, backend/calibration.py",
        what: "Fine-tunes custom MLP heads on frozen Whisper encoder embeddings with acoustic template fallback.",
        how: [
          "Adapts base weights with L2-SP regularization pulled to pre-trained weights, preventing catastrophic forgetting on small calibration sets.",
          "Evaluates against held-out takes; only commits updates that meet or exceed base accuracy.",
          "Standalone acoustic template matching computes normalized centroid embeddings per command class for zero-latency offline matching.",
        ],
      },
      {
        name: "ECAPA-TDNN Speaker Verification",
        where: "speech/speaker_id.py, data/voiceprints/",
        what: "Biometric voiceprint authentication tagging commands with operator identity.",
        how: [
          "Generates 192-dimensional speaker embeddings using pre-trained SpeechBrain ECAPA-TDNN model.",
          "Computes cosine similarity against enrolled operator voiceprints (ananya.npy, avinandan.npy) with configurable confidence threshold and margin.",
          "Records operator identity in audit telemetry (voice:ananya, voice:avinandan) without altering deterministic safety semantics.",
        ],
      },
    ],
  },
  {
    title: "Cloud Telemetry Sink & Storage (PostgreSQL on Render)",
    items: [
      {
        name: "Render Managed PostgreSQL Telemetry Sink",
        where: "src/firebot/db/pg.py, backend/server.py, Render: firebot-db",
        what: "Production relational database storing mission sorties, high-frequency telemetry frames, and command audit logs.",
        how: [
          "Connected via asyncpg connection pooling to Render PostgreSQL (database firebot_db, instance firebot-db).",
          "Automated startup migrations ensure tables (sessions, frames, operator_commands, schema_migrations) exist.",
          "Stores high-frequency sensor readings, estimated poses (x, y, θ), water tank levels, and 24x32 MLX90640 radiometric thermal grids.",
          "Automatic mission sortie seeding pre-populates realistic suppression, recon, and patrol missions complete with full frame sequences.",
        ],
      },
      {
        name: "Mission Replay & Telemetry Analytics Studio",
        where: "frontend/src/pages/History.jsx, fusion/anomaly.py",
        what: "Interactive scrubbing, historical playback, telemetry curves, and fault detection across recorded robot runs.",
        how: [
          "Frame-by-frame scrubber replaying position, velocity, flame sensors, and water tank levels.",
          "Interactive 24x32 radiometric thermal array heatmap with dynamic color ramps and min/max/mean temperature readouts.",
          "Fault detector scans mission logs for physical anomalies: tank leaks, pump dry-runs, sensor freezes, and compute spikes.",
        ],
      },
    ],
  },
  {
    title: "Simulation & Procedural 3D Physics (MuJoCo & Three.js)",
    items: [
      {
        name: "MuJoCo 3-D physics engine & procedural architecture",
        where: "sim/mujoco_world.py, sim/mapgen.py",
        what: "A high-fidelity physics-backed 3-D simulation with domain-specific building environments and obstacles.",
        how: [
          "Procedural 8-room generation with domain-specific semantic architecture: Datacenter Server Hall, Hazmat Lab, Control Room, High-Density Storage, Workshop, Central Atrium, and Executive Office.",
          "Procedural 3-D interactive obstacle props: dual-bay server racks, emergency backup generators, pressurized gas cylinders, wooden cargo pallets, industrial crates, steel shelving, control consoles, benches, and structural pillars.",
          "Volumetric GPU particle systems: real-time GPU particle simulation for turbulent smoke plume dispersion, high-velocity thermal fire embers, water mist extinguisher spray, and ground thermal heat dissipation footprint.",
          "Exact mj_ray lidar sweep at scan height and contact-based collision dynamics ensure the planner and physics engine remain 100% physically consistent.",
        ],
      },
      {
        name: "Live episode stream & 3-D console view",
        where: "sim/stream.py, backend/mujoco_stream.py, components/mujoco/MujocoScene.js",
        what: "Streams physics-backed episodes to the browser with Three.js rendering, multi-camera views, and telemetry overlays.",
        how: [
          "Streams scene geometry on connection, followed by 10-60 Hz telemetry frames containing robot pose, lidar sweeps, path waypoints, Bayesian EIF belief state, gas readings, and thermal peaks.",
          "4 dynamic camera modes: Interactive Orbit, Third-Person Chase (follow), First-Person FPV Rover Camera (fpv), and Bird's-Eye Tactical Top-Down (top).",
          "Real-time Bayesian EIF Covariance Ellipse overlay (x̂, ŷ, σ) projected directly onto the 3D floor plane to visualize filter convergence.",
          "With 'Log this run' enabled, frames persist to PostgreSQL as a standard session for scrubbing and replay in the History tab.",
        ],
      },
    ],
  },
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
    title: "Planning & autonomous robotics control",
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
        name: "Frontier exploration (FrontierController)",
        where: "sim/frontier_controller.py",
        what: "Explores an unknown building on purpose instead of wandering.",
        how: [
          "Builds an occupancy grid from the lidar sweeps, finds the nearest reachable frontier (a free cell next to unknown), and follows a breadth-first path to it with pure pursuit.",
          "Once a fire is seen it hands over to track and spray logic. Operates directly on robot odometry and SLAM belief state.",
        ],
      },
      {
        name: "Lidar avoidance (ScanController)",
        where: "sim/scan_controller.py",
        what: "Steers around obstacles the ultrasonic beams miss, like tree trunks, shelf legs and doorframes.",
        how: [
          "A 36-ray, 360-degree sweep replaces the ultrasonic check. When the way ahead is blocked it steers toward the most open heading instead of spinning to one side.",
          "The explore / track / spray logic is the rule baseline's, unchanged.",
        ],
      },
    ],
  },
  {
    title: "Deep reinforcement learning & multimodal fusion",
    items: [
      {
        name: "MM-FusionRL (Multimodal Cross-Attention Policy)",
        where: "drl/drl_controller.py, docs/RESEARCH_PAPER.md",
        what: "End-to-end deep actor-critic policy fusing heterogeneous sensing streams via cross-attention transformers.",
        how: [
          "Tokenizes physically disparate modalities: 36-beam Lidar pointcloud, 32x24 MLX90640 radiometric thermal array, dual MQ-2 chemical gas concentration differentials, 4x ultrasonic range envelopes, and wheel odometry.",
          "Multi-head cross-attention layer dynamically models inter-modal dependencies, attending to chemical diffusion gradients when smoke or walls obstruct optical line-of-sight, and shifting to thermal tracking upon target acquisition.",
          "Information-theoretic active sensing reward couples policy objectives with Bayesian information gain (ΔTr(P) of the EIF), driving active lateral baseline maneuvers to eliminate collinear unobservability.",
          "Auxiliary Neural-Bayesian adaptive covariance head predicts dynamic measurement noise covariances (R_t = diag(σ_thermal², σ_flame²)) for formal Kalman gating under sensory dropouts.",
        ],
      },
      {
        name: "MultimodalController (mm_fusion)",
        where: "drl/drl_controller.py, sim/stream.py",
        what: "Production simulation controller integrating cross-modal fusion with frontier exploration.",
        how: [
          "Subclasses FrontierController to maintain SLAM occupancy grid mapping and BFS frontier routing, while modulating angular velocity with MQ-2 chemical gas diffusion gradients and thermal parallax dynamics.",
          "Streams live Bayesian belief state estimates (x̂, ŷ, σ), gas concentration, and thermal peaks to the console HUD and 3-D Three.js viewport.",
        ],
      },
      {
        name: "PPO with a 3-stage curriculum",
        where: "drl/curriculum.py",
        what: "Trains a reinforcement-learning policy to fight fires through progressive environmental difficulty.",
        how: [
          "Stage 1: one fixed room. Stage 2: the same room with the fire placed significantly further away. Stage 3: a new procedurally generated building every episode.",
          "One PPO policy carries across stages, accelerating convergence before policy deployment.",
        ],
      },
    ],
  },
  {
    title: "Research & publications",
    items: [
      {
        name: "MM-FusionRL Research Paper Manuscript",
        where: "docs/RESEARCH_PAPER.md",
        what: "Full academic research paper targeting IEEE ICRA / IROS / RA-L.",
        how: [
          "Title: 'MM-FusionRL: Multimodal Cross-Attention Deep Reinforcement Learning with Information-Theoretic Active Sensing for Autonomous Firefighting Robots'.",
          "Comprehensive mathematical formulation of modality tokenization, cross-attention encoders, information-theoretic reward shaping, and adaptive covariance gating.",
          "Rigorous comparative evaluation against classical rule-based heuristics and standard flat MLP policies across localization RMSE, Mean Time to Extinguish (MTTE), water conservation, and sensor dropout resilience.",
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
        {/* Header with Search Input & Deployment Links */}
        <header className="panel p-8 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-telemetry animate-pulse" />
              <span className="text-[11px] font-mono uppercase tracking-widest text-telemetry font-bold">
                FIREBOT TECHNICAL MANUAL & ARCHITECTURE SPECIFICATION
              </span>
            </div>

            {/* Quick Live Stack Badges */}
            <div className="flex flex-wrap items-center gap-2">
              <a
                href="https://huggingface.co/anabaena/firebot-voice-intent"
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-1 rounded-lg bg-panel2 border border-line text-[11px] font-mono text-ink hover:text-telemetry hover:border-telemetry/40 transition-colors flex items-center gap-1.5"
              >
                <span>🤗</span>
                <span>HF Model Hub</span>
                <span className="text-faint">↗</span>
              </a>
              <a
                href="https://anabaena-firebot-console.static.hf.space"
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-1 rounded-lg bg-panel2 border border-line text-[11px] font-mono text-ink hover:text-cyan-400 hover:border-cyan-400/40 transition-colors flex items-center gap-1.5"
              >
                <span>🚀</span>
                <span>HF Space</span>
                <span className="text-faint">↗</span>
              </a>
              <a
                href="https://firebot-api.onrender.com"
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-1 rounded-lg bg-panel2 border border-line text-[11px] font-mono text-ink hover:text-emerald-400 hover:border-emerald-400/40 transition-colors flex items-center gap-1.5"
              >
                <span>⚡</span>
                <span>Render API</span>
                <span className="text-faint">↗</span>
              </a>
            </div>
          </div>

          <h1 className="font-display font-black text-[34px] lg:text-[42px] leading-[1.05] tracking-tight text-ink max-w-[24ch]">
            How Firebot senses, reasons, plans, and suppresses fires
          </h1>
          <p className="text-[15px] text-muted max-w-[68ch] leading-relaxed">
            Every module below is implemented as production-grade code in this repository. Reference this live architecture specification to trace natural language SLM routing, Hugging Face checkpoint persistence, state estimation filters, RRT* motion planning, and MuJoCo 3D procedural simulation.
          </p>

          <div className="pt-2 max-w-md">
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search Groq SLM, Hugging Face, Postgres, filters, or files…"
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
        <div className="grid gap-10 md:grid-cols-[240px_1fr] items-start">
          <nav aria-label="Sections" className="md:sticky md:top-6 self-start panel p-4 space-y-2">
            <div className="text-[11px] font-mono uppercase tracking-wider text-faint pb-2 border-b border-line">
              Subsystems
            </div>
            <ul className="space-y-1">
              {GROUPS.map((g) => (
                <li key={g.title}>
                  <a
                    href={`#${slug(g.title)}`}
                    className="block text-[11px] font-mono text-muted hover:text-telemetry py-1.5 px-2 rounded transition-colors hover:bg-panel2 truncate"
                    title={g.title}
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
                  <h2 className="font-display font-extrabold text-[20px] lg:text-[22px] tracking-tight text-ink">
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
                        <h3 className="font-display font-bold text-[17px] text-ink leading-tight">
                          {it.name}
                        </h3>
                        <code className="data inline-block mt-2 px-2.5 py-1 rounded-md bg-panel2 text-[11px] font-mono text-telemetry border border-line">
                          {it.where}
                        </code>
                        <p className="mt-3 text-[13px] leading-relaxed text-muted">
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
