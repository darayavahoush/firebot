import React, { useState, useEffect, useRef } from "react";
import { playSound } from "../lib/sound.js";

const CW = 640, CH = 480;
const ROWS = 24, COLS = 32;

const PALETTES = {
  ironbow: {
    label: "Ironbow",
    stops: [
      [0, [14, 8, 32]],
      [0.25, [90, 26, 134]],
      [0.5, [196, 40, 111]],
      [0.75, [255, 138, 42]],
      [1, [255, 242, 201]],
    ],
  },
  inferno: {
    label: "Inferno",
    stops: [
      [0, [10, 5, 25]],
      [0.3, [120, 28, 129]],
      [0.6, [217, 72, 38]],
      [0.85, [248, 168, 48]],
      [1, [252, 255, 164]],
    ],
  },
  arctic: {
    label: "Arctic",
    stops: [
      [0, [6, 14, 30]],
      [0.35, [14, 80, 140]],
      [0.7, [38, 200, 220]],
      [0.9, [140, 245, 255]],
      [1, [255, 255, 255]],
    ],
  },
  nvg: {
    label: "NVG",
    stops: [
      [0, [2, 18, 8]],
      [0.3, [12, 60, 24]],
      [0.6, [40, 180, 70]],
      [0.85, [110, 245, 140]],
      [1, [230, 255, 235]],
    ],
  },
};

function colorFor(t, stops) {
  const v = Math.max(0, Math.min(1, (t - 22) / 48));
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i];
      const f = (v - a) / (b - a || 1);
      return ca.map((c, k) => Math.round(c + (cb[k] - c) * f));
    }
  }
  return stops[stops.length - 1][1];
}

