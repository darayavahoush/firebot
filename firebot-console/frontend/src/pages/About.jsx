import React, { useState, useMemo, useEffect, useRef } from "react";
import { playSound } from "../lib/sound.js";

// Comprehensive Technical Reference Dossier
const GROUPS = [
  {
    id: "slm",
    category: "ai",
    badge: "SUB-185MS NLP",
    title: "Natural Language SLM Intent Engine & Groq Acceleration",
    icon: "🧠",
    summary: "Translates unconstrained tactical speech into verified robotics actuator commands in under 200 ms using Groq-hosted SLMs.",
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
    id: "cloud",
    category: "cloud",
    badge: "HUGGING FACE & RENDER",
    title: "Cloud Model Registry & Telemetry Persistence",
    icon: "☁️",
    summary: "Decoupled cloud infrastructure syncing personal biometric voice models with Hugging Face and streaming mission sorties to PostgreSQL.",
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
    ],
  },
  {
    id: "voice",
    category: "ai",
    badge: "16 KHZ MONO",
    title: "Operator Voice Studio & Acoustic Biometrics",
    icon: "🎙️",
    summary: "Personal acoustic adaptation using frozen Whisper encoders and 192-dimensional ECAPA-TDNN speaker verification.",
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
    id: "mujoco",
    category: "sim",
    badge: "PHYSICS RIGID-BODY",
    title: "Simulation & Procedural 3D Physics (MuJoCo & Three.js)",
    icon: "🎲",
    summary: "High-fidelity rigid-body dynamics with 36-beam lidar sweeps, 8 semantic industrial rooms, and volumetric GPU particle systems.",
    items: [
      {
        name: "MuJoCo 3-D Physics Engine & Procedural Architecture",
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
        name: "Live Episode Stream & Three.js 3D Viewport",
        where: "sim/stream.py, backend/mujoco_stream.py, components/mujoco/MujocoScene.js",
        what: "Streams physics-backed episodes to the browser with Three.js rendering, multi-camera views, and telemetry overlays.",
        how: [
          "Streams scene geometry on connection, followed by 10-60 Hz telemetry frames containing robot pose, lidar sweeps, path waypoints, Bayesian EIF belief state, gas readings, and thermal peaks.",
          "4 dynamic camera modes: Interactive Orbit, Third-Person Chase (follow), First-Person FPV Rover Camera (fpv), and Bird's-Eye Tactical Top-Down (top).",
          "Real-time Bayesian EIF Covariance Ellipse overlay (x̂, ŷ, σ) projected directly onto the 3D floor plane to visualize filter convergence.",
        ],
      },
    ],
  },
  {
    id: "fusion",
    category: "estimation",
    badge: "BAYESIAN ESTIMATION",
    title: "Perception & State Estimation (EIF & EKF)",
    icon: "📡",
    summary: "Bearing-only Extended Information Filtering for triangulation without distance sensors, coupled with wheel odometry Pose EKF.",
    items: [
      {
        name: "Extended Information Filter (Bearing-Only)",
        where: "fusion/eif.py",
        what: "Locates the fire from direction-only readings of the three flame sensors, with an uncertainty estimate.",
        how: [
          "Keeps an information matrix and vector for a static 2D fire position and adds each bearing as a linearised update.",
          "A small forgetting factor bleeds off certainty each step, so a bad lock from near-collinear bearings can recover.",
          "The amber ellipse on the map is the filter's 2-sigma position uncertainty; it shrinks as the robot views the fire from new angles.",
        ],
      },
      {
        name: "Pose EKF (Differential Drive Odometry)",
        where: "fusion/pose_ekf.py",
        what: "Estimates robot position and heading from wheel odometry, optionally corrected by a compass/IMU yaw.",
        how: [
          "Differential-drive motion model with process noise that scales with speed and turn rate, so a stationary robot does not accumulate drift.",
          "Hand-written in numpy so the update equations can be read directly.",
        ],
      },
      {
        name: "Explored-Area Mask (Fog of War)",
        where: "Simulator canvas, simController.js",
        what: "Reveals only the part of the map the robot's FLIR and ultrasonic sensors have actively covered.",
        how: [
          "A ring around the robot (2.1 m, ultrasonic range) and a forward FLIR mast cone (6 m, 55° FOV) are painted into a grow-only mask.",
          "Coverage % is a downsampled read of that mask; the fire is shown only once its cell has been swept.",
        ],
      },
    ],
  },
  {
    id: "planning",
    category: "motion",
    badge: "OMPL INFORMED RRT*",
    title: "Planning & Autonomous Robotics Control",
    icon: "🗺️",
    summary: "Asymptotically optimal RRT* path planning with cost-map obstacle inflation and pure pursuit trajectory tracking.",
    items: [
      {
        name: "RRT* Path Planning",
        where: "planning/rrtstar.py, ompl_planner.py",
        what: "Finds a collision-free route to the spray stand-off point next to the fire.",
        how: [
          "Grows a random tree on the occupancy grid, rewires nearby nodes for lower cost, then shortcuts the result.",
          "The grid is inflated by the robot radius plus a safety margin, so straight segments are safe for a point robot.",
          "An OMPL InformedRRT* planner is a drop-in swap; the browser demo runs the same algorithm in JavaScript.",
        ],
      },
      {
        name: "Frontier Exploration & Gap-Following Avoidance",
        where: "sim/frontier_controller.py, sim/scan_controller.py",
        what: "Explores unknown multi-room buildings on purpose instead of wandering or spinning in circles.",
        how: [
          "Clusters SLAM frontier edges and routes toward the highest information-gain viewpoint.",
          "Lidar-based gap-following avoidance steers through narrow corridors and doorways without getting stuck in corners.",
        ],
      },
    ],
  },
  {
    id: "hardware",
    category: "hardware",
    badge: "DUAL-MCU ARCHITECTURE",
    title: "Physical Hardware, ESP32 Real-Time Core & Power",
    icon: "🔌",
    summary: "Decoupled dual-compute architecture: ESP32 for 20 kHz ultrasonic motor PWM and 500ms safety watchdog, Raspberry Pi 5 for SLAM & cloud.",
    items: [
      {
        name: "ESP32 Real-Time Actuator Core & 500ms Watchdog",
        where: "firmware/esp32_firmware.ino, link/bridge.py",
        what: "Hard real-time microcontroller managing microsecond sonar timing, 20kHz motor PWM, and safety lockouts.",
        how: [
          "Dual-core Xtensa LX6 @ 240 MHz dedicated to timing-critical pulses and hardware fail-safe cutoff.",
          "20 kHz motor PWM on TB6612FNG H-Bridge eliminates audible coil whine and optimizes low-speed torque.",
          "Independent hardware watchdog timer cuts gate power to IRLZ44N water pump and motors if UART communication drops for >500 ms.",
        ],
      },
      {
        name: "Dual-Buck Isolated Power Architecture",
        where: "FireBot_Hardware_and_Wiring_Specification.pdf",
        what: "Physically isolated power rails preventing inductive motor spikes from causing MCU brownouts.",
        how: [
          "Primary 12.6V 3S LiPo rail feeds high-current motor drivers and 4.5 L/min diaphragm water pump.",
          "Buck Converter #1 (5V 3A) dedicated to ESP32 MCU, SG90 pan servo, and analog sensor arrays.",
          "Buck Converter #2 (5V 4A) dedicated strictly to Raspberry Pi 5 single-board computer.",
          "Star Ground topology post prevents electrical ground bounce between inductive loads and digital logic.",
        ],
      },
    ],
  },
];

