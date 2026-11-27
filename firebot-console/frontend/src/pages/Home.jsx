import React, { useState, useEffect } from "react";
import { playSound } from "../lib/sound.js";

// Interactive Rover Hotspots metadata
const HOTSPOTS = [
  {
    id: "flir",
    label: "FLIR Radiometric Thermal Mast",
    tag: "MLX90640-D55",
    x: 48,
    y: 28,
    desc: "32×24 Far-Infrared array (768 pixels). Penetrates zero-visibility particulate smoke and fog to isolate thermal fire centroids at 8 Hz.",
    specs: ["I2C Bus (0x33) @ 400 kHz", "-40°C to 300°C Target Range", "±1.0°C Radiometric Accuracy", "55° × 35° Field of View"],
  },
  {
    id: "turret",
    label: "High-Pressure Water Cannon",
    tag: "12V Diaphragm Nozzle",
    x: 64,
    y: 22,
    desc: "Machined brass suppression nozzle driven by logic-level N-MOSFET (IRLZ44N) and SG90 pan servo swept across a 180° frontal arc.",
    specs: ["4.5 L/min Flow Rate", "180° Continuous Pan Sweep", "1N4007 Diode Kickback Protection", "12V / 3A Switched Inductive Load"],
  },
  {
    id: "tracks",
    label: "High-Traction Tracked Chassis",
    tag: "Differential Drive",
    x: 24,
    y: 74,
    desc: "Heavy-duty steel-reinforced continuous rubber tracks driven by dual geared DC motors with 20 kHz inaudible PWM.",
    specs: ["20 kHz Ultrasonic PWM (No Whine)", "TB6612FNG Dual H-Bridge", "0.60 m/s Maximum Linear Velocity", "220 mm Chassis Track Width"],
  },
  {
    id: "compute",
    label: "Dual-Compute Avionics Core",
    tag: "ESP32 RTOS + Pi 4/5",
    x: 52,
    y: 52,
    desc: "Hard real-time ESP32 microcontroller for 500ms safety watchdog and sensor polling, bridged via high-speed UART to Raspberry Pi 4/5.",
    specs: ["240 MHz Dual-Core Tensilica MCU", "500 ms Hardware Watchdog Cutoff", "115200 Baud Bidirectional Stream", "Isolated Dual Buck Regulators"],
  },
];