const SUBSYSTEMS = [
  {
    id: "flir",
    name: "FLIR MLX90640-D55 Thermal Mast",
    role: "Target Acquisition & Smoke Penetration",
    bus: "I2C 0x33 @ 400 kHz",
    power: "3.3V Filtered Rail • 23 mA",
    specs: [
      "32×24 Radiometric pixel array (768 total cells)",
      "Target dynamic range: -40°C to +300°C (±1.0°C accuracy)",
      "55° × 35° Field of View aligned to turret pan bore",
      "Thermal plume centroid lock-on latency: <125 ms",
    ],
    pinout: [
      { pin: "Pin 1 (3.3V)", target: "Raspberry Pi 3.3V Rail" },
      { pin: "Pin 3 (SDA)", target: "BCM GPIO 2 (I2C1 SDA)" },
      { pin: "Pin 5 (SCL)", target: "BCM GPIO 3 (I2C1 SCL)" },
      { pin: "Pin 9 (GND)", target: "Star Ground Reference" },
    ],
  },
  {
    id: "esp32",
    name: "ESP32 DevKit V1 Hard Real-Time Core",
    role: "500ms Watchdog & Actuator Dispatch",
    bus: "UART 115200 Baud /dev/ttyUSB0",
    power: "5.0V / 3A Buck Regulated",
    specs: [
      "Dual-Core Xtensa LX6 @ 240 MHz (Dedicated FreeRTOS Tasks)",
      "20 kHz Ultrasonic motor PWM (Zero audible coil whine)",
      "Microsecond-level HC-SR04 pulse duration timing",
      "Hardware fail-safe cutoff: Motors & pump halt on 500ms silence",
    ],
    pinout: [
      { pin: "GPIO 13, 12, 14, 27", target: "HC-SR04 Ultrasonic Trigger/Echo" },
      { pin: "GPIO 25, 26, 33", target: "3× IR Photodiode Flame Sensors" },
      { pin: "GPIO 32, 15", target: "2× MQ-2 Combustible Gas ADC1" },
      { pin: "GPIO 18, 19, 21, 22, 23, 5", target: "TB6612FNG Dual H-Bridge Motor Logic" },
      { pin: "GPIO 17", target: "IRLZ44N MOSFET Water Pump Gate" },
      { pin: "GPIO 16", target: "SG90 Turret Pan Servo (50 Hz PWM)" },
    ],
  },
  {
    id: "cannon",
    name: "High-Pressure Water Suppression Turret",
    role: "Autonomous Hazard Neutralization",
    bus: "Logic-Level N-Channel MOSFET (IRLZ44N)",
    power: "12V Direct LiPo • 3.2A Switched Load",
    specs: [
      "Diaphragm delivery: 4.5 L/min @ 4.2 Bar hydraulic pressure",
      "SG90 Servo pan arc: -90° to +90° (180° frontal azimuth)",
      "Flyback protection: 1N4007 Schottky diode across inductive pump leads",
      "Gate isolation: 10 kΩ pull-down resistor prevents floating turn-on",
    ],
    pinout: [
      { pin: "Gate (G)", target: "ESP32 GPIO 17 via 220Ω resistor" },
      { pin: "Drain (D)", target: "12V Pump Negative Terminal" },
      { pin: "Source (S)", target: "Common System Ground Rail" },
      { pin: "Diode Cathode", target: "Pump Positive Terminal (+12V LiPo)" },
    ],
  },
  {
    id: "chassis",
    name: "Tracked Continuous Differential Chassis",
    role: "Obstacle Crossing & All-Terrain Mobility",
    bus: "TB6612FNG Dual H-Bridge Driver",
    power: "12V Motor Rail • 1.2A Continuous / 3.2A Stall",
    specs: [
      "Steel-reinforced rubber tracks with 220 mm chassis span",
      "Max linear velocity: 0.60 m/s with closed-loop PID ramp",
      "Turning capability: Zero-radius in-place differential rotation",
      "Thermal dissipation: Aluminum chassis-heatsink mounting",
    ],
    pinout: [
      { pin: "VM / VCC", target: "+12V LiPo Rail / 5V Logic Rail" },
      { pin: "PWMA / PWMB", target: "ESP32 GPIO 18 & 23 (20 kHz PWM)" },
      { pin: "AIN1 / AIN2", target: "ESP32 GPIO 19 & 21 (Left Track)" },
      { pin: "BIN1 / BIN2", target: "ESP32 GPIO 22 & 5 (Right Track)" },
    ],
  },
  {
    id: "power",
    name: "Dual-Buck Isolated Power Distribution",
    role: "Brownout Prevention & Noise Immunity",
    bus: "Star Ground Bus Architecture",
    power: "12.6V 3S LiPo Primary Rail",
    specs: [
      "Primary Rail: 12V direct to Motor H-Bridge and Water Cannon",
      "Buck #1 (5V 3A): Powers ESP32, SG90 servo, and analog sensors",
      "Buck #2 (5V 4A): Isolated rail dedicated strictly to Raspberry Pi",
      "Star Ground Topology: Prevents motor inductive spikes from resetting MCU",
    ],
    pinout: [
      { pin: "Main In", target: "12V 3S LiPo (15A Fuse inline)" },
      { pin: "Buck 1 Out", target: "5.0V Logic & Actuator Bus" },
      { pin: "Buck 2 Out", target: "5.1V Raspberry Pi Type-C Input" },
      { pin: "GND Star", target: "Central Grounding Post" },
    ],
  },
];