const CATEGORIES = [
  { id: "all", label: "All Subsystems", count: 14 },
  { id: "ai", label: "AI & Voice SLM", count: 5 },
  { id: "estimation", label: "State Estimation & EIF", count: 3 },
  { id: "motion", label: "RRT* & Motion", count: 2 },
  { id: "sim", label: "3D MuJoCo Physics", count: 2 },
  { id: "hardware", label: "Hardware & ESP32", count: 2 },
  { id: "cloud", label: "Cloud & Hugging Face", count: 3 },
];

const SAMPLE_COMMANDS = [
  {
    text: "Douse the blaze in the datacenter immediately",
    intent: "EXTINGUISH",
    latency: "142 ms",
    json: { intent: "EXTINGUISH", room: "datacenter", pump: true, confidence: 0.98 },
  },
  {
    text: "Emergency stop right now, halt all movement",
    intent: "STOP",
    latency: "118 ms",
    json: { intent: "STOP", override: "latched", motors: 0, pump: false, confidence: 0.99 },
  },
  {
    text: "Advance forward 2.5 meters and sweep thermal mast",
    intent: "DRIVE_FORWARD",
    latency: "155 ms",
    json: { intent: "DRIVE", dir: "fwd", dist: 2.5, thermal_scan: true, confidence: 0.96 },
  },
  {
    text: "Return to docking post for refuel and recharge",
    intent: "RETURN_HOME",
    latency: "135 ms",
    json: { intent: "RETURN_HOME", target: "dock", battery_check: true, confidence: 0.97 },
  },
];

