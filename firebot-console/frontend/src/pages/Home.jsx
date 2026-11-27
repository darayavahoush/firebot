import React, { useState, useEffect } from "react";
import { playSound } from "../lib/sound.js";

// Interactive Rover Hotspots metadata
const HOTSPOTS = [
  {
    id: "flir",
    label: "FLIR Thermal Mast",
    tag: "MLX90640-D55",
    x: 48, // % from left
    y: 28, // % from top
    desc: "32×24 Far-Infrared array (768 pixels). Penetrates zero-visibility smoke to lock on flame centroids at 8 Hz.",
    specs: ["I2C (0x33) @ 400kHz", "-40°C to 300°C Range", "±1.0°C Accuracy"],
  },
  {
    id: "turret",
    label: "Motorized Water Cannon",
    tag: "12V Diaphragm Nozzle",
    x: 64,
    y: 22,
    desc: "Machined brass nozzle driven by logic-level N-MOSFET (IRLZ44N) with SG90 pan servo swept across 180°.",
    specs: ["4.5 L/min Flow Rate", "180° Pan Swept Angle", "1N4007 Diode Protected"],
  },
  {
    id: "tracks",
    label: "High-Traction Tracks",
    tag: "Differential Drive",
    x: 24,
    y: 74,
    desc: "Heavy-duty steel-reinforced rubber tracks driven by dual geared DC motors with 20 kHz ultrasonic PWM.",
    specs: ["20 kHz Silent PWM", "TB6612FNG H-Bridge", "0.60 m/s Top Speed"],
  },
  {
    id: "compute",
    label: "Dual-Compute Core",
    tag: "ESP32 RTOS + Pi 4/5",
    x: 52,
    y: 52,
    desc: "Hard real-time ESP32 for 500ms safety watchdog and sensor polling, paired with Raspberry Pi over UART.",
    specs: ["240 MHz Dual-Core", "500ms Auto Watchdog", "115200 Baud Bridge"],
  },
];

// Interactive Hardware Tabs
const HW_TABS = {
  esp32: {
    title: "ESP32 DevKit V1 (Hard Real-Time RTOS)",
    badge: "240 MHz MCU",
    desc: "Responsible for sub-millisecond ultrasonic pulses, 20 kHz PWM motor control, 12-bit ADC sampling, and hardware watchdog.",
    items: [
      { name: "4x HC-SR04 Ultrasonic", pins: "GPIO 13, 12, 14, 27", note: "Echo via 1k/2k 3.3V divider" },
      { name: "3x IR Flame Modules", pins: "GPIO 25, 26, 33", note: "Active-LOW optical fire trigger" },
      { name: "2x MQ-2 Smoke/Gas", pins: "GPIO 32, 15 (ADC1)", note: "Continuous 0-3.3V gas density" },
      { name: "Dual DC Motor Drive", pins: "GPIO 18, 19, 21 / 22, 23, 5", note: "20 kHz PWM + Direction IN1-IN4" },
      { name: "12V Diaphragm Pump", pins: "GPIO 17", note: "IRLZ44N MOSFET gate with 10k pull-down" },
      { name: "SG90 Turret Servo", pins: "GPIO 16", note: "50 Hz PWM (-90° to +90° pan sweep)" },
    ],
  },
  pi: {
    title: "Raspberry Pi 4 / 5 (Linux SBC Client)",
    badge: "Quad-Core SBC",
    desc: "Samples the MLX90640-D55 thermal camera over I2C, runs the client link agent, and streams telemetry packets over TCP.",
    items: [
      { name: "MLX90640-D55 Thermal", pins: "Pin 3 (SDA), Pin 5 (SCL)", note: "I2C Address 0x33 @ 400kHz Fast-Mode" },
      { name: "Thermal Power & Ground", pins: "Pin 1 (3.3V), Pin 9 (GND)", note: "Filtered 3.3V ASIC supply" },
      { name: "ESP32 Serial Link", pins: "USB 2.0 / 3.0 (/dev/ttyUSB0)", note: "115200 Baud line-delimited JSON" },
      { name: "PC Brain Network", pins: "Wi-Fi 802.11ac / GbE", note: "Encrypted TCP socket on port 8765" },
    ],
  },
  power: {
    title: "Isolated Power Distribution Architecture",
    badge: "Dual Buck Isolation",
    desc: "Separates noisy motor and pump inductive loads from sensitive Raspberry Pi logic to prevent voltage brownout resets.",
    items: [
      { name: "Main Battery Rail", pins: "12V 3S LiPo / LiFePO4", note: "Direct power to Motor VM & 12V Pump" },
      { name: "Buck Regulator #1", pins: "12V -> 5V @ 3A", note: "Powers ESP32 VIN, Servos, Sensors" },
      { name: "Buck Regulator #2", pins: "12V -> 5V @ 3A-5A", note: "Dedicated isolated power for Raspberry Pi" },
      { name: "Common Ground Bus", pins: "Single GND Star Topology", note: "Ties battery, bucks, MCU, and SBC" },
    ],
  },
};