export default function Home({ onEnterConsole, frame, linkOk }) {
  const [feedMode, setFeedMode] = useState("optical"); // "optical" | "thermal" | "blueprint"
  const [paletteKey, setPaletteKey] = useState("ironbow");
  const [activeSubsystem, setActiveSubsystem] = useState(SUBSYSTEMS[0]);
  const [utcTime, setUtcTime] = useState("");
  const canvasRef = useRef(null);

  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      setUtcTime(d.toISOString().substring(11, 19) + " UTC");
    };
    updateTime();
    const t = setInterval(updateTime, 1000);
    return () => clearInterval(t);
  }, []);

  // Keyboard shortcut listener for mission-critical actions
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "l" || e.key === "L") {
        playSound("tab");
        onEnterConsole("live");
      } else if (e.key === "m" || e.key === "M") {
        playSound("tab");
        onEnterConsole("mujoco");
      } else if (e.key === "s" || e.key === "S") {
        playSound("tab");
        onEnterConsole("sim");
      } else if (e.key === "v" || e.key === "V") {
        playSound("tab");
        onEnterConsole("voice");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onEnterConsole]);

  // Radiometric Thermal Canvas Loop when in "thermal" mode
  useEffect(() => {
    if (feedMode !== "thermal") return;
    const cv = canvasRef.current;
    if (!cv) return;
    const g = cv.getContext("2d");
    let animId;
    let t = 0;

    const currentPalette = PALETTES[paletteKey] || PALETTES.ironbow;

    const renderThermal = () => {
      t += 0.04;
      g.fillStyle = "#0A0D14";
      g.fillRect(0, 0, CW, CH);

      const off = document.createElement("canvas");
      off.width = COLS;
      off.height = ROWS;
      const og = off.getContext("2d");
      const img = og.createImageData(COLS, ROWS);

      // Simulated hotspot centered near middle
      const hotC = 16.0 + Math.sin(t * 0.8) * 1.5;
      const hotR = 11.5 + Math.cos(t * 0.6) * 0.8;

      let peakVal = -Infinity;
      let peakIdx = 0;

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const idx = r * COLS + c;
          const dx = c - hotC;
          const dy = r - hotR;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const noise = Math.sin(r * 12.9898 + c * 78.233 + t) * 0.4;
          const temp = 22.4 + (r / ROWS) * 1.4 + Math.max(0, 48.0 - dist * 4.2) + noise;

          if (temp > peakVal) {
            peakVal = temp;
            peakIdx = idx;
          }

          const [red, grn, blu] = colorFor(temp, currentPalette.stops);
          img.data.set([red, grn, blu, 255], idx * 4);
        }
      }

      og.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      g.drawImage(off, 0, 0, CW, CH);

      // Target reticle lock
      const px = (((peakIdx % COLS) + 0.5) / COLS) * CW;
      const py = ((Math.floor(peakIdx / COLS) + 0.5) / ROWS) * CH;

      g.strokeStyle = "#FF4A2B";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(px, py, 22, 0, Math.PI * 2);
      g.stroke();

      g.beginPath();
      g.moveTo(px - 32, py); g.lineTo(px - 10, py);
      g.moveTo(px + 10, py); g.lineTo(px + 32, py);
      g.moveTo(px, py - 32); g.lineTo(px, py - 10);
      g.moveTo(px, py + 10); g.lineTo(px, py + 32);
      g.stroke();

      animId = requestAnimationFrame(renderThermal);
    };

    renderThermal();
    return () => cancelAnimationFrame(animId);
  }, [feedMode, paletteKey]);

  return (
    <div className="min-h-screen bg-[#07090E] text-[#E2E8F0] font-mono selection:bg-sky-500/30 selection:text-white flex flex-col relative overflow-x-hidden">
      {/* Background Engineering Hairline Grid */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.035] bg-[radial-gradient(#94a3b8_1px,transparent_1px)] [background-size:24px_24px]" />

      {/* TOP SYSTEM MANIFEST BAR */}
      <header className="border-b border-white/[0.08] bg-[#0A0D14]/95 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          {/* Platform Identity */}
          <div className="flex items-center gap-3">
            <div className="h-6 w-6 rounded bg-red-600 flex items-center justify-center text-white font-bold text-xs shadow-sm">
              F
            </div>
            <div className="flex items-center gap-2">
              <span className="font-display font-black text-sm tracking-widest text-white">
                FIREBOT
              </span>
              <span className="text-[10px] text-slate-500">//</span>
              <span className="text-[10px] text-slate-400 font-semibold tracking-wider">
                TACTICAL DEFENSE ROVER
              </span>
            </div>
          </div>

          {/* Center Navigation Bar */}
          <nav className="hidden lg:flex items-center gap-1 bg-slate-900/90 p-1 rounded-xl border border-white/10 text-[11px] font-mono">
            <button
              className="px-3 py-1 rounded-lg bg-sky-500/20 text-sky-400 font-bold border border-sky-500/30 shadow-sm"
              disabled
            >
              Overview Deck
            </button>
            <button
              onClick={() => { playSound("tab"); onEnterConsole("live"); }}
              className="px-3 py-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Tactical Console [L]
            </button>
            <button
              onClick={() => { playSound("tab"); onEnterConsole("sim"); }}
              className="px-3 py-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            >
              2D Sim [S]
            </button>
            <button
              onClick={() => { playSound("tab"); onEnterConsole("mujoco"); }}
              className="px-3 py-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            >
              MuJoCo 3D [M]
            </button>
            <button
              onClick={() => { playSound("tab"); onEnterConsole("voice"); }}
              className="px-3 py-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Voice Studio [V]
            </button>
            <button
              onClick={() => { playSound("tab"); onEnterConsole("history"); }}
              className="px-3 py-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Sortie Logs
            </button>
          </nav>

          {/* Right Clock & Direct Action Links */}
          <div className="flex items-center gap-2.5">
            <span className="text-[11px] text-slate-400 hidden xl:inline tabular-nums">
              {utcTime || "00:00:00 UTC"}
            </span>

            <a
              href="/FireBot_Hardware_and_Wiring_Specification.pdf"
              download="FireBot_Hardware_and_Wiring_Specification.pdf"
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-white/10 text-[11px] text-slate-300 hover:text-white transition-colors flex items-center gap-1.5"
            >
              <span>Hardware Spec (PDF)</span>
            </a>

            <button
              onClick={() => {
                playSound("tab");
                onEnterConsole("live");
              }}
              className="px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-sm flex items-center gap-1.5"
            >
              <span>Enter Console [L]</span>
              <span>→</span>
            </button>
          </div>
        </div>
      </header>

      {/* MAIN COCKPIT & FLIGHT DECK */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-8 space-y-12 relative z-10">
        {/* HERO SECTION: LIVE AVIONICS CONSOLE VIEWPORT */}
        <section className="space-y-4">
          {/* Subheader Title */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-2 border-b border-white/[0.08]">
            <div>
              <div className="flex items-center gap-2 text-[10px] text-sky-400 font-bold uppercase tracking-widest">
                <span>AVIONICS TELEMETRY DECK</span>
                <span className="text-slate-600">•</span>
                <span>VESSEL FB-01</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight font-display mt-0.5">
                Autonomous Hazardous Fire Suppression Platform
              </h1>
            </div>

            {/* Quick Keyboard Hotkeys Prompt */}
            <div className="text-[10px] text-slate-400 flex items-center gap-3 shrink-0">
              <span>Hotkeys:</span>
              <span className="bg-slate-900 border border-white/10 px-1.5 py-0.5 rounded text-white">[L] Live Ops</span>
              <span className="bg-slate-900 border border-white/10 px-1.5 py-0.5 rounded text-white">[M] 3D MuJoCo</span>
              <span className="bg-slate-900 border border-white/10 px-1.5 py-0.5 rounded text-white">[S] Simulator</span>
            </div>
          </div>

          {/* Main Visual Display & Telemetry Columns */}
          <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">
            {/* Center Stage: Viewport */}
            <div className="rounded-xl border border-white/[0.12] bg-[#0A0D14] p-3 shadow-2xl relative overflow-hidden flex flex-col gap-3">
              {/* Corner Registration Hairlines */}
              <div className="absolute top-1 left-1 text-[9px] text-slate-600 pointer-events-none select-none">┌</div>
              <div className="absolute top-1 right-1 text-[9px] text-slate-600 pointer-events-none select-none">┐</div>
              <div className="absolute bottom-1 left-1 text-[9px] text-slate-600 pointer-events-none select-none">└</div>
              <div className="absolute bottom-1 right-1 text-[9px] text-slate-600 pointer-events-none select-none">┘</div>

              {/* Viewport Mode Switcher & Indicators */}
              <div className="flex items-center justify-between gap-2 flex-wrap pb-1 border-b border-white/[0.06]">
                <div className="flex items-center gap-1.5">
                  {[
                    { id: "optical", label: "CAM-01 OPTICAL STREAM" },
                    { id: "thermal", label: "FLIR MLX90640 THERMAL IR" },
                    { id: "blueprint", label: "MECHANICAL BLUEPRINT" },
                  ].map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        playSound("tab");
                        setFeedMode(m.id);
                      }}
                      className={`px-3 py-1 rounded text-[11px] font-mono tracking-wider transition-all cursor-pointer ${
                        feedMode === m.id
                          ? "bg-sky-500/20 text-sky-400 border border-sky-400/50 font-bold shadow-sm"
                          : "text-slate-400 hover:text-white bg-slate-900/60 border border-white/[0.06]"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {feedMode === "thermal" && (
                  <div className="flex items-center gap-1">
                    {Object.entries(PALETTES).map(([k, v]) => (
                      <button
                        key={k}
                        onClick={() => {
                          playSound("click");
                          setPaletteKey(k);
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                          paletteKey === k
                            ? "bg-white text-black font-bold"
                            : "text-slate-400 hover:text-white"
                        }`}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Viewport Frame */}
              <div
                className="relative rounded-lg overflow-hidden border border-white/[0.08] bg-black"
                style={{ aspectRatio: "16 / 9" }}
              >
                {/* 1. Optical Video Mode */}
                {feedMode === "optical" && (
                  <div className="relative w-full h-full">
                    <video
                      autoPlay
                      loop
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                      src="/footage.mp4"
                    />

                    {/* HUD Target Overlay */}
                    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4 font-mono text-[11px] text-white/90">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 bg-black/60 backdrop-blur px-2 py-1 rounded border border-white/10">
                          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                          <span>OPTICAL LOCK // TARGET CENTROID</span>
                        </div>
                        <span className="bg-black/60 backdrop-blur px-2 py-1 rounded border border-white/10 text-slate-300">
                          FPS: 30.0 • 1080p
                        </span>
                      </div>

                      {/* Center Crosshairs */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-16 h-16 border border-sky-400/50 rounded-full flex items-center justify-center">
                          <div className="w-1.5 h-1.5 bg-red-500 rounded-full" />
                        </div>
                        <div className="absolute w-24 h-px bg-sky-400/40" />
                        <div className="absolute h-24 w-px bg-sky-400/40" />
                      </div>

                      {/* Bottom Telemetry HUD */}
                      <div className="flex items-center justify-between bg-black/60 backdrop-blur p-2 rounded border border-white/10 text-[10px]">
                        <span>PAN AZIMUTH: 0.00 RAD</span>
                        <span>DISTANCE: 1.45 M</span>
                        <span>PUMP PRESSURE: 4.2 BAR</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. Thermal Canvas Mode */}
                {feedMode === "thermal" && (
                  <div className="relative w-full h-full bg-[#0A0D14]">
                    <canvas
                      ref={canvasRef}
                      width={CW}
                      height={CH}
                      className="w-full h-full block"
                    />
                    <div className="absolute top-3 left-3 bg-black/70 backdrop-blur px-2.5 py-1 rounded border border-white/10 text-[10px] text-white font-mono">
                      PEAK: 68.4°C • MLX90640-D55
                    </div>
                  </div>
                )}

                {/* 3. Mechanical Blueprint Mode */}
                {feedMode === "blueprint" && (
                  <div className="relative w-full h-full bg-black">
                    <img
                      src="/firebot-rover-detail.jpg"
                      alt="FireBot Mechanical Blueprint"
                      className="w-full h-full object-cover opacity-90"
                    />
                    <div className="absolute bottom-3 left-3 bg-black/80 backdrop-blur p-2 rounded border border-white/10 text-[11px] text-white">
                      PHYSICAL ARCHITECTURE // DUAL-COMPUTE PLATFORM
                    </div>
                  </div>
                )}
              </div>

              {/* Viewport Footer Operational Actions */}
              <div className="grid sm:grid-cols-2 gap-3 pt-1">
                <button
                  onClick={() => {
                    playSound("tab");
                    onEnterConsole("live");
                  }}
                  className="py-3 px-4 rounded bg-red-600 hover:bg-red-500 text-white font-display font-extrabold text-xs tracking-wider uppercase transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                  <span>ENGAGE TACTICAL COMMAND CONSOLE</span>
                  <span>→</span>
                </button>

                <button
                  onClick={() => {
                    playSound("tab");
                    onEnterConsole("mujoco");
                  }}
                  className="py-3 px-4 rounded bg-slate-900 hover:bg-slate-800 border border-white/10 hover:border-sky-400/50 text-white font-mono font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>3D RIGID-BODY PHYSICS (MUJOCO)</span>
                  <span>→</span>
                </button>
              </div>
            </div>

            {/* Right Column: Instrument Telemetry Tapes */}
            <div className="space-y-4">
              {/* Telemetry Gauge Box 1 */}
              <div className="rounded-xl border border-white/[0.12] bg-[#0A0D14] p-4 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-white/[0.08] text-[11px] font-bold">
                  <span className="text-white">POWER &amp; PROPULSION</span>
                  <span className="text-emerald-400">NOMINAL</span>
                </div>

                <div className="space-y-2.5 text-xs">
                  <div>
                    <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                      <span>BATTERY RAIL (3S LiPo)</span>
                      <span className="text-white font-bold">12.58 V (92%)</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div className="h-full bg-emerald-400 w-[92%]" />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                      <span>WATER RESERVOIR</span>
                      <span className="text-white font-bold">88% (4.2 BAR)</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div className="h-full bg-sky-400 w-[88%]" />
                    </div>
                  </div>

                  <div className="pt-1 flex items-center justify-between text-[11px] text-slate-400 border-t border-white/[0.06]">
                    <span>MOTOR DRIVE PWM:</span>
                    <span className="text-white font-bold">20 kHz (TB6612FNG)</span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>TRACK VELOCITY:</span>
                    <span className="text-white font-bold">0.32 m/s</span>
                  </div>
                </div>
              </div>

              {/* Telemetry Gauge Box 2 */}
              <div className="rounded-xl border border-white/[0.12] bg-[#0A0D14] p-4 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-white/[0.08] text-[11px] font-bold">
                  <span className="text-white">ENVIRONMENTAL ARRAY</span>
                  <span className="text-sky-400">ACTIVE</span>
                </div>

                <div className="space-y-2 text-[11px]">
                  <div className="flex justify-between text-slate-400">
                    <span>FLIR ARRAY:</span>
                    <span className="text-white font-bold">MLX90640 [32×24]</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>THERMAL CENTROID:</span>
                    <span className="text-red-400 font-bold">68.4°C @ +12°</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>MQ-2 GAS DENSITY:</span>
                    <span className="text-white font-bold">0.082 NORM (CLEAN)</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>ULTRASONIC CLEARANCE:</span>
                    <span className="text-white font-bold">FL: 1.45m | FR: 1.52m</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>WATCHDOG INTERVAL:</span>
                    <span className="text-emerald-400 font-bold">12 ms / 500 ms</span>
                  </div>
                </div>
              </div>

              {/* Hardware Spec PDF Card */}
              <a
                href="/FireBot_Hardware_and_Wiring_Specification.pdf"
                download="FireBot_Hardware_and_Wiring_Specification.pdf"
                className="block p-4 rounded-xl border border-white/[0.12] bg-slate-900/50 hover:bg-slate-900 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-white group-hover:text-sky-400 transition-colors">
                      Hardware &amp; Wiring Spec
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">
                      Complete 14-page schematic &amp; pinout PDF
                    </div>
                  </div>
                  <span className="text-slate-500 group-hover:text-white transition-colors">↓</span>
                </div>
              </a>
            </div>
          </div>
        </section>

        {/* INTERACTIVE SUBSYSTEM ENGINEERING BENCH */}
        <section className="space-y-4 pt-4 border-t border-white/[0.08]">
          <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
            <div>
              <span className="text-[10px] text-sky-400 font-bold uppercase tracking-widest">
                AVIONICS &amp; ELECTRICAL BLUEPRINT
              </span>
              <h2 className="text-xl sm:text-2xl font-extrabold text-white font-display mt-0.5">
                Subsystem Architecture &amp; Wiring Matrix
              </h2>
            </div>
            <span className="text-[11px] text-slate-400 hidden sm:inline">
              SELECT SUBSYSTEM TO INSPECT PINOUTS
            </span>
          </div>

          {/* Subsystem Selector Buttons */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {SUBSYSTEMS.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  playSound("tab");
                  setActiveSubsystem(s);
                }}
                className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                  activeSubsystem.id === s.id
                    ? "bg-slate-800 text-white border-sky-400/50 shadow-sm"
                    : "bg-[#0A0D14] text-slate-400 hover:text-white border-white/[0.08] hover:bg-slate-900"
                }`}
              >
                <div className="text-[10px] text-sky-400 font-semibold truncate">{s.role}</div>
                <div className="text-xs font-bold text-white mt-1 truncate">{s.name.split(" ")[0]} {s.name.split(" ")[1]}</div>
              </button>
            ))}
          </div>

          {/* Active Subsystem Detailed Dossier Card */}
          <div className="rounded-xl border border-white/[0.12] bg-[#0A0D14] p-6 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
              <div>
                <span className="text-[10px] text-sky-400 uppercase font-bold tracking-widest">
                  {activeSubsystem.role}
                </span>
                <h3 className="text-xl font-bold font-display text-white mt-0.5">
                  {activeSubsystem.name}
                </h3>
              </div>

              <div className="flex items-center gap-3 text-[11px]">
                <span className="px-2.5 py-1 rounded bg-slate-900 border border-white/10 text-slate-300">
                  BUS: <b className="text-white">{activeSubsystem.bus}</b>
                </span>
                <span className="px-2.5 py-1 rounded bg-slate-900 border border-white/10 text-slate-300">
                  POWER: <b className="text-white">{activeSubsystem.power}</b>
                </span>
              </div>
            </div>

            {/* Technical Characteristics & Pinout Matrix */}
            <div className="grid md:grid-cols-2 gap-6 items-start">
              {/* Left: Engineering Characteristics */}
              <div className="space-y-3">
                <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">
                  Operational Parameters
                </span>
                <div className="space-y-2">
                  {activeSubsystem.specs.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2.5 p-2.5 rounded bg-slate-900/60 border border-white/[0.06] text-xs text-slate-200">
                      <span className="text-sky-400 mt-0.5 font-bold">›</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: Pinout Connections Table */}
              <div className="space-y-3">
                <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">
                  Physical Hardware Interconnects
                </span>
                <div className="rounded border border-white/[0.08] overflow-hidden text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-slate-900 text-slate-400 text-[10px] uppercase font-bold border-b border-white/[0.08]">
                      <tr>
                        <th className="p-2.5">Component Terminal</th>
                        <th className="p-2.5">Avionics Interconnect</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06] bg-[#0A0D14]">
                      {activeSubsystem.pinout.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-900/40 transition-colors">
                          <td className="p-2.5 font-bold text-sky-300">{row.pin}</td>
                          <td className="p-2.5 text-slate-300">{row.target}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* BOTTOM SORTIE SUMMARY & FOOTER */}
        <footer className="pt-6 border-t border-white/[0.08] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>FIREBOT PLATFORM CORE v2.5 // AUTONOMOUS SUPPRESSION VESSEL</span>
          </div>
          <div>
            Built with ESP32 RTOS, Raspberry Pi Linux, and FLIR Far-Infrared Imaging.
          </div>
        </footer>
      </main>
    </div>
  );
}