export default function About({ onNavigate }) {
  const [activeCategory, setActiveCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("pipeline"); // "pipeline" | "eif" | "slm" | "hardware" | "rooms"
  const [activeSampleCmd, setActiveSampleCmd] = useState(SAMPLE_COMMANDS[0]);

  // EIF Interactive Demo State
  const [eifReadings, setEifReadings] = useState(6);
  const eifCanvasRef = useRef(null);

  // Filter groups based on search & category
  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return GROUPS.map((g) => {
      if (activeCategory !== "all" && g.category !== activeCategory) return null;
      const items = g.items.filter((it) => {
        if (!q) return true;
        return (
          it.name.toLowerCase().includes(q) ||
          it.where.toLowerCase().includes(q) ||
          it.what.toLowerCase().includes(q) ||
          it.how.some((h) => h.toLowerCase().includes(q))
        );
      });
      if (items.length === 0) return null;
      return { ...g, items };
    }).filter(Boolean);
  }, [search, activeCategory]);

  // Draw Interactive EIF Canvas Demo
  useEffect(() => {
    if (activeTab !== "eif") return;
    const canvas = eifCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;

    ctx.fillStyle = "#0A0D14";
    ctx.fillRect(0, 0, w, h);

    // Subtle grid
    ctx.strokeStyle = "rgba(148, 163, 184, 0.08)";
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    const fireX = w * 0.65, fireY = h * 0.45;

    // Draw Fire Source
    ctx.fillStyle = "#EF4444";
    ctx.beginPath();
    ctx.arc(fireX, fireY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 74, 43, 0.5)";
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = "#FECDD3";
    ctx.font = "11px 'Martian Mono', monospace";
    ctx.fillText("FIRE TARGET (True)", fireX + 14, fireY + 4);

    // Calculate simulated robot positions around the fire
    const numReadings = eifReadings;
    const robotPositions = [];
    for (let i = 0; i < numReadings; i++) {
      const angle = (i / 10) * Math.PI * 1.5 + 0.3;
      const dist = 140;
      const rx = fireX - Math.cos(angle) * dist;
      const ry = fireY - Math.sin(angle) * dist;
      robotPositions.push({ x: rx, y: ry, angle });

      // Draw Bearing Ray Line
      ctx.strokeStyle = "rgba(14, 165, 233, 0.35)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(fireX, fireY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw Robot Observation Post
      ctx.fillStyle = "#10B981";
      ctx.beginPath();
      ctx.arc(rx, ry, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Connect Robot Observation Trajectory
    if (robotPositions.length > 1) {
      ctx.strokeStyle = "rgba(16, 185, 129, 0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(robotPositions[0].x, robotPositions[0].y);
      for (let i = 1; i < robotPositions.length; i++) {
        ctx.lineTo(robotPositions[i].x, robotPositions[i].y);
      }
      ctx.stroke();
    }

    // 2-Sigma Uncertainty Covariance Ellipse
    // As numReadings increases, ellipse shrinks dramatically!
    const sigmaRadiusX = Math.max(12, 110 / Math.sqrt(numReadings));
    const sigmaRadiusY = Math.max(10, 75 / Math.sqrt(numReadings));

    ctx.save();
    ctx.translate(fireX, fireY);
    ctx.rotate(0.25);
    ctx.fillStyle = "rgba(255, 178, 56, 0.15)";
    ctx.strokeStyle = "#FFB238";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, sigmaRadiusX, sigmaRadiusY, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Ellipse label
    ctx.fillStyle = "#FFB238";
    ctx.font = "10px 'Martian Mono', monospace";
    ctx.fillText(`2σ BELIEF BOUND: ±${(sigmaRadiusX / 40).toFixed(2)}m`, fireX - 60, fireY + sigmaRadiusY + 18);
  }, [activeTab, eifReadings]);

  return (
    <main className="flex-1 overflow-y-auto bg-base p-4 sm:p-6 lg:p-8 space-y-10 font-mono text-ink">
      <div className="max-w-[1240px] mx-auto space-y-10">
        {/* HERO TITLE & STATS RIBBON */}
        <header className="panel p-6 sm:p-8 relative overflow-hidden space-y-6 border border-line bg-gradient-to-b from-panel via-panel to-panel2">
          {/* Subtle Background Circuit Pattern */}
          <div className="absolute inset-0 pointer-events-none opacity-5 bg-[radial-gradient(#38bdf8_1px,transparent_1px)] [background-size:20px_20px]" />

          {/* Top Status & Links */}
          <div className="flex flex-wrap items-center justify-between gap-4 relative z-10">
            <div className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-telemetry animate-pulse" />
              <span className="text-[11px] font-mono uppercase tracking-widest text-telemetry font-bold">
                SYSTEM ARCHITECTURE & TECHNICAL MANUAL
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <a
                href="/FireBot_Hardware_and_Wiring_Specification.pdf"
                download="FireBot_Hardware_and_Wiring_Specification.pdf"
                className="px-3 py-1.5 rounded-lg bg-base hover:bg-panel2 border border-line hover:border-telemetry/40 text-[11px] font-mono text-ink hover:text-telemetry transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <span>📄</span>
                <span>Hardware Spec (PDF)</span>
                <span className="text-faint">↓</span>
              </a>
              <a
                href="https://huggingface.co/anabaena/firebot-voice-intent"
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-1.5 rounded-lg bg-base hover:bg-panel2 border border-line text-[11px] font-mono text-muted hover:text-ink transition-colors flex items-center gap-1.5"
              >
                <span>🤗</span>
                <span>HF Model Hub</span>
                <span className="text-faint">↗</span>
              </a>
              <a
                href="https://firebot-api.onrender.com"
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-1.5 rounded-lg bg-base hover:bg-panel2 border border-line text-[11px] font-mono text-muted hover:text-ink transition-colors flex items-center gap-1.5"
              >
                <span>⚡</span>
                <span>Render API</span>
                <span className="text-faint">↗</span>
              </a>
            </div>
          </div>

          <div className="space-y-3 relative z-10">
            <h1 className="font-display font-black text-2xl sm:text-4xl lg:text-5xl tracking-tight text-white leading-tight">
              Inside FireBot: Perception, AI Intent &amp; Autonomous Control
            </h1>
            <p className="text-sm sm:text-base text-muted max-w-4xl leading-relaxed font-sans">
              FireBot is an autonomous hazardous-environment firefighting platform engineered with strict sub-second voice routing, bearing-only Bayesian triangulation, collision-free RRT* path planning, and dual-compute hardware fail-safes. Explore the interactive visual architecture below to trace how data flows from sensors to water suppression.
            </p>
          </div>

          {/* BY THE NUMBERS SPECIFICATIONS RIBBON */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-2 relative z-10 border-t border-line/80">
            <div className="p-3 rounded-xl bg-base/60 border border-line">
              <span className="text-[10px] text-faint uppercase tracking-wider block">SLM Latency</span>
              <span className="font-bold text-lg text-telemetry">&lt; 185 ms</span>
              <span className="text-[10px] text-muted block mt-0.5">Groq Allam / Qwen</span>
            </div>
            <div className="p-3 rounded-xl bg-base/60 border border-line">
              <span className="text-[10px] text-faint uppercase tracking-wider block">Thermal Array</span>
              <span className="font-bold text-lg text-amber-400">32 × 24</span>
              <span className="text-[10px] text-muted block mt-0.5">768 Radiometric px</span>
            </div>
            <div className="p-3 rounded-xl bg-base/60 border border-line">
              <span className="text-[10px] text-faint uppercase tracking-wider block">Voice Biometrics</span>
              <span className="font-bold text-lg text-sky-400">192-dim</span>
              <span className="text-[10px] text-muted block mt-0.5">ECAPA-TDNN</span>
            </div>
            <div className="p-3 rounded-xl bg-base/60 border border-line">
              <span className="text-[10px] text-faint uppercase tracking-wider block">Motor PWM</span>
              <span className="font-bold text-lg text-emerald-400">20 kHz</span>
              <span className="text-[10px] text-muted block mt-0.5">Zero Coil Whine</span>
            </div>
            <div className="p-3 rounded-xl bg-base/60 border border-line">
              <span className="text-[10px] text-faint uppercase tracking-wider block">Water Delivery</span>
              <span className="font-bold text-lg text-cyan-400">4.5 L/min</span>
              <span className="text-[10px] text-muted block mt-0.5">4.2 Bar Pressure</span>
            </div>
            <div className="p-3 rounded-xl bg-base/60 border border-line">
              <span className="text-[10px] text-faint uppercase tracking-wider block">Safety Watchdog</span>
              <span className="font-bold text-lg text-red-400">500 ms</span>
              <span className="text-[10px] text-muted block mt-0.5">Hardware Cutoff</span>
            </div>
          </div>
        </header>

        {/* INTERACTIVE VISUAL ARCHITECTURE EXPLORER */}
        <section className="space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-line flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-ok" />
              <span className="text-xs font-bold uppercase tracking-widest text-ink">
                INTERACTIVE ARCHITECTURE SANDBOX &amp; PIPELINES
              </span>
            </div>
            {/* Visual Tabs Selector */}
            <div className="flex items-center gap-1 bg-panel p-1 rounded-xl border border-line text-xs">
              <button
                onClick={() => { playSound("tab"); setActiveTab("pipeline"); }}
                className={`px-3 py-1.5 rounded-lg transition-colors font-semibold ${activeTab === "pipeline" ? "bg-telemetry text-base shadow-sm" : "text-muted hover:text-ink"}`}
              >
                1. System Flowchart
              </button>
              <button
                onClick={() => { playSound("tab"); setActiveTab("eif"); }}
                className={`px-3 py-1.5 rounded-lg transition-colors font-semibold ${activeTab === "eif" ? "bg-telemetry text-base shadow-sm" : "text-muted hover:text-ink"}`}
              >
                2. EIF Triangulation
              </button>
              <button
                onClick={() => { playSound("tab"); setActiveTab("slm"); }}
                className={`px-3 py-1.5 rounded-lg transition-colors font-semibold ${activeTab === "slm" ? "bg-telemetry text-base shadow-sm" : "text-muted hover:text-ink"}`}
              >
                3. Groq SLM Parser
              </button>
              <button
                onClick={() => { playSound("tab"); setActiveTab("hardware"); }}
                className={`px-3 py-1.5 rounded-lg transition-colors font-semibold ${activeTab === "hardware" ? "bg-telemetry text-base shadow-sm" : "text-muted hover:text-ink"}`}
              >
                4. Dual-Compute Bus
              </button>
            </div>
          </div>

          {/* TAB 1: 4-STAGE PIPELINE FLOWCHART */}
          {activeTab === "pipeline" && (
            <div className="panel p-6 rounded-2xl border border-line space-y-6 bg-panel/70">
              <div className="text-center max-w-xl mx-auto space-y-1">
                <h3 className="font-display font-bold text-xl text-white">
                  End-to-End Robotics Autonomous Pipeline
                </h3>
                <p className="text-xs text-muted">
                  How real-time sensory inputs transform through Bayesian estimation and cognitive SLM parsing into physical actuation.
                </p>
              </div>

              {/* 4 Interactive Flow Nodes */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 relative">
                {/* Stage 1: Sensing */}
                <div className="p-4 rounded-xl bg-base border border-line space-y-3 relative group hover:border-telemetry transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/20">STAGE 01</span>
                    <span className="text-base">🛰️</span>
                  </div>
                  <h4 className="font-bold text-sm text-white">Multimodal Sensing</h4>
                  <ul className="text-[11px] text-muted space-y-1.5">
                    <li>• FLIR MLX90640 (32×24 IR)</li>
                    <li>• 3× UV/IR Flame Photodiodes</li>
                    <li>• 4× HC-SR04 Sonar Envelopes</li>
                    <li>• Dual MQ-2 Gas Sensors</li>
                  </ul>
                  <div className="pt-2 text-[10px] text-faint border-t border-line">
                    Hardware Bus: I2C (400kHz) + ADC
                  </div>
                </div>

                {/* Stage 2: Estimation */}
                <div className="p-4 rounded-xl bg-base border border-line space-y-3 relative group hover:border-amber-400 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">STAGE 02</span>
                    <span className="text-base">📡</span>
                  </div>
                  <h4 className="font-bold text-sm text-white">Belief &amp; SLAM</h4>
                  <ul className="text-[11px] text-muted space-y-1.5">
                    <li>• Bearing-only EIF Filter</li>
                    <li>• 2σ Covariance Ellipse (x̂, ŷ)</li>
                    <li>• Odometry Pose EKF</li>
                    <li>• Next-Best-View (NBV) Frontier</li>
                  </ul>
                  <div className="pt-2 text-[10px] text-faint border-t border-line">
                    Rate: 10 Hz Bayesian updates
                  </div>
                </div>

                {/* Stage 3: Cognitive AI */}
                <div className="p-4 rounded-xl bg-base border border-line space-y-3 relative group hover:border-emerald-400 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">STAGE 03</span>
                    <span className="text-base">🧠</span>
                  </div>
                  <h4 className="font-bold text-sm text-white">AI Intent &amp; Policy</h4>
                  <ul className="text-[11px] text-muted space-y-1.5">
                    <li>• Groq Hosted SLM (Allam/Qwen)</li>
                    <li>• ECAPA-TDNN Speaker ID</li>
                    <li>• Whisper Classifier Heads</li>
                    <li>• MM-FusionRL Cross-Attention</li>
                  </ul>
                  <div className="pt-2 text-[10px] text-faint border-t border-line">
                    Latency: &lt;185ms JSON dispatch
                  </div>
                </div>

                {/* Stage 4: Motion */}
                <div className="p-4 rounded-xl bg-base border border-line space-y-3 relative group hover:border-red-400 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">STAGE 04</span>
                    <span className="text-base">🚀</span>
                  </div>
                  <h4 className="font-bold text-sm text-white">Actuation &amp; Water</h4>
                  <ul className="text-[11px] text-muted space-y-1.5">
                    <li>• Informed RRT* Motion Paths</li>
                    <li>• Pure Pursuit Steering</li>
                    <li>• TB6612FNG 20kHz PWM Drive</li>
                    <li>• IRLZ44N Water Cannon Gate</li>
                  </ul>
                  <div className="pt-2 text-[10px] text-faint border-t border-line">
                    Safety: 500ms Watchdog Halt
                  </div>
                </div>
              </div>

              {/* Direct Jump Button */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => onNavigate?.("sim")}
                  className="px-4 py-2 rounded-xl bg-telemetry hover:bg-sky-400 text-base font-bold text-xs uppercase tracking-wider transition-colors flex items-center gap-1.5"
                >
                  <span>Launch 2D Simulator to Test Pipeline</span>
                  <span>→</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: INTERACTIVE EIF TRIANGULATION DEMO */}
          {activeTab === "eif" && (
            <div className="panel p-6 rounded-2xl border border-line space-y-5 bg-panel/70">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-display font-bold text-lg text-white">
                    Bearing-Only Extended Information Filter (EIF)
                  </h3>
                  <p className="text-xs text-muted">
                    Watch the 2-sigma uncertainty ellipse shrink as multiple bearing observations are fused.
                  </p>
                </div>
                {/* Slider Control */}
                <div className="flex items-center gap-3 bg-base px-3 py-2 rounded-xl border border-line">
                  <span className="text-xs text-muted">Sightings:</span>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={eifReadings}
                    onChange={(e) => setEifReadings(Number(e.target.value))}
                    className="accent-telemetry cursor-pointer w-28"
                  />
                  <span className="text-xs font-bold text-telemetry">{eifReadings} views</span>
                </div>
              </div>

              {/* Canvas Viewport */}
              <div className="relative rounded-xl overflow-hidden border border-line bg-[#0A0D14]">
                <canvas ref={eifCanvasRef} width={640} height={320} className="w-full h-72 block" />
              </div>

              {/* Explanation Footnote */}
              <div className="p-3.5 rounded-xl bg-base border border-line text-xs text-muted space-y-1">
                <span className="font-bold text-ink">How it works mathematically:</span>
                <p>
                  Photodiodes measure fire azimuth but cannot detect depth. FireBot maintains an information matrix <code className="text-telemetry font-mono">Y = P⁻¹</code> and vector <code className="text-telemetry font-mono">y = P⁻¹x̂</code>. As the robot traverses its trajectory, each bearing observation adds a rank-1 outer product <code className="text-telemetry font-mono">Hᵢᵀ R⁻¹ Hᵢ</code>. Collinear uncertainty collapses rapidly into a tight spatial lock without expensive lidar depth hardware.
                </p>
              </div>
            </div>
          )}

          {/* TAB 3: GROQ SLM INTENT SANDBOX */}
          {activeTab === "slm" && (
            <div className="panel p-6 rounded-2xl border border-line space-y-5 bg-panel/70">
              <div>
                <h3 className="font-display font-bold text-lg text-white">
                  Groq Hosted SLM Intent Engine Sandbox
                </h3>
                <p className="text-xs text-muted">
                  Click any tactical phrase to test the sub-185ms JSON translation and schema enforcement.
                </p>
              </div>

              {/* Sample Commands Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {SAMPLE_COMMANDS.map((cmd) => (
                  <button
                    key={cmd.intent}
                    onClick={() => { playSound("click"); setActiveSampleCmd(cmd); }}
                    className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between gap-1.5 ${activeSampleCmd.intent === cmd.intent ? "bg-base border-telemetry shadow-sm" : "bg-base/60 border-line hover:border-line2"}`}
                  >
                    <span className="text-xs text-white font-medium">"{cmd.text}"</span>
                    <div className="flex items-center justify-between text-[10px] font-mono text-muted">
                      <span className="text-telemetry font-bold">INTENT: {cmd.intent}</span>
                      <span>⚡ {cmd.latency}</span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Live Parsed Output View */}
              <div className="p-4 rounded-xl bg-[#0A0D14] border border-line space-y-2">
                <div className="flex items-center justify-between text-[11px] text-muted pb-2 border-b border-white/10">
                  <span className="font-bold text-white flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                    Structured Robotics JSON Payload
                  </span>
                  <span className="text-telemetry font-bold">Latency: {activeSampleCmd.latency}</span>
                </div>
                <pre className="text-xs text-emerald-400 font-mono overflow-x-auto p-2">
                  {JSON.stringify(activeSampleCmd.json, null, 2)}
                </pre>
              </div>

              {/* Direct Link to Voice Calibration Studio */}
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => onNavigate?.("voice")}
                  className="px-4 py-2 rounded-xl bg-telemetry hover:bg-sky-400 text-base font-bold text-xs uppercase tracking-wider transition-colors flex items-center gap-1.5"
                >
                  <span>Open Voice Studio to Calibrate Operator Model</span>
                  <span>→</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: DUAL-COMPUTE HARDWARE BUS SCHEMATIC */}
          {activeTab === "hardware" && (
            <div className="panel p-6 rounded-2xl border border-line space-y-5 bg-panel/70">
              <div>
                <h3 className="font-display font-bold text-lg text-white">
                  Decoupled Dual-Compute Hardware Architecture
                </h3>
                <p className="text-xs text-muted">
                  Physical isolation between hard real-time actuators (ESP32) and high-level perception (Raspberry Pi 5).
                </p>
              </div>

              {/* Visual Hardware Topology Diagram */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Raspberry Pi 5 Node */}
                <div className="p-5 rounded-xl bg-base border border-line space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-sky-400">Raspberry Pi 5 (8GB)</span>
                    <span className="text-[10px] bg-sky-500/10 text-sky-400 px-2 py-0.5 rounded border border-sky-500/20">HIGH-LEVEL</span>
                  </div>
                  <ul className="text-xs text-muted space-y-1.5">
                    <li>• MLX90640 FLIR Thermal I2C Master (0x33 @ 400kHz)</li>
                    <li>• AudioWorklet Voice Capture &amp; WebSockets</li>
                    <li>• SLAM Occupancy Grid &amp; Next-Best-View (NBV)</li>
                    <li>• Render PostgreSQL &amp; Hugging Face Sync</li>
                  </ul>
                  <div className="text-[11px] text-faint pt-2 border-t border-line">
                    Power: Isolated Buck #2 (5.1V / 4A Dedicated Type-C)
                  </div>
                </div>

                {/* ESP32 Real-Time Node */}
                <div className="p-5 rounded-xl bg-base border border-line space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-emerald-400">ESP32 DevKit V1 (Dual-Core)</span>
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20">REAL-TIME MCU</span>
                  </div>
                  <ul className="text-xs text-muted space-y-1.5">
                    <li>• 20 kHz Ultrasonic Motor PWM (TB6612FNG Driver)</li>
                    <li>• Microsecond-level HC-SR04 Trigger / Echo Timing</li>
                    <li>• IRLZ44N MOSFET Water Pump Gate Control</li>
                    <li>• 500ms Hardware Watchdog Failsafe Lockout</li>
                  </ul>
                  <div className="text-[11px] text-faint pt-2 border-t border-line">
                    Power: Isolated Buck #1 (5.0V / 3A Regulated Logic)
                  </div>
                </div>
              </div>

              {/* Interconnect & Safety Bus */}
              <div className="p-4 rounded-xl bg-base border border-line flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-telemetry animate-pulse" />
                  <span className="text-ink font-semibold">Inter-MCU Bus:</span>
                  <span className="text-muted">UART 115,200 Baud (/dev/ttyUSB0) with Newline-Delimited JSON framing</span>
                </div>
                <a
                  href="/FireBot_Hardware_and_Wiring_Specification.pdf"
                  download="FireBot_Hardware_and_Wiring_Specification.pdf"
                  className="px-3 py-1.5 rounded-lg bg-panel hover:bg-panel2 border border-line text-telemetry font-bold text-[11px] transition-colors flex items-center gap-1"
                >
                  <span>Download Pinout Schematics (PDF)</span>
                  <span>↓</span>
                </a>
              </div>
            </div>
          )}
        </section>

        {/* DOMAIN FILTER PILLS & SEARCH */}
        <section className="space-y-4 pt-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-2 border-b border-line">
            {/* Domain Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full text-xs">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => { playSound("click"); setActiveCategory(cat.id); }}
                  className={`px-3 py-1.5 rounded-xl whitespace-nowrap transition-colors font-medium border ${activeCategory === cat.id ? "bg-telemetry text-base font-bold border-telemetry shadow-sm" : "bg-panel border-line text-muted hover:text-ink hover:border-line2"}`}
                >
                  {cat.label} ({cat.count})
                </button>
              ))}
            </div>

            {/* Instant Search Bar */}
            <div className="relative w-full md:w-72 shrink-0">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search modules, files, SLM…"
                className="w-full bg-panel border border-line rounded-xl px-3.5 py-1.5 pl-9 text-xs text-ink font-mono focus:border-telemetry outline-none"
              />
              <span className="absolute left-3 top-2 text-faint text-xs">🔍</span>
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1.5 text-[10px] text-faint hover:text-ink px-1.5 py-0.5 rounded bg-panel2"
                >
                  CLEAR
                </button>
              )}
            </div>
          </div>

          {/* SUBSYSTEM PRODUCTION MODULES DOSSIER */}
          <div className="space-y-8 min-w-0">
            {filteredGroups.length === 0 && (
              <div className="panel p-12 text-center text-muted font-mono text-sm">
                No architecture modules matched your filter criteria.
              </div>
            )}

            {filteredGroups.map((g) => (
              <article key={g.id} className="panel p-6 sm:p-8 space-y-6 border border-line bg-panel/75">
                {/* Subsystem Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-line">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl p-2 rounded-xl bg-base border border-line">{g.icon}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-telemetry uppercase tracking-wider">{g.badge}</span>
                      </div>
                      <h2 className="font-display font-extrabold text-lg sm:text-xl text-white tracking-tight">
                        {g.title}
                      </h2>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-base text-muted border border-line self-start sm:self-auto">
                    {g.items.length} Production Modules
                  </span>
                </div>

                <p className="text-xs sm:text-sm text-muted leading-relaxed font-sans">
                  {g.summary}
                </p>

                {/* Subsystem Items Grid */}
                <div className="divide-y divide-line/60">
                  {g.items.map((it) => (
                    <div key={it.name} className="py-5 first:pt-0 last:pb-0 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
                      <div>
                        <h3 className="font-display font-bold text-base text-white">
                          {it.name}
                        </h3>
                        <code className="data inline-block mt-2 px-2.5 py-1 rounded-md bg-base text-[11px] font-mono text-telemetry border border-line">
                          {it.where}
                        </code>
                        <p className="mt-2.5 text-xs text-muted leading-relaxed font-sans">
                          {it.what}
                        </p>
                      </div>

                      <ul className="space-y-2 text-xs leading-relaxed text-ink/80">
                        {it.how.map((h, i) => (
                          <li key={i} className="pl-3 border-l-2 border-line hover:border-telemetry transition-colors">
                            {h}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
