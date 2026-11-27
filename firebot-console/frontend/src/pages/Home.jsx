import React from "react";
import { playSound } from "../lib/sound.js";

export default function Home({ setPage, frame, linkOk }) {
  const handleNav = (target) => {
    playSound("tab");
    setPage(target);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      {/* Top Banner Status */}
      <div className="border-b border-line/60 bg-panel/60 backdrop-blur-md px-6 py-2.5 flex items-center justify-between text-[11px] font-mono">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-telemetry font-bold tracking-wider">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-telemetry opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-telemetry"></span>
            </span>
            SYSTEM OPERATIONAL
          </span>
          <span className="text-faint">•</span>
          <span className="text-muted">PROJECT FIREBOT V1.0</span>
          <span className="text-faint">•</span>
          <span className="text-faint">TACTICAL AUTONOMOUS FIREFIGHTING ROVER</span>
        </div>
        <div className="flex items-center gap-4 text-faint">
          <span className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${linkOk ? "bg-ok" : "bg-warn"}`} />
            TELEMETRY LINK: {linkOk ? "STREAMING (10 HZ)" : "STANDBY"}
          </span>
          <span>ROBOT: firebot-1</span>
        </div>
      </div>

      <div className="p-6 md:p-10 max-w-7xl mx-auto w-full space-y-10">
        {/* HERO SECTION */}
        <div className="relative rounded-3xl overflow-hidden border border-line bg-gradient-to-br from-panel2/90 via-panel/90 to-panel2/60 backdrop-blur-xl shadow-2xl">
          {/* Subtle background glow */}
          <div className="absolute -top-24 -left-24 w-96 h-96 bg-telemetry/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-flame/15 rounded-full blur-3xl pointer-events-none" />

          <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-8 p-8 md:p-12 items-center relative z-10">
            {/* Left Content */}
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-telemetry/10 border border-telemetry/30 text-telemetry text-[11px] font-mono font-semibold tracking-wide uppercase">
                <span className="h-1.5 w-1.5 rounded-full bg-telemetry animate-pulse" />
                Next-Gen Tactical Robotics
              </div>

              <div className="space-y-3">
                <h1 className="text-3xl md:text-5xl font-extrabold text-ink tracking-tight leading-[1.15]">
                  Autonomous Fire Suppression <br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-telemetry via-flame to-warn">
                    In Extreme Environments.
                  </span>
                </h1>
                <p className="text-muted text-sm md:text-base leading-relaxed max-w-xl">
                  Deploying cutting-edge dual-microcontroller edge compute (Raspberry Pi &amp; ESP32),
                  radiometric far-infrared thermal tracking, RRT* dynamic path planning, and fail-safe voice control.
                </p>
              </div>

              {/* Primary Call to Action Deck */}
              <div className="flex flex-wrap items-center gap-3.5 pt-2">
                <button
                  onClick={() => handleNav("live")}
                  className="px-6 py-3.5 rounded-2xl bg-gradient-to-r from-telemetry to-flame text-white font-mono text-[13px] font-bold shadow-lg shadow-telemetry/25 hover:shadow-telemetry/40 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 flex items-center gap-2.5"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="2" />
                    <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
                  </svg>
                  LAUNCH TACTICAL CONSOLE
                </button>

                <button
                  onClick={() => handleNav("mujoco")}
                  className="px-5 py-3.5 rounded-2xl bg-panel2/80 hover:bg-panel2 border border-line hover:border-line2 text-ink font-mono text-[13px] font-medium transition-all duration-200 flex items-center gap-2"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-telemetry">
                    <path d="m21 16-9 5-9-5V8l9-5 9 5v8z" />
                    <path d="m3.27 6.96 8.73 4.85 8.73-4.85M12 22V12" />
                  </svg>
                  3D MuJoCo Physics Sim
                </button>

                <a
                  href="/FireBot_Hardware_and_Wiring_Specification.pdf"
                  download="FireBot_Hardware_and_Wiring_Specification.pdf"
                  className="px-4 py-3.5 rounded-2xl bg-panel/60 hover:bg-panel border border-line text-muted hover:text-ink font-mono text-[12px] font-medium transition-all duration-200 flex items-center gap-2"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ok">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Hardware Spec (PDF)
                </a>
              </div>

              {/* Key Highlights Row */}
              <div className="grid grid-cols-3 gap-3 pt-4 border-t border-line/60">
                <div>
                  <div className="text-xl font-bold font-mono text-ink">32×24</div>
                  <div className="text-[11px] font-mono text-faint">FLIR Thermal Matrix</div>
                </div>
                <div>
                  <div className="text-xl font-bold font-mono text-telemetry">&lt; 120 ms</div>
                  <div className="text-[11px] font-mono text-faint">Fusion Response</div>
                </div>
                <div>
                  <div className="text-xl font-bold font-mono text-flame">12V 4.5L</div>
                  <div className="text-[11px] font-mono text-faint">Diaphragm Water Nozzle</div>
                </div>
              </div>
            </div>

            {/* Right Media Display: Cinematic Rover Render */}
            <div className="relative group">
              <div className="relative rounded-2xl overflow-hidden border border-line/80 shadow-2xl bg-black">
                <img
                  src="/firebot-hero.jpg"
                  alt="FireBot Autonomous Firefighting Rover"
                  className="w-full h-auto object-cover transform group-hover:scale-105 transition-transform duration-700 ease-out"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />

                {/* Tactical HUD Overlay Elements */}
                <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md border border-white/10 px-3 py-1 rounded-full text-[10px] font-mono text-white flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-ok animate-pulse" />
                  VESSEL: FIREBOT TACTICAL MARK I
                </div>

                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-[11px] font-mono text-white/90">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-telemetry/40 border border-telemetry/60 text-white font-bold">
                      FLIR LOCK
                    </span>
                    <span className="text-white/80">HOTSPOT ACQUIRED</span>
                  </div>
                  <span className="text-white/60">240 MHz RTOS</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SYSTEM CAPABILITIES / ARCHITECTURE PILLARS */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold font-mono text-ink tracking-tight uppercase flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-telemetry" />
              Core Autonomous Architecture
            </h2>
            <span className="text-[11px] font-mono text-faint">4 INTEGRATED SUBSYSTEMS</span>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Pillar 1: Thermal Vision */}
            <div
              onClick={() => handleNav("live")}
              className="panel p-5 rounded-2xl border border-line hover:border-telemetry/50 bg-panel/70 hover:bg-panel2/80 transition-all duration-200 cursor-pointer space-y-3 group"
            >
              <div className="h-10 w-10 rounded-xl bg-flame/10 border border-flame/20 flex items-center justify-center text-flame group-hover:scale-110 transition-transform">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2c1 3 2.5 3.5 3.5 4.5A5 5 0 0 1 17 10a5 5 0 1 1-10 0c0-1.6.6-3.1 1.5-3.5 1-1 2.5-1.5 3.5-4.5Z" />
                </svg>
              </div>
              <h3 className="text-[14px] font-bold text-ink font-mono">Thermal Fire Fix</h3>
              <p className="text-[12px] text-muted leading-relaxed">
                MLX90640 32×24 Far-Infrared sensor penetrates zero-visibility smoke, pinpointing flame centroid and temperature gradients in real time.
              </p>
              <div className="text-[11px] font-mono text-telemetry font-medium flex items-center gap-1">
                Open Thermal Deck &rarr;
              </div>
            </div>

            {/* Pillar 2: Dual Edge Compute */}
            <div
              onClick={() => handleNav("live")}
              className="panel p-5 rounded-2xl border border-line hover:border-telemetry/50 bg-panel/70 hover:bg-panel2/80 transition-all duration-200 cursor-pointer space-y-3 group"
            >
              <div className="h-10 w-10 rounded-xl bg-telemetry/10 border border-telemetry/20 flex items-center justify-center text-telemetry group-hover:scale-110 transition-transform">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                  <rect x="9" y="9" width="6" height="6" />
                  <path d="M15 2v2M9 2v2M15 20v2M9 20v2M2 15h2M2 9h2M20 15h2M20 9h2" />
                </svg>
              </div>
              <h3 className="text-[14px] font-bold text-ink font-mono">Dual-Compute Split</h3>
              <p className="text-[12px] text-muted leading-relaxed">
                ESP32 hard real-time MCU controls 20 kHz motor PWM and 500ms safety watchdog, paired with Raspberry Pi Linux for high-speed link streaming.
              </p>
              <div className="text-[11px] font-mono text-telemetry font-medium flex items-center gap-1">
                View Hardware Wire &rarr;
              </div>
            </div>

            {/* Pillar 3: Planning & Sim */}
            <div
              onClick={() => handleNav("mujoco")}
              className="panel p-5 rounded-2xl border border-line hover:border-telemetry/50 bg-panel/70 hover:bg-panel2/80 transition-all duration-200 cursor-pointer space-y-3 group"
            >
              <div className="h-10 w-10 rounded-xl bg-ok/10 border border-ok/20 flex items-center justify-center text-ok group-hover:scale-110 transition-transform">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 2 7 12 12 22 7 12 2" />
                  <polyline points="2 17 12 22 22 17" />
                  <polyline points="2 12 12 17 22 12" />
                </svg>
              </div>
              <h3 className="text-[14px] font-bold text-ink font-mono">RRT* &amp; MuJoCo 3D</h3>
              <p className="text-[12px] text-muted leading-relaxed">
                Asymptotically optimal pathfinding navigates debris corridors while the high-fidelity 3D MuJoCo simulator models continuous physics and water trajectory.
              </p>
              <div className="text-[11px] font-mono text-telemetry font-medium flex items-center gap-1">
                Launch MuJoCo &rarr;
              </div>
            </div>

            {/* Pillar 4: Voice Studio */}
            <div
              onClick={() => handleNav("voice")}
              className="panel p-5 rounded-2xl border border-line hover:border-telemetry/50 bg-panel/70 hover:bg-panel2/80 transition-all duration-200 cursor-pointer space-y-3 group"
            >
              <div className="h-10 w-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 group-hover:scale-110 transition-transform">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" x2="12" y1="19" y2="22" />
                </svg>
              </div>
              <h3 className="text-[14px] font-bold text-ink font-mono">Biometric Voice</h3>
              <p className="text-[12px] text-muted leading-relaxed">
                Offline Vosk speech recognition with enrolled speaker embeddings guarantees that only authorized first-responder voices can issue tactical commands.
              </p>
              <div className="text-[11px] font-mono text-telemetry font-medium flex items-center gap-1">
                Calibrate Operator &rarr;
              </div>
            </div>
          </div>
        </div>

        {/* DETAILED HARDWARE SPECS & ROVER BREAKDOWN */}
        <div className="panel p-6 md:p-8 rounded-3xl border border-line bg-panel/80 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-line">
            <div>
              <h3 className="text-base font-bold font-mono text-ink uppercase tracking-wide">
                Hardware Engineering Specifications
              </h3>
              <p className="text-[12px] text-muted">
                Complete pin-by-pin electrical wiring, power rails, and fail-safe watchdog architecture.
              </p>
            </div>
            <a
              href="/FireBot_Hardware_and_Wiring_Specification.pdf"
              download="FireBot_Hardware_and_Wiring_Specification.pdf"
              className="px-4 py-2.5 rounded-xl bg-telemetry/15 hover:bg-telemetry/25 border border-telemetry/40 text-telemetry font-mono text-[12px] font-bold transition-all flex items-center gap-2 self-start md:self-auto"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download PDF Manual (14 Pages)
            </a>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <div className="space-y-3 p-4 rounded-2xl bg-panel2/50 border border-line">
              <span className="text-[11px] font-mono text-telemetry uppercase tracking-wider font-semibold">
                SENSORY ARRAY (ESP32)
              </span>
              <ul className="text-[12px] font-mono text-muted space-y-2">
                <li className="flex justify-between">
                  <span>4x HC-SR04 Ultrasonic</span>
                  <span className="text-ink">GPIO 13, 12, 14, 27</span>
                </li>
                <li className="flex justify-between">
                  <span>3x IR Flame Sensors</span>
                  <span className="text-ink">GPIO 25, 26, 33</span>
                </li>
                <li className="flex justify-between">
                  <span>2x MQ-2 Smoke/Gas</span>
                  <span className="text-ink">GPIO 32, 15 (ADC)</span>
                </li>
                <li className="flex justify-between">
                  <span>Water Tank Float</span>
                  <span className="text-ink">GPIO 4 (ADC)</span>
                </li>
              </ul>
            </div>

            <div className="space-y-3 p-4 rounded-2xl bg-panel2/50 border border-line">
              <span className="text-[11px] font-mono text-flame uppercase tracking-wider font-semibold">
                ACTUATION &amp; DRIVER
              </span>
              <ul className="text-[12px] font-mono text-muted space-y-2">
                <li className="flex justify-between">
                  <span>Left DC Motor (20kHz)</span>
                  <span className="text-ink">GPIO 18, 19, 21</span>
                </li>
                <li className="flex justify-between">
                  <span>Right DC Motor (20kHz)</span>
                  <span className="text-ink">GPIO 22, 23, 5</span>
                </li>
                <li className="flex justify-between">
                  <span>12V Pump N-MOSFET</span>
                  <span className="text-ink">GPIO 17 (IRLZ44N)</span>
                </li>
                <li className="flex justify-between">
                  <span>Extinguisher Pan Servo</span>
                  <span className="text-ink">GPIO 16 (SG90)</span>
                </li>
              </ul>
            </div>

            <div className="space-y-3 p-4 rounded-2xl bg-panel2/50 border border-line">
              <span className="text-[11px] font-mono text-ok uppercase tracking-wider font-semibold">
                PERCEPTION &amp; POWER
              </span>
              <ul className="text-[12px] font-mono text-muted space-y-2">
                <li className="flex justify-between">
                  <span>MLX90640-D55 Thermal</span>
                  <span className="text-ink">I2C (0x33) @ 400kHz</span>
                </li>
                <li className="flex justify-between">
                  <span>Power Rails</span>
                  <span className="text-ink">12V 3S LiPo + 2x Buck</span>
                </li>
                <li className="flex justify-between">
                  <span>Safety Watchdog</span>
                  <span className="text-ink">500 ms Hardware Cutoff</span>
                </li>
                <li className="flex justify-between">
                  <span>Serial Bridge</span>
                  <span className="text-ink">115200 Baud UART</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* QUICK START NAVIGATION CARDS */}
        <div className="grid md:grid-cols-3 gap-4">
          <div
            onClick={() => handleNav("live")}
            className="p-6 rounded-2xl border border-line/80 bg-gradient-to-br from-panel2 to-panel hover:border-telemetry/40 transition-all duration-200 cursor-pointer space-y-2"
          >
            <div className="text-[11px] font-mono uppercase tracking-wider text-telemetry font-semibold">
              TACTICAL OPERATIONS
            </div>
            <div className="text-lg font-bold text-ink">Live Mission Deck</div>
            <p className="text-[12px] text-muted">
              Access real-time video feed, FLIR thermal overlay, analog teleop joystick, and manual nozzle controls.
            </p>
          </div>

          <div
            onClick={() => handleNav("sim")}
            className="p-6 rounded-2xl border border-line/80 bg-gradient-to-br from-panel2 to-panel hover:border-telemetry/40 transition-all duration-200 cursor-pointer space-y-2"
          >
            <div className="text-[11px] font-mono uppercase tracking-wider text-ok font-semibold">
              ALGORITHM BENCHMARK
            </div>
            <div className="text-lg font-bold text-ink">2D Sensor &amp; SLAM Sim</div>
            <p className="text-[12px] text-muted">
              Inspect Extended Information Filter (EIF) sensor fusion, occupancy grids, and RRT* trajectory generation.
            </p>
          </div>

          <div
            onClick={() => handleNav("history")}
            className="p-6 rounded-2xl border border-line/80 bg-gradient-to-br from-panel2 to-panel hover:border-telemetry/40 transition-all duration-200 cursor-pointer space-y-2"
          >
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted font-semibold">
              POST-INCIDENT AUDIT
            </div>
            <div className="text-lg font-bold text-ink">Sortie Archives</div>
            <p className="text-[12px] text-muted">
              Review full PostgreSQL telemetry logs, extinguishing metrics, water consumption graphs, and event replays.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
