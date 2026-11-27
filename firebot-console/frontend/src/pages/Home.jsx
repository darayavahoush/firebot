import React from "react";
import { playSound } from "../lib/sound.js";

export default function Home({ onEnterConsole, frame, linkOk }) {
  const handleLaunch = (target = "live") => {
    playSound("tab");
    onEnterConsole(target);
  };

  return (
    <div className="min-h-screen bg-base text-ink flex flex-col font-sans selection:bg-telemetry/30 selection:text-white">
      {/* Top Floating Glass Navigation Bar */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-base/85 border-b border-line/60">
        <div className="max-w-7xl mx-auto px-6 h-18 flex items-center justify-between">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3.5">
            <div className="relative h-10 w-10 rounded-2xl bg-gradient-to-br from-telemetry via-flame to-warn flex items-center justify-center shadow-[0_0_20px_rgba(240,85,155,0.4)] shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0E0919" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display font-black text-lg tracking-wider text-ink">
                  FIREBOT
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-telemetry/15 text-telemetry border border-telemetry/30">
                  AUTONOMOUS V2.5
                </span>
              </div>
              <span className="text-[10px] font-mono text-faint tracking-widest uppercase">
                Tactical Firefighting &amp; Hazard Robotics
              </span>
            </div>
          </div>

          {/* Quick Nav Anchors */}
          <nav className="hidden md:flex items-center gap-7 text-xs font-mono text-muted">
            <a href="#capabilities" className="hover:text-ink transition-colors">Capabilities</a>
            <a href="#hardware" className="hover:text-ink transition-colors">Hardware &amp; Wiring</a>
            <a href="#simulation" className="hover:text-ink transition-colors">MuJoCo 3D</a>
            <a href="#telemetry" className="hover:text-ink transition-colors">Live Status</a>
          </nav>

          {/* Action CTAs */}
          <div className="flex items-center gap-3">
            <a
              href="/FireBot_Hardware_and_Wiring_Specification.pdf"
              download="FireBot_Hardware_and_Wiring_Specification.pdf"
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-panel2/80 hover:bg-panel2 border border-line hover:border-line2 text-xs font-mono text-muted hover:text-ink transition-all"
              title="Download 14-page Hardware & Wiring PDF"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ok">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Hardware PDF</span>
            </a>

            <button
              onClick={() => handleLaunch("live")}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-telemetry to-flame text-white font-mono text-xs font-bold shadow-lg shadow-telemetry/30 hover:shadow-telemetry/50 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-2"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
              </span>
              ENTER COMMAND CENTRE &rarr;
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 space-y-20 py-10 md:py-16">
        {/* HERO SECTION */}
        <section className="max-w-7xl mx-auto px-6">
          <div className="relative rounded-3xl overflow-hidden border border-line bg-gradient-to-br from-panel2/90 via-panel/80 to-panel2/60 backdrop-blur-2xl shadow-2xl">
            {/* Ambient Lighting Orbs */}
            <div className="absolute -top-32 -left-32 w-[420px] h-[420px] bg-telemetry/15 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-32 -right-32 w-[420px] h-[420px] bg-flame/15 rounded-full blur-3xl pointer-events-none" />

            <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-10 p-8 md:p-14 items-center relative z-10">
              {/* Left Column: Headlines & CTAs */}
              <div className="space-y-6">
                <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-telemetry/10 border border-telemetry/30 text-telemetry text-xs font-mono font-semibold tracking-wide uppercase">
                  <span className="h-2 w-2 rounded-full bg-telemetry animate-pulse" />
                  Autonomous Emergency Response Robotics
                </div>

                <div className="space-y-3">
                  <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-ink tracking-tight leading-[1.1]">
                    Autonomous Fire <br />
                    Suppression In <br />
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-telemetry via-flame to-warn">
                      Zero-Visibility Hazards.
                    </span>
                  </h1>
                  <p className="text-muted text-sm md:text-base leading-relaxed max-w-xl">
                    Engineered for high-risk disaster response. Deploying dual-compute edge architecture
                    (Raspberry Pi &amp; ESP32 RTOS), MLX90640 radiometric thermal IR tracking,
                    continuous MuJoCo 3D physics verification, and safe voice-command teleoperation.
                  </p>
                </div>

                {/* Primary Launch Action Buttons */}
                <div className="flex flex-wrap items-center gap-3.5 pt-2">
                  <button
                    onClick={() => handleLaunch("live")}
                    className="px-7 py-4 rounded-2xl bg-gradient-to-r from-telemetry via-[#C4286F] to-flame text-white font-mono text-sm font-bold shadow-xl shadow-telemetry/30 hover:shadow-telemetry/50 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-3"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="2" />
                      <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
                    </svg>
                    ENTER COMMAND CENTRE
                  </button>

                  <button
                    onClick={() => handleLaunch("mujoco")}
                    className="px-6 py-4 rounded-2xl bg-panel2 hover:bg-panel2/80 border border-line hover:border-line2 text-ink font-mono text-sm font-medium transition-all flex items-center gap-2.5"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-telemetry">
                      <path d="m21 16-9 5-9-5V8l9-5 9 5v8z" />
                      <path d="m3.27 6.96 8.73 4.85 8.73-4.85M12 22V12" />
                    </svg>
                    3D MuJoCo Physics
                  </button>
                </div>

                {/* Key Metric Gauges */}
                <div className="grid grid-cols-3 gap-4 pt-4 border-t border-line/60">
                  <div>
                    <div className="text-2xl font-bold font-mono text-ink">32×24</div>
                    <div className="text-xs font-mono text-faint">FLIR Thermal Array</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold font-mono text-telemetry">&lt; 120 ms</div>
                    <div className="text-xs font-mono text-faint">Decision Latency</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold font-mono text-flame">12V 4.5L</div>
                    <div className="text-xs font-mono text-faint">Extinguisher Pump</div>
                  </div>
                </div>
              </div>

              {/* Right Column: Hero Robotics Image Card */}
              <div className="relative group">
                <div className="relative rounded-2xl overflow-hidden border border-line/80 shadow-2xl bg-black">
                  <img
                    src="/firebot-hero.jpg"
                    alt="FireBot Autonomous Tactical Firefighting Rover"
                    className="w-full h-auto object-cover transform group-hover:scale-105 transition-transform duration-700 ease-out"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent pointer-events-none" />

                  {/* Floating HUD Badges */}
                  <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md border border-white/10 px-3.5 py-1.5 rounded-full text-xs font-mono text-white flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-ok animate-pulse" />
                    STATUS: ALL SYSTEMS GO
                  </div>

                  <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-xs font-mono text-white/90">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded bg-telemetry/40 border border-telemetry/60 text-white font-bold">
                        FLIR LOCK
                      </span>
                      <span className="text-white/80">HOTSPOT ACQUIRED (68.4°C)</span>
                    </div>
                    <span className="text-white/60">ESP32 RTOS 240MHz</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CORE OPERATIONAL CAPABILITIES */}
        <section id="capabilities" className="max-w-7xl mx-auto px-6 space-y-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <span className="text-xs font-mono uppercase tracking-widest text-telemetry font-semibold">
                FULL-STACK AUTONOMY
              </span>
              <h2 className="text-2xl md:text-3xl font-extrabold text-ink font-display tracking-tight mt-1">
                Built For Dangerous, Unpredictable Terrains.
              </h2>
            </div>
            <p className="text-xs font-mono text-muted max-w-md">
              Combining tactile collision avoidance, far-infrared thermal tracking, and real-time state estimation.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Card 1 */}
            <div
              onClick={() => handleLaunch("live")}
              className="panel p-6 rounded-2xl border border-line hover:border-telemetry/50 bg-panel/70 hover:bg-panel2/80 transition-all duration-200 cursor-pointer space-y-3 group"
            >
              <div className="h-12 w-12 rounded-xl bg-flame/10 border border-flame/20 flex items-center justify-center text-flame group-hover:scale-110 transition-transform">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2c1 3 2.5 3.5 3.5 4.5A5 5 0 0 1 17 10a5 5 0 1 1-10 0c0-1.6.6-3.1 1.5-3.5 1-1 2.5-1.5 3.5-4.5Z" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-ink font-mono">Thermal Fire Fix</h3>
              <p className="text-xs text-muted leading-relaxed">
                MLX90640 32×24 Far-Infrared sensor array penetrates dense smoke, detecting thermal centroids and flame vectors in real time.
              </p>
              <div className="text-xs font-mono text-telemetry font-semibold flex items-center gap-1 pt-2">
                Launch Live View &rarr;
              </div>
            </div>

            {/* Card 2 */}
            <div
              onClick={() => handleLaunch("live")}
              className="panel p-6 rounded-2xl border border-line hover:border-telemetry/50 bg-panel/70 hover:bg-panel2/80 transition-all duration-200 cursor-pointer space-y-3 group"
            >
              <div className="h-12 w-12 rounded-xl bg-telemetry/10 border border-telemetry/20 flex items-center justify-center text-telemetry group-hover:scale-110 transition-transform">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                  <rect x="9" y="9" width="6" height="6" />
                  <path d="M15 2v2M9 2v2M15 20v2M9 20v2M2 15h2M2 9h2M20 15h2M20 9h2" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-ink font-mono">Dual-Compute Split</h3>
              <p className="text-xs text-muted leading-relaxed">
                ESP32 hard real-time MCU executes 20 kHz motor PWM and 500ms safety watchdog, while Raspberry Pi Linux streams telemetry over TCP.
              </p>
              <div className="text-xs font-mono text-telemetry font-semibold flex items-center gap-1 pt-2">
                Inspect Hardware &rarr;
              </div>
            </div>

            {/* Card 3 */}
            <div
              onClick={() => handleLaunch("mujoco")}
              className="panel p-6 rounded-2xl border border-line hover:border-telemetry/50 bg-panel/70 hover:bg-panel2/80 transition-all duration-200 cursor-pointer space-y-3 group"
            >
              <div className="h-12 w-12 rounded-xl bg-ok/10 border border-ok/20 flex items-center justify-center text-ok group-hover:scale-110 transition-transform">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 2 7 12 12 22 7 12 2" />
                  <polyline points="2 17 12 22 22 17" />
                  <polyline points="2 12 12 17 22 12" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-ink font-mono">RRT* &amp; MuJoCo 3D</h3>
              <p className="text-xs text-muted leading-relaxed">
                Asymptotically optimal path planning safely navigates debris corridors, verified against continuous 3D rigid-body simulation.
              </p>
              <div className="text-xs font-mono text-telemetry font-semibold flex items-center gap-1 pt-2">
                Open Physics Sim &rarr;
              </div>
            </div>

            {/* Card 4 */}
            <div
              onClick={() => handleLaunch("voice")}
              className="panel p-6 rounded-2xl border border-line hover:border-telemetry/50 bg-panel/70 hover:bg-panel2/80 transition-all duration-200 cursor-pointer space-y-3 group"
            >
              <div className="h-12 w-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 group-hover:scale-110 transition-transform">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" x2="12" y1="19" y2="22" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-ink font-mono">Voice Biometrics</h3>
              <p className="text-xs text-muted leading-relaxed">
                Vosk offline speech recognition paired with Siamese neural speaker verification ensures only authorized personnel can issue emergency commands.
              </p>
              <div className="text-xs font-mono text-telemetry font-semibold flex items-center gap-1 pt-2">
                Voice Studio &rarr;
              </div>
            </div>
          </div>
        </section>

        {/* HARDWARE SPECIFICATIONS & PDF DOWNLOAD */}
        <section id="hardware" className="max-w-7xl mx-auto px-6">
          <div className="panel p-8 md:p-10 rounded-3xl border border-line bg-panel/85 space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-line">
              <div>
                <span className="text-xs font-mono text-telemetry uppercase tracking-wider font-semibold">
                  EMBEDDED HARDWARE ARCHITECTURE
                </span>
                <h3 className="text-2xl font-bold font-mono text-ink mt-1">
                  Complete Physical Pinout &amp; Electrical Specs
                </h3>
                <p className="text-xs text-muted mt-1">
                  Verified schematic wiring, isolated power converters, and production C++ Arduino firmware.
                </p>
              </div>
              <a
                href="/FireBot_Hardware_and_Wiring_Specification.pdf"
                download="FireBot_Hardware_and_Wiring_Specification.pdf"
                className="px-6 py-3 rounded-xl bg-telemetry/15 hover:bg-telemetry/25 border border-telemetry/40 text-telemetry font-mono text-xs font-bold transition-all flex items-center gap-2.5 self-start md:self-auto shrink-0 shadow-sm"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download PDF Manual (14 Pages)
              </a>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {/* Sensor Ring */}
              <div className="space-y-3 p-5 rounded-2xl bg-panel2/50 border border-line">
                <span className="text-xs font-mono text-telemetry uppercase tracking-wider font-semibold">
                  SENSORS (ESP32)
                </span>
                <ul className="text-xs font-mono text-muted space-y-2.5">
                  <li className="flex justify-between">
                    <span>4x HC-SR04 Ultrasonic</span>
                    <span className="text-ink">GPIO 13, 12, 14, 27</span>
                  </li>
                  <li className="flex justify-between">
                    <span>3x IR Flame Modules</span>
                    <span className="text-ink">GPIO 25, 26, 33</span>
                  </li>
                  <li className="flex justify-between">
                    <span>2x MQ-2 Gas Sensors</span>
                    <span className="text-ink">GPIO 32, 15 (ADC)</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Water Level &amp; Batt</span>
                    <span className="text-ink">GPIO 4, 2 (ADC)</span>
                  </li>
                </ul>
              </div>

              {/* Actuators */}
              <div className="space-y-3 p-5 rounded-2xl bg-panel2/50 border border-line">
                <span className="text-xs font-mono text-flame uppercase tracking-wider font-semibold">
                  ACTUATORS (ESP32)
                </span>
                <ul className="text-xs font-mono text-muted space-y-2.5">
                  <li className="flex justify-between">
                    <span>Left Motor (20kHz PWM)</span>
                    <span className="text-ink">GPIO 18, 19, 21</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Right Motor (20kHz PWM)</span>
                    <span className="text-ink">GPIO 22, 23, 5</span>
                  </li>
                  <li className="flex justify-between">
                    <span>12V Diaphragm Pump</span>
                    <span className="text-ink">GPIO 17 (IRLZ44N)</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Turret Pan Servo</span>
                    <span className="text-ink">GPIO 16 (SG90)</span>
                  </li>
                </ul>
              </div>

              {/* SBC & Safety */}
              <div className="space-y-3 p-5 rounded-2xl bg-panel2/50 border border-line">
                <span className="text-xs font-mono text-ok uppercase tracking-wider font-semibold">
                  SBC &amp; POWER RAILS
                </span>
                <ul className="text-xs font-mono text-muted space-y-2.5">
                  <li className="flex justify-between">
                    <span>MLX90640-D55 Thermal</span>
                    <span className="text-ink">I2C (0x33) @ 400kHz</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Dual Buck Converters</span>
                    <span className="text-ink">12V &rarr; 5V (Isolated)</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Hardware Watchdog</span>
                    <span className="text-ink">500 ms Auto-Cutoff</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Serial Bridge</span>
                    <span className="text-ink">115200 Baud UART</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ENTER COMMAND CENTRE BANNER */}
        <section className="max-w-7xl mx-auto px-6">
          <div className="relative rounded-3xl overflow-hidden border border-telemetry/40 bg-gradient-to-r from-panel2 via-panel to-panel2 p-8 md:p-12 text-center space-y-5">
            <h3 className="text-2xl md:text-4xl font-extrabold text-ink font-display tracking-tight">
              Ready To Take Tactical Control?
            </h3>
            <p className="text-sm font-mono text-muted max-w-xl mx-auto">
              Launch the live command console to monitor real-time thermal matrices, trigger high-pressure suppression, and review emergency sorties.
            </p>
            <button
              onClick={() => handleLaunch("live")}
              className="px-8 py-4 rounded-2xl bg-gradient-to-r from-telemetry to-flame text-white font-mono text-sm font-bold shadow-xl shadow-telemetry/30 hover:scale-105 active:scale-95 transition-all inline-flex items-center gap-3"
            >
              <span>LAUNCH TACTICAL COMMAND CENTRE</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-line/60 bg-panel/40 py-8 px-6 text-xs font-mono text-faint">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-ink font-bold font-display">PROJECT FIREBOT</span>
            <span>&bull;</span>
            <span>Tactical Autonomous Fire Suppression Platform</span>
          </div>
          <div className="flex items-center gap-5">
            <a href="https://github.com/darayavahoush/firebot" target="_blank" rel="noreferrer" className="hover:text-ink transition-colors">
              GitHub Source
            </a>
            <a href="/FireBot_Hardware_and_Wiring_Specification.pdf" download="FireBot_Hardware_and_Wiring_Specification.pdf" className="hover:text-ink transition-colors">
              Hardware PDF
            </a>
            <span className="text-faint">&bull;</span>
            <span>Render Cloud Deployment</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