// Interactive Hardware Tabs
const HW_TABS = {
  esp32: {
    title: "ESP32 DevKit V1 (Hard Real-Time RTOS)",
    badge: "240 MHz MCU",
    desc: "Dedicated to microsecond-level ultrasonic pulse timing, 20 kHz PWM motor control, 12-bit ADC sampling, and hardware fail-safe watchdog.",
    items: [
      { name: "4x HC-SR04 Ultrasonic", pins: "GPIO 13, 12, 14, 27", note: "Echo via 1kΩ / 2kΩ 3.3V divider" },
      { name: "3x IR Flame Modules", pins: "GPIO 25, 26, 33", note: "Active-LOW optical fire trigger" },
      { name: "2x MQ-2 Smoke/Gas", pins: "GPIO 32, 15 (ADC1)", note: "Continuous 0–3.3V gas density" },
      { name: "Dual DC Motor Drive", pins: "GPIO 18, 19, 21 / 22, 23, 5", note: "20 kHz PWM + Direction IN1-IN4" },
      { name: "12V Diaphragm Pump", pins: "GPIO 17", note: "IRLZ44N MOSFET gate with 10kΩ pull-down" },
      { name: "SG90 Turret Servo", pins: "GPIO 16", note: "50 Hz PWM (-90° to +90° pan sweep)" },
    ],
  },
  pi: {
    title: "Raspberry Pi 4 / 5 (Linux SBC Telemetry Bridge)",
    badge: "Quad-Core ARM SBC",
    desc: "Samples the MLX90640-D55 thermal camera over I2C, runs the client link agent, and streams encrypted telemetry packets over TCP.",
    items: [
      { name: "MLX90640-D55 Thermal", pins: "Pin 3 (SDA), Pin 5 (SCL)", note: "I2C Address 0x33 @ 400kHz Fast-Mode" },
      { name: "Thermal Power & Ground", pins: "Pin 1 (3.3V), Pin 9 (GND)", note: "Filtered 3.3V ASIC supply rail" },
      { name: "ESP32 Serial Link", pins: "USB 2.0 / 3.0 (/dev/ttyUSB0)", note: "115200 Baud line-delimited JSON" },
      { name: "PC Brain Network", pins: "Wi-Fi 802.11ac / GbE", note: "Encrypted TCP socket on port 8765" },
    ],
  },
  power: {
    title: "Isolated Power Distribution Architecture",
    badge: "Dual Buck Isolation",
    desc: "Separates noisy motor and pump inductive loads from sensitive Raspberry Pi logic to eliminate brownout reboots during motor stalls.",
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
    "EIF STATE ESTIMATION: Multi-modal sensor fusion nominal",
    "FLIR MLX90640: Thermal centroid locked at 68.4°C [Bearing: +12°]",
    "RRT* PLANNER: Path verified (24 waypoints, clearance > 0.45m)",
    "ESP32 WATCHDOG: Heartbeat confirmed (latency 12ms)",
  ]);

  const handleLaunch = (target = "live") => {
    playSound("tab");
    onEnterConsole(target);
  };

  useEffect(() => {
    const messages = [
      "EIF FUSION: Flame photodiode vector bearing locked at +12.4°",
      "ULTRASONIC RING: FL: 1.45m | FR: 1.52m | Left: 2.10m | Right: 1.88m",
      "GAS DETECTOR: MQ-2 front reading 0.142 norm (Combustible PPM nominal)",
      "WATER RESERVOIR: Tank level at 88% • Diaphragm pump primed",
      "TURRET SERVO: SG90 pan centered (0.00 rad)",
      "ODOMETRY POSE: Position [X: 1.24m, Y: 0.85m, θ: 18°] • Speed: 0.32 m/s",
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
    <div className="min-h-screen bg-[#0A0D14] text-[#F8FAFC] flex flex-col font-sans selection:bg-sky-500/30 selection:text-white relative overflow-x-hidden">
      {/* Subtle Technical Grid Overlay */}
      <div className="fixed inset-0 pointer-events-none z-0 opacity-25">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px]" />
      </div>

      {/* Engineering Header Navigation Bar */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-[#0A0D14]/90 border-b border-white/[0.08]">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          {/* Logo & Platform Name */}
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-red-600 flex items-center justify-center text-white shadow-md shadow-red-950/40 shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
              </svg>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="font-display font-extrabold text-base tracking-wider text-white">
                FIREBOT
              </span>
              <span className="h-3 w-px bg-white/20" />
              <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400 font-semibold">
                Autonomous Robotics v2.5
              </span>
            </div>
          </div>

          {/* Clean Navigation Links */}
          <nav className="hidden md:flex items-center gap-7 text-xs font-mono text-slate-400 tracking-wider uppercase">
            <a href="#overview" className="hover:text-white transition-colors">Vessel Overview</a>
            <a href="#hologram" className="hover:text-white transition-colors">Subsystems</a>
            <a href="#features" className="hover:text-white transition-colors">Architecture</a>
            <a href="#hardware" className="hover:text-white transition-colors">Hardware &amp; Wiring</a>
          </nav>

          {/* Header Action Buttons */}
          <div className="flex items-center gap-3">
            <a
              href="/FireBot_Hardware_and_Wiring_Specification.pdf"
              download="FireBot_Hardware_and_Wiring_Specification.pdf"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#161F2E] hover:bg-[#1E293B] border border-white/10 text-xs font-mono text-slate-300 hover:text-white transition-all"
              title="Download 14-page Hardware & Wiring PDF"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Spec PDF (14p)</span>
            </a>

            <button
              onClick={() => handleLaunch("live")}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-mono text-xs font-bold shadow-md shadow-red-950/50 hover:shadow-red-700/40 transition-all flex items-center gap-2"
            >
              <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
              <span>COMMAND CONSOLE &rarr;</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Sections */}
      <main className="flex-1 space-y-28 py-12 md:py-16 relative z-10">
        {/* HERO SECTION */}
        <section id="overview" className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-12 items-center">
            {/* Left Narrative */}
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-[#161F2E] border border-white/10 text-[11px] font-mono text-slate-300 tracking-wide uppercase">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span>Autonomous Tactical Defense &bull; First Responder Rover</span>
              </div>

              <div className="space-y-3">
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight leading-[1.08] font-display">
                  Autonomous <br />
                  Fire Suppression. <br />
                  <span className="text-red-500">
                    Engineered For High-Risk Hazard Response.
                  </span>
                </h1>
                <p className="text-slate-400 text-sm sm:text-base leading-relaxed max-w-xl font-sans">
                  Deploying hard real-time edge processing (ESP32 RTOS + Raspberry Pi 4/5 SBC),
                  MLX90640 radiometric thermal IR tracking, RRT* dynamic path planning, and fail-safe voice control.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-3.5 pt-1">
                <button
                  onClick={() => handleLaunch("live")}
                  className="px-7 py-3.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-mono text-xs font-bold tracking-wider shadow-lg shadow-red-950/60 hover:shadow-red-700/50 transition-all flex items-center gap-2.5 uppercase"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="2" />
                    <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
                  </svg>
                  <span>Launch Operations Console</span>
                  <span>&rarr;</span>
                </button>

                <button
                  onClick={() => handleLaunch("mujoco")}
                  className="px-6 py-3.5 rounded-xl bg-[#161F2E] hover:bg-[#1E293B] border border-white/10 text-white font-mono text-xs font-medium transition-all flex items-center gap-2"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400">
                    <path d="m21 16-9 5-9-5V8l9-5 9 5v8z" />
                    <path d="m3.27 6.96 8.73 4.85 8.73-4.85M12 22V12" />
                  </svg>
                  <span>3D MuJoCo Physics Sim</span>
                </button>

                <a
                  href="/FireBot_Hardware_and_Wiring_Specification.pdf"
                  download="FireBot_Hardware_and_Wiring_Specification.pdf"
                  className="px-4 py-3.5 rounded-xl bg-transparent hover:bg-white/5 border border-white/10 text-slate-400 hover:text-white font-mono text-xs font-medium transition-all flex items-center gap-1.5"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span>Wiring Spec</span>
                </a>
              </div>

              {/* Technical Benchmarks */}
              <div className="grid grid-cols-3 gap-4 pt-5 border-t border-white/[0.08]">
                <div className="space-y-0.5">
                  <div className="text-2xl font-bold font-mono text-white">32×24</div>
                  <div className="text-[11px] font-mono text-slate-400">FLIR Thermal Array</div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-2xl font-bold font-mono text-sky-400">&lt; 120 ms</div>
                  <div className="text-[11px] font-mono text-slate-400">Decision Latency</div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-2xl font-bold font-mono text-orange-400">4.5 L/min</div>
                  <div className="text-[11px] font-mono text-slate-400">Suppression Cannon</div>
                </div>
              </div>
            </div>

            {/* Right Hero Image */}
            <div className="relative group">
              <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-[#111622]">
                <img
                  src="/firebot-hero.jpg"
                  alt="FireBot Autonomous Tactical Firefighting Rover"
                  className="w-full h-auto object-cover transform group-hover:scale-[1.02] transition-transform duration-500 ease-out"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0A0D14] via-transparent to-transparent opacity-80 pointer-events-none" />

                {/* Tactical Status Tag */}
                <div className="absolute top-4 left-4 bg-[#0A0D14]/85 backdrop-blur-md border border-white/10 px-3 py-1 rounded-md text-[11px] font-mono text-white flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>UNIT: firebot-1 &bull; READY</span>
                </div>

                {/* Bottom HUD Bar */}
                <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-[11px] font-mono text-slate-200">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-sky-900/60 border border-sky-400/40 text-sky-200 font-bold">
                      FLIR LOCK
                    </span>
                    <span className="text-slate-300">CENTROID [68.4°C]</span>
                  </div>
                  <span className="text-slate-400">ESP32 RTOS 240MHz</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* INTERACTIVE ROVER ANATOMY & SUBSYSTEM EXPLORER */}
        <section id="hologram" className="max-w-7xl mx-auto px-6 space-y-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-widest text-sky-400 font-semibold">
                ANATOMY &amp; MECHANICAL BLUEPRINT
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white font-display tracking-tight mt-1">
                Explore The Physical Subsystems
              </h2>
            </div>
            <p className="text-xs font-mono text-slate-400 max-w-sm">
              Select any component to inspect physical pinouts, power ratings, and fail-safe specs.
            </p>
          </div>

          <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-8 items-start">
            {/* Visual Interactive Map */}
            <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-[#111622] p-4 shadow-xl">
              <div className="relative rounded-xl overflow-hidden bg-black">
                <img
                  src="/firebot-rover-detail.jpg"
                  alt="FireBot Hardware Anatomy"
                  className="w-full h-auto object-cover opacity-90"
                />

                {/* Radar Hotspots */}
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
                        activeSpot.id === spot.id ? "bg-sky-400" : "bg-white"
                      }`}></span>
                      <span className={`relative inline-flex rounded-full h-5 w-5 border-2 border-white/80 shadow-md ${
                        activeSpot.id === spot.id ? "bg-sky-500" : "bg-slate-800"
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
                    className={`px-3 py-2 rounded-lg text-[11px] font-mono text-left transition-all border ${
                      activeSpot.id === spot.id
                        ? "bg-sky-500/15 border-sky-400/50 text-sky-400 font-bold"
                        : "bg-[#161F2E] border-white/[0.08] text-slate-400 hover:text-white"
                    }`}
                  >
                    {spot.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Active Component Specification Card */}
            <div className="p-7 rounded-2xl border border-white/10 bg-[#111622] space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-white/[0.08]">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-sky-400 font-semibold">
                    COMPONENT SPECIFICATION
                  </span>
                  <h3 className="text-xl font-bold font-display text-white mt-0.5">
                    {activeSpot.label}
                  </h3>
                </div>
                <span className="px-2.5 py-1 rounded-md bg-[#161F2E] border border-white/10 text-[11px] font-mono text-slate-200 font-bold">
                  {activeSpot.tag}
                </span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed font-sans">
                {activeSpot.desc}
              </p>

              <div className="space-y-2.5 pt-2">
                <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500 font-semibold">
                  TECHNICAL CHARACTERISTICS
                </span>
                <div className="space-y-2">
                  {activeSpot.specs.map((spec, i) => (
                    <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-lg bg-[#161F2E] border border-white/[0.06] text-xs font-mono text-slate-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                      <span>{spec}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Direct Link to View in Command Console */}
              <div className="pt-4 border-t border-white/[0.08]">
                <button
                  onClick={() => handleLaunch("live")}
                  className="w-full py-2.5 rounded-lg bg-[#161F2E] hover:bg-[#1E293B] border border-white/10 hover:border-sky-400/40 text-slate-200 hover:text-white font-mono text-xs font-semibold flex items-center justify-center gap-2 transition-all"
                >
                  <span>Open In Tactical Teleop Deck</span>
                  <span>&rarr;</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 4 CORE AUTONOMY PILLARS (ENGINEERING GRID) */}
        <section id="features" className="max-w-7xl mx-auto px-6 space-y-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-widest text-sky-400 font-semibold">
                TECHNOLOGY MATRIX
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white font-display tracking-tight mt-1">
                Engineered For Mission Autonomy
              </h2>
            </div>
            <span className="text-[11px] font-mono text-slate-400">4 INTEGRATED ROBOTIC SUBSYSTEMS</span>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Bento Card 1: Thermal FLIR */}
            <div
              onClick={() => handleLaunch("live")}
              className="p-6 rounded-2xl border border-white/10 hover:border-sky-400/40 bg-[#111622] hover:bg-[#161F2E] transition-all duration-200 cursor-pointer space-y-4 group flex flex-col justify-between"
            >
              <div className="space-y-4">
                <div className="h-11 w-11 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400 group-hover:scale-105 transition-transform">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2c1 3 2.5 3.5 3.5 4.5A5 5 0 0 1 17 10a5 5 0 1 1-10 0c0-1.6.6-3.1 1.5-3.5 1-1 2.5-1.5 3.5-4.5Z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-white font-mono">Thermal Fire Fix</h3>
                  <p className="text-xs text-slate-400 leading-relaxed mt-1">
                    MLX90640-D55 32×24 Far-Infrared array cuts through dense smoke and darkness, computing heat centroids at 8 Hz.
                  </p>
                </div>
              </div>
              <div className="text-[11px] font-mono text-sky-400 font-semibold flex items-center gap-1 pt-2">
                Launch Live View &rarr;
              </div>
            </div>

            {/* Bento Card 2: Edge RTOS */}
            <div
              onClick={() => handleLaunch("live")}
              className="p-6 rounded-2xl border border-white/10 hover:border-sky-400/40 bg-[#111622] hover:bg-[#161F2E] transition-all duration-200 cursor-pointer space-y-4 group flex flex-col justify-between"
            >
              <div className="space-y-4">
                <div className="h-11 w-11 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 group-hover:scale-105 transition-transform">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                    <rect x="9" y="9" width="6" height="6" />
                    <path d="M15 2v2M9 2v2M15 20v2M9 20v2M2 15h2M2 9h2M20 15h2M20 9h2" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-white font-mono">Dual-Compute Split</h3>
                  <p className="text-xs text-slate-400 leading-relaxed mt-1">
                    ESP32 RTOS manages 20 kHz motor PWM and 500ms safety watchdog, bridged via UART to Raspberry Pi Linux.
                  </p>
                </div>
              </div>
              <div className="text-[11px] font-mono text-sky-400 font-semibold flex items-center gap-1 pt-2">
                Inspect Hardware &rarr;
              </div>
            </div>

            {/* Bento Card 3: MuJoCo Physics */}
            <div
              onClick={() => handleLaunch("mujoco")}
              className="p-6 rounded-2xl border border-white/10 hover:border-sky-400/40 bg-[#111622] hover:bg-[#161F2E] transition-all duration-200 cursor-pointer space-y-4 group flex flex-col justify-between"
            >
              <div className="space-y-4">
                <div className="h-11 w-11 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 2 7 12 12 22 7 12 2" />
                    <polyline points="2 17 12 22 22 17" />
                    <polyline points="2 12 12 17 22 12" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-white font-mono">MuJoCo 3D Physics</h3>
                  <p className="text-xs text-slate-400 leading-relaxed mt-1">
                    Rigid-body dynamics simulation modeling 36-beam lidar sweeps, corridor obstacle collisions, and water arc ballistics.
                  </p>
                </div>
              </div>
              <div className="text-[11px] font-mono text-sky-400 font-semibold flex items-center gap-1 pt-2">
                Launch 3D Physics &rarr;
              </div>
            </div>

            {/* Bento Card 4: Biometric Voice */}
            <div
              onClick={() => handleLaunch("voice")}
              className="p-6 rounded-2xl border border-white/10 hover:border-sky-400/40 bg-[#111622] hover:bg-[#161F2E] transition-all duration-200 cursor-pointer space-y-4 group flex flex-col justify-between"
            >
              <div className="space-y-4">
                <div className="h-11 w-11 rounded-lg bg-slate-700/30 border border-white/10 flex items-center justify-center text-slate-300 group-hover:scale-105 transition-transform">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="15" x2="12" y2="22" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-white font-mono">Voice Biometrics</h3>
                  <p className="text-xs text-slate-400 leading-relaxed mt-1">
                    Offline Vosk speech recognition with enrolled speaker voiceprints ensures only authorized pilots can issue commands.
                  </p>
                </div>
              </div>
              <div className="text-[11px] font-mono text-sky-400 font-semibold flex items-center gap-1 pt-2">
                Calibrate Voice &rarr;
              </div>
            </div>
          </div>
        </section>

        {/* LIVE SIMULATED TACTICAL TELEMETRY TERMINAL */}
        <section id="telemetry" className="max-w-7xl mx-auto px-6">
          <div className="p-6 sm:p-8 rounded-2xl border border-white/10 bg-[#111622] space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
              <div className="flex items-center gap-3">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
                </span>
                <div>
                  <h3 className="text-base font-bold font-mono text-white">
                    Live Telemetry Heartbeat Stream
                  </h3>
                  <p className="text-[11px] font-mono text-slate-400">
                    10 Hz JSON telemetry packets received over TCP socket
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleLaunch("live")}
                className="px-4 py-2 rounded-lg bg-[#161F2E] border border-white/10 hover:border-sky-400/40 text-xs font-mono text-white font-semibold flex items-center gap-2 self-start sm:self-auto transition-all"
              >
                <span>Open Full Teleop Console</span>
                <span>&rarr;</span>
              </button>
            </div>

            {/* Terminal Feed Box */}
            <div className="bg-[#0A0D14] rounded-xl p-4 sm:p-5 border border-white/[0.08] font-mono text-xs space-y-2 overflow-hidden">
              <div className="flex items-center justify-between text-slate-500 pb-2 border-b border-white/[0.06] text-[10px]">
                <span>STREAM: firebot-1 &bull; 115200 BAUD UART BRIDGE</span>
                <span className="text-emerald-400 font-bold">STATUS: 200 OK</span>
              </div>
              {simLog.map((line, idx) => (
                <div key={idx} className="flex items-start gap-3 text-slate-300">
                  <span className="text-sky-400 font-bold shrink-0">&gt;</span>
                  <span className={idx === 0 ? "text-white font-semibold" : "text-slate-400"}>{line}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* HARDWARE ARCHITECTURE & WIRING TABS */}
        <section id="hardware" className="max-w-7xl mx-auto px-6 space-y-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-widest text-sky-400 font-semibold">
                HARDWARE ENGINEERING
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white font-display tracking-tight mt-1">
                Verified Schematics &amp; Wiring
              </h2>
            </div>
            <a
              href="/FireBot_Hardware_and_Wiring_Specification.pdf"
              download="FireBot_Hardware_and_Wiring_Specification.pdf"
              className="px-4 py-2 rounded-lg bg-[#161F2E] hover:bg-[#1E293B] border border-white/10 text-white font-mono text-xs font-semibold transition-all flex items-center gap-2 shrink-0 self-start md:self-auto"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Download 14-Page Manual (PDF)</span>
            </a>
          </div>

          <div className="p-6 sm:p-8 rounded-2xl border border-white/10 bg-[#111622] space-y-6">
            {/* Tab Buttons */}
            <div className="flex flex-wrap gap-2 pb-4 border-b border-white/[0.08]">
              {Object.keys(HW_TABS).map((tabKey) => (
                <button
                  key={tabKey}
                  onClick={() => {
                    playSound("tab");
                    setActiveHwTab(tabKey);
                  }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all border ${
                    activeHwTab === tabKey
                      ? "bg-sky-500/15 border-sky-400/50 text-sky-400"
                      : "bg-[#161F2E] border-white/[0.08] text-slate-400 hover:text-white"
                  }`}
                >
                  {HW_TABS[tabKey].title}
                </button>
              ))}
            </div>

            {/* Active Tab Details */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-300 max-w-2xl font-sans">
                  {HW_TABS[activeHwTab].desc}
                </p>
                <span className="px-2.5 py-1 rounded-md bg-[#161F2E] border border-white/10 text-[11px] font-mono text-slate-200 font-bold">
                  {HW_TABS[activeHwTab].badge}
                </span>
              </div>

              {/* Pinout Table */}
              <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-[#161F2E] text-slate-400 text-[10px] uppercase tracking-wider border-b border-white/[0.08]">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">Component / Subsystem</th>
                      <th className="py-2.5 px-4 font-semibold">Connected Pin / Bus</th>
                      <th className="py-2.5 px-4 font-semibold">Electrical Notes &amp; Protection</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06] bg-[#0A0D14]/70">
                    {HW_TABS[activeHwTab].items.map((row, idx) => (
                      <tr key={idx} className="hover:bg-[#161F2E]/40 transition-colors">
                        <td className="py-2.5 px-4 text-white font-medium">{row.name}</td>
                        <td className="py-2.5 px-4 text-sky-400 font-bold">{row.pins}</td>
                        <td className="py-2.5 px-4 text-slate-400">{row.note}</td>
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
          <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-[#111622] p-8 md:p-12 text-center space-y-5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-[#161F2E] border border-white/10 text-emerald-400 text-[11px] font-mono uppercase tracking-wider font-semibold">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              OPERATIONAL READINESS: 100% NOMINAL
            </div>
            <h3 className="text-2xl md:text-4xl font-extrabold text-white font-display tracking-tight">
              Ready To Deploy FireBot?
            </h3>
            <p className="text-xs sm:text-sm font-mono text-slate-400 max-w-xl mx-auto leading-relaxed">
              Launch the live command console to monitor real-time thermal matrices, trigger high-pressure suppression, and review emergency sorties.
            </p>
            <div className="pt-2">
              <button
                onClick={() => handleLaunch("live")}
                className="px-8 py-3.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-mono text-xs font-bold tracking-wider shadow-lg shadow-red-950/60 hover:shadow-red-700/50 transition-all inline-flex items-center gap-2.5 uppercase"
              >
                <span>ENTER TACTICAL COMMAND CENTRE</span>
                <span>&rarr;</span>
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Engineering Footer */}
      <footer className="border-t border-white/[0.08] bg-[#0A0D14] py-8 px-6 text-xs font-mono text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="text-white font-bold font-display">FIREBOT</span>
            <span>&bull;</span>
            <span>Autonomous Emergency Response Robotics Platform</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="https://github.com/darayavahoush/firebot" target="_blank" rel="noreferrer" className="hover:text-white transition-colors">
              GitHub Source
            </a>
            <a href="/FireBot_Hardware_and_Wiring_Specification.pdf" download="FireBot_Hardware_and_Wiring_Specification.pdf" className="hover:text-white transition-colors">
              Hardware Spec PDF
            </a>
            <a href="https://firebot-api.onrender.com" target="_blank" rel="noreferrer" className="hover:text-white transition-colors">
              Render API Link
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