export default function Home({ onEnterConsole, frame, linkOk }) {
  const [activeSpot, setActiveSpot] = useState(HOTSPOTS[0]);
  const [activeHwTab, setActiveHwTab] = useState("esp32");
  const [simLog, setSimLog] = useState([
    "EIF STATE ESTIMATION: Sensor fusion nominal",
    "FLIR MLX90640: Thermal centroid locked (68.4°C)",
    "RRT* PLANNER: Optimal escape corridor verified",
    "ESP32 WATCHDOG: Command link heartbeat verified (20ms)",
  ]);

  const handleLaunch = (target = "live") => {
    playSound("tab");
    onEnterConsole(target);
  };

  // Simulate a live tactical heartbeat in the terminal
  useEffect(() => {
    const messages = [
      "EIF FUSION: Flame vector bearing at +12.4°",
      "ULTRASONIC RING: FL: 1.45m | FR: 1.52m | L: 2.10m | R: 1.88m",
      "GAS DETECTOR: MQ-2 front reading 0.142 norm (Safe range)",
      "WATER RESERVOIR: Tank level at 88% • Diaphragm pump primed",
      "TURRET SERVO: SG90 pan centered (0.00 rad)",
      "ODOMETRY: Robot position [X: 1.24m, Y: 0.85m, θ: 18°]",
    ];
    const timer = setInterval(() => {
      setSimLog((prev) => [
        messages[Math.floor(Math.random() * messages.length)],
        ...prev.slice(0, 4),
      ]);
    }, 3200);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen bg-base text-ink flex flex-col font-sans selection:bg-telemetry/30 selection:text-white relative overflow-x-hidden">
      {/* Background Ambience & Cyber Grid */}
      <div className="fixed inset-0 pointer-events-none z-0 opacity-40">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-telemetry/10 rounded-full blur-[140px]" />
        <div className="absolute bottom-1/3 right-10 w-[500px] h-[500px] bg-flame/10 rounded-full blur-[140px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:48px_48px]" />
      </div>

      {/* Floating Modern Capsule Header */}
      <header className="sticky top-4 z-50 px-6 max-w-7xl mx-auto w-full">
        <div className="backdrop-blur-2xl bg-panel/75 border border-line rounded-2xl px-5 py-3 flex items-center justify-between shadow-[0_16px_36px_rgba(0,0,0,0.45)]">
          {/* Logo & Emblems */}
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-telemetry via-flame to-warn flex items-center justify-center shadow-[0_0_18px_rgba(240,85,155,0.4)] shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0E0919" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display font-black text-[15px] tracking-wider text-ink">
                  FIREBOT
                </span>
                <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-telemetry/15 text-telemetry border border-telemetry/30 font-bold">
                  TAC-OPS V2.5
                </span>
              </div>
            </div>
          </div>

          {/* Center Navigation Links */}
          <nav className="hidden lg:flex items-center gap-6 text-[11px] font-mono text-muted tracking-wider uppercase font-medium">
            <a href="#overview" className="hover:text-ink transition-colors">Vessel Overview</a>
            <a href="#hologram" className="hover:text-ink transition-colors">Interactive X-Ray</a>
            <a href="#features" className="hover:text-ink transition-colors">Autonomy Pillars</a>
            <a href="#hardware" className="hover:text-ink transition-colors">Hardware &amp; Wiring</a>
          </nav>

          {/* Action CTAs */}
          <div className="flex items-center gap-2.5">
            <a
              href="/FireBot_Hardware_and_Wiring_Specification.pdf"
              download="FireBot_Hardware_and_Wiring_Specification.pdf"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-panel2/70 hover:bg-panel2 border border-line hover:border-line2 text-[11px] font-mono text-muted hover:text-ink transition-all"
              title="Download 14-page Hardware & Wiring PDF"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ok">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Manual PDF</span>
            </a>

            <button
              onClick={() => handleLaunch("live")}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-telemetry to-flame text-white font-mono text-[11px] font-bold shadow-lg shadow-telemetry/30 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-2"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
              </span>
              ENTER CONSOLE &rarr;
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 space-y-24 py-10 md:py-16 relative z-10">
        {/* HERO SECTION */}
        <section id="overview" className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-12 items-center">
            {/* Left Narrative */}
            <div className="space-y-7">
              <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-panel2/80 border border-line text-[11px] font-mono text-telemetry tracking-wide uppercase shadow-sm">
                <span className="h-2 w-2 rounded-full bg-telemetry animate-pulse" />
                High-Hazard Autonomous Robotics
              </div>

              <div className="space-y-4">
                <h1 className="text-4xl sm:text-6xl font-extrabold text-ink tracking-tight leading-[1.08] font-display">
                  Autonomous <br />
                  Suppression. <br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-telemetry via-flame to-warn">
                    Engineered For The Inhabitable.
                  </span>
                </h1>
                <p className="text-muted text-sm sm:text-base leading-relaxed max-w-xl font-sans">
                  Built for zero-visibility structural collapses and industrial disaster zones.
                  Pairing dual-compute edge architecture (Raspberry Pi &amp; ESP32 RTOS) with
                  radiometric far-infrared tracking, continuous MuJoCo physics, and fail-safe voice control.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-3.5 pt-2">
                <button
                  onClick={() => handleLaunch("live")}
                  className="px-7 py-4 rounded-2xl bg-gradient-to-r from-telemetry via-[#C4286F] to-flame text-white font-mono text-[13px] font-bold shadow-xl shadow-telemetry/30 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-2.5 group"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="2" />
                    <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
                  </svg>
                  <span>LAUNCH COMMAND CENTRE</span>
                  <span className="group-hover:translate-x-0.5 transition-transform">&rarr;</span>
                </button>

                <button
                  onClick={() => handleLaunch("mujoco")}
                  className="px-6 py-4 rounded-2xl bg-panel2/80 hover:bg-panel2 border border-line hover:border-line2 text-ink font-mono text-[13px] font-medium transition-all flex items-center gap-2"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-telemetry">
                    <path d="m21 16-9 5-9-5V8l9-5 9 5v8z" />
                    <path d="m3.27 6.96 8.73 4.85 8.73-4.85M12 22V12" />
                  </svg>
                  3D MuJoCo Physics Sim
                </button>
              </div>

              {/* Micro Metrics Strip */}
              <div className="grid grid-cols-3 gap-4 pt-6 border-t border-line/50">
                <div className="space-y-0.5">
                  <div className="text-2xl font-bold font-mono text-ink">32×24</div>
                  <div className="text-[11px] font-mono text-faint">FLIR IR Matrix</div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-2xl font-bold font-mono text-telemetry">&lt; 120 ms</div>
                  <div className="text-[11px] font-mono text-faint">Decision Latency</div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-2xl font-bold font-mono text-flame">4.5 L/min</div>
                  <div className="text-[11px] font-mono text-faint">Suppression Cannon</div>
                </div>
              </div>
            </div>

            {/* Right Hero Cinematic Graphic */}
            <div className="relative group">
              <div className="relative rounded-3xl overflow-hidden border border-line/80 shadow-2xl bg-panel2/80">
                <img
                  src="/firebot-hero.jpg"
                  alt="FireBot Autonomous Tactical Firefighting Rover"
                  className="w-full h-auto object-cover transform group-hover:scale-[1.03] transition-transform duration-700 ease-out"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-base via-transparent to-transparent opacity-85 pointer-events-none" />

                {/* Tactical Status Tag */}
                <div className="absolute top-4 left-4 bg-base/80 backdrop-blur-md border border-white/10 px-3.5 py-1.5 rounded-full text-[11px] font-mono text-white flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-ok animate-pulse" />
                  ROBOT: firebot-1 &bull; READY FOR SORTIE
                </div>

                {/* Bottom HUD Bar */}
                <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-[11px] font-mono text-white/90">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-telemetry/40 border border-telemetry/60 text-white font-bold">
                      FLIR LOCK
                    </span>
                    <span className="text-white/80">FLAME CENTROID [68.4°C]</span>
                  </div>
                  <span className="text-white/60">ESP32 RTOS 240MHz</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* INTERACTIVE ROVER X-RAY EXPLORER */}
        <section id="hologram" className="max-w-7xl mx-auto px-6 space-y-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-widest text-telemetry font-semibold">
                ANATOMY &amp; MECHANICAL BLUEPRINT
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-ink font-display tracking-tight mt-1">
                Explore The Physical Architecture
              </h2>
            </div>
            <p className="text-xs font-mono text-muted max-w-sm">
              Click any component tag below to inspect hardware pinouts, power ratings, and fail-safe specs.
            </p>
          </div>

          <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-8 items-start">
            {/* Visual Interactive Map */}
            <div className="relative rounded-3xl overflow-hidden border border-line bg-panel2/60 backdrop-blur-xl p-4 shadow-xl">
              <div className="relative rounded-2xl overflow-hidden bg-black">
                <img
                  src="/firebot-rover-detail.jpg"
                  alt="FireBot Hardware Anatomy"
                  className="w-full h-auto object-cover opacity-90"
                />

                {/* Hotspot Radar Pins */}
                {HOTSPOTS.map((spot) => (
                  <button
                    key={spot.id}
                    onClick={() => {
                      playSound("tab");
                      setActiveSpot(spot);
                    }}
                    style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 p-2 rounded-full transition-transform duration-200 ${
                      activeSpot.id === spot.id ? "scale-125 z-20" : "hover:scale-110 z-10"
                    }`}
                  >
                    <span className="relative flex h-5 w-5">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                        activeSpot.id === spot.id ? "bg-telemetry" : "bg-white"
                      }`}></span>
                      <span className={`relative inline-flex rounded-full h-5 w-5 border-2 border-white/80 shadow-lg ${
                        activeSpot.id === spot.id ? "bg-telemetry" : "bg-panel2"
                      }`}></span>
                    </span>
                  </button>
                ))}
              </div>

              {/* Hotspot Quick Selectors */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-4">
                {HOTSPOTS.map((spot) => (
                  <button
                    key={spot.id}
                    onClick={() => {
                      playSound("tab");
                      setActiveSpot(spot);
                    }}
                    className={`px-3 py-2 rounded-xl text-[11px] font-mono text-left transition-all border ${
                      activeSpot.id === spot.id
                        ? "bg-telemetry/15 border-telemetry/50 text-telemetry font-bold shadow-sm"
                        : "bg-panel border-line text-muted hover:text-ink hover:border-line2"
                    }`}
                  >
                    {spot.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Active Component Specification Card */}
            <div className="panel p-7 rounded-3xl border border-line bg-panel/90 space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-line">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-telemetry font-semibold">
                    COMPONENT SPECIFICATION
                  </span>
                  <h3 className="text-xl font-bold font-display text-ink mt-0.5">
                    {activeSpot.label}
                  </h3>
                </div>
                <span className="px-2.5 py-1 rounded-lg bg-panel2 border border-line text-[11px] font-mono text-ink font-bold">
                  {activeSpot.tag}
                </span>
              </div>

              <p className="text-xs text-muted leading-relaxed font-sans">
                {activeSpot.desc}
              </p>

              <div className="space-y-2.5 pt-2">
                <span className="text-[10px] font-mono uppercase tracking-widest text-faint font-semibold">
                  HARDWARE CHARACTERISTICS
                </span>
                <div className="space-y-2">
                  {activeSpot.specs.map((spec, i) => (
                    <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-panel2/50 border border-line text-xs font-mono text-ink">
                      <span className="h-1.5 w-1.5 rounded-full bg-telemetry" />
                      <span>{spec}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Direct Link to View in Command Console */}
              <div className="pt-4 border-t border-line">
                <button
                  onClick={() => handleLaunch("live")}
                  className="w-full py-3 rounded-xl bg-panel2 hover:bg-panel2/80 border border-line hover:border-telemetry/40 text-ink font-mono text-xs font-semibold flex items-center justify-center gap-2 transition-all"
                >
                  <span>Test in Live Teleop Deck</span>
                  <span>&rarr;</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 4 CORE AUTONOMY PILLARS (BENTO GRID) */}
        <section id="features" className="max-w-7xl mx-auto px-6 space-y-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-widest text-telemetry font-semibold">
                TECHNOLOGY MATRIX
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-ink font-display tracking-tight mt-1">
                Engineered For Mission Autonomy
              </h2>
            </div>
            <span className="text-[11px] font-mono text-faint">INTEGRATED ROBOTIC SUBSYSTEMS</span>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Bento Card 1: Thermal FLIR */}
            <div
              onClick={() => handleLaunch("live")}
              className="panel p-6 rounded-3xl border border-line hover:border-telemetry/50 bg-panel/75 hover:bg-panel2/80 transition-all duration-200 cursor-pointer space-y-4 group flex flex-col justify-between"
            >
              <div className="space-y-4">
                <div className="h-12 w-12 rounded-2xl bg-flame/10 border border-flame/20 flex items-center justify-center text-flame group-hover:scale-110 transition-transform shadow-inner">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2c1 3 2.5 3.5 3.5 4.5A5 5 0 0 1 17 10a5 5 0 1 1-10 0c0-1.6.6-3.1 1.5-3.5 1-1 2.5-1.5 3.5-4.5Z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-ink font-mono">Thermal Fire Fix</h3>
                  <p className="text-xs text-muted leading-relaxed mt-1">
                    MLX90640-D55 32×24 Far-Infrared array cuts through dense smoke and darkness, computing heat centroids at 8 Hz.
                  </p>
                </div>
              </div>
              <div className="text-[11px] font-mono text-telemetry font-semibold flex items-center gap-1 pt-2">
                Launch Live View &rarr;
              </div>
            </div>

            {/* Bento Card 2: Edge RTOS */}
            <div
              onClick={() => handleLaunch("live")}
              className="panel p-6 rounded-3xl border border-line hover:border-telemetry/50 bg-panel/75 hover:bg-panel2/80 transition-all duration-200 cursor-pointer space-y-4 group flex flex-col justify-between"
            >
              <div className="space-y-4">
                <div className="h-12 w-12 rounded-2xl bg-telemetry/10 border border-telemetry/20 flex items-center justify-center text-telemetry group-hover:scale-110 transition-transform shadow-inner">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                    <rect x="9" y="9" width="6" height="6" />
                    <path d="M15 2v2M9 2v2M15 20v2M9 20v2M2 15h2M2 9h2M20 15h2M20 9h2" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-ink font-mono">Dual-Compute Split</h3>
                  <p className="text-xs text-muted leading-relaxed mt-1">
                    ESP32 RTOS manages 20 kHz motor PWM and 500ms safety watchdog, bridged via UART to Raspberry Pi Linux.
                  </p>
                </div>
              </div>
              <div className="text-[11px] font-mono text-telemetry font-semibold flex items-center gap-1 pt-2">
                Inspect Hardware &rarr;
              </div>
            </div>

            {/* Bento Card 3: MuJoCo Physics */}
            <div
              onClick={() => handleLaunch("mujoco")}
              className="panel p-6 rounded-3xl border border-line hover:border-telemetry/50 bg-panel/75 hover:bg-panel2/80 transition-all duration-200 cursor-pointer space-y-4 group flex flex-col justify-between"
            >
              <div className="space-y-4">
                <div className="h-12 w-12 rounded-2xl bg-ok/10 border border-ok/20 flex items-center justify-center text-ok group-hover:scale-110 transition-transform shadow-inner">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 2 7 12 12 22 7 12 2" />
                    <polyline points="2 17 12 22 22 17" />
                    <polyline points="2 12 12 17 22 12" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-ink font-mono">MuJoCo 3D Physics</h3>
                  <p className="text-xs text-muted leading-relaxed mt-1">
                    Rigid-body dynamics simulation modeling 36-beam lidar sweeps, corridor obstacle collisions, and water arc ballistics.
                  </p>
                </div>
              </div>
              <div className="text-[11px] font-mono text-telemetry font-semibold flex items-center gap-1 pt-2">
                Launch 3D Physics &rarr;
              </div>
            </div>

            {/* Bento Card 4: Biometric Voice */}
            <div
              onClick={() => handleLaunch("voice")}
              className="panel p-6 rounded-3xl border border-line hover:border-telemetry/50 bg-panel/75 hover:bg-panel2/80 transition-all duration-200 cursor-pointer space-y-4 group flex flex-col justify-between"
            >
              <div className="space-y-4">
                <div className="h-12 w-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 group-hover:scale-110 transition-transform shadow-inner">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="15" x2="12" y2="22" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-ink font-mono">Voice Biometrics</h3>
                  <p className="text-xs text-muted leading-relaxed mt-1">
                    Offline Vosk speech recognition with enrolled speaker voiceprints ensures only authorized pilots can issue commands.
                  </p>
                </div>
              </div>
              <div className="text-[11px] font-mono text-telemetry font-semibold flex items-center gap-1 pt-2">
                Calibrate Voice &rarr;
              </div>
            </div>
          </div>
        </section>

        {/* LIVE SIMULATED TACTICAL TELEMETRY TERMINAL */}
        <section id="telemetry" className="max-w-7xl mx-auto px-6">
          <div className="panel p-6 sm:p-8 rounded-3xl border border-line bg-panel2/70 backdrop-blur-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-line">
              <div className="flex items-center gap-3">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ok opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-ok"></span>
                </span>
                <div>
                  <h3 className="text-base font-bold font-mono text-ink">
                    Live Telemetry Heartbeat Stream
                  </h3>
                  <p className="text-[11px] font-mono text-faint">
                    10 Hz JSON telemetry packets received over TCP socket
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleLaunch("live")}
                className="px-4 py-2 rounded-xl bg-panel border border-line hover:border-telemetry/40 text-xs font-mono text-ink font-bold flex items-center gap-2 self-start sm:self-auto transition-all"
              >
                <span>Open Full Teleop Console</span>
                <span>&rarr;</span>
              </button>
            </div>

            {/* Terminal Feed Box */}
            <div className="bg-black/80 rounded-2xl p-5 border border-white/10 font-mono text-xs space-y-2 overflow-hidden shadow-inner">
              <div className="flex items-center justify-between text-faint pb-2 border-b border-white/10 text-[10px]">
                <span>STREAM: firebot-1 &bull; 115200 BAUD UART BRIDGE</span>
                <span>STATUS: 200 OK</span>
              </div>
              {simLog.map((line, idx) => (
                <div key={idx} className="flex items-start gap-3 text-muted">
                  <span className="text-telemetry font-bold shrink-0">&gt;</span>
                  <span className={idx === 0 ? "text-ink font-bold" : "text-muted"}>{line}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* HARDWARE ARCHITECTURE & WIRING TABS */}
        <section id="hardware" className="max-w-7xl mx-auto px-6 space-y-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-widest text-telemetry font-semibold">
                HARDWARE ENGINEERING
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-ink font-display tracking-tight mt-1">
                Verified Schematics &amp; Wiring
              </h2>
            </div>
            <a
              href="/FireBot_Hardware_and_Wiring_Specification.pdf"
              download="FireBot_Hardware_and_Wiring_Specification.pdf"
              className="px-5 py-2.5 rounded-xl bg-telemetry/15 hover:bg-telemetry/25 border border-telemetry/40 text-telemetry font-mono text-xs font-bold transition-all flex items-center gap-2 shrink-0 self-start md:self-auto"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Download 14-Page Manual (PDF)</span>
            </a>
          </div>

          <div className="panel p-6 sm:p-8 rounded-3xl border border-line bg-panel/85 space-y-6">
            {/* Tab Buttons */}
            <div className="flex flex-wrap gap-2 pb-4 border-b border-line">
              {Object.keys(HW_TABS).map((tabKey) => (
                <button
                  key={tabKey}
                  onClick={() => {
                    playSound("tab");
                    setActiveHwTab(tabKey);
                  }}
                  className={`px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all border ${
                    activeHwTab === tabKey
                      ? "bg-telemetry/15 border-telemetry text-telemetry shadow-sm"
                      : "bg-panel2 border-line text-muted hover:text-ink hover:border-line2"
                  }`}
                >
                  {HW_TABS[tabKey].title}
                </button>
              ))}
            </div>

            {/* Active Tab Details */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted max-w-2xl font-sans">
                  {HW_TABS[activeHwTab].desc}
                </p>
                <span className="px-2.5 py-1 rounded-lg bg-panel2 border border-line text-[11px] font-mono text-ink font-bold">
                  {HW_TABS[activeHwTab].badge}
                </span>
              </div>

              {/* Pinout Table */}
              <div className="overflow-x-auto rounded-2xl border border-line">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-panel2/90 text-faint text-[10px] uppercase tracking-wider border-b border-line">
                    <tr>
                      <th className="py-3 px-4">Component / Subsystem</th>
                      <th className="py-3 px-4">Connected Pin / Bus</th>
                      <th className="py-3 px-4">Electrical Notes &amp; Protection</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60 bg-panel/60">
                    {HW_TABS[activeHwTab].items.map((row, idx) => (
                      <tr key={idx} className="hover:bg-panel2/40 transition-colors">
                        <td className="py-3 px-4 text-ink font-semibold">{row.name}</td>
                        <td className="py-3 px-4 text-telemetry font-bold">{row.pins}</td>
                        <td className="py-3 px-4 text-muted">{row.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* READY TO LAUNCH FINAL CTA BANNER */}
        <section className="max-w-7xl mx-auto px-6">
          <div className="relative rounded-3xl overflow-hidden border border-telemetry/40 bg-gradient-to-r from-panel2 via-panel to-panel2 p-10 md:p-14 text-center space-y-6 shadow-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-telemetry/15 text-telemetry text-[11px] font-mono uppercase tracking-wider font-bold">
              OPERATIONAL READINESS: 100%
            </div>
            <h3 className="text-3xl md:text-5xl font-extrabold text-ink font-display tracking-tight">
              Ready To Take Tactical Control?
            </h3>
            <p className="text-xs sm:text-sm font-mono text-muted max-w-xl mx-auto leading-relaxed">
              Launch the live command console to monitor real-time thermal matrices, trigger high-pressure suppression, and review emergency sorties.
            </p>
            <div className="pt-2">
              <button
                onClick={() => handleLaunch("live")}
                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-telemetry to-flame text-white font-mono text-sm font-bold shadow-xl shadow-telemetry/30 hover:scale-105 active:scale-95 transition-all inline-flex items-center gap-3"
              >
                <span>ENTER TACTICAL COMMAND CENTRE</span>
                <span className="text-base">&rarr;</span>
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Editorial Designer Footer */}
      <footer className="border-t border-line/60 bg-panel/30 py-10 px-6 text-xs font-mono text-faint">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <span className="text-ink font-bold font-display text-sm">PROJECT FIREBOT</span>
            <span>&bull;</span>
            <span>Tactical Autonomous Fire Suppression Platform</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="https://github.com/darayavahoush/firebot" target="_blank" rel="noreferrer" className="hover:text-ink transition-colors">
              GitHub Source
            </a>
            <a href="/FireBot_Hardware_and_Wiring_Specification.pdf" download="FireBot_Hardware_and_Wiring_Specification.pdf" className="hover:text-ink transition-colors">
              Hardware Spec PDF
            </a>
            <a href="https://firebot-api.onrender.com" target="_blank" rel="noreferrer" className="hover:text-ink transition-colors">
              Render API
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
