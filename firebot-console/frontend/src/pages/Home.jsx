import React, { useState, useEffect, useRef } from "react";
import { playSound } from "../lib/sound.js";

// Hardware Subsystems for Interactive Chassis Inspection
const CHASSIS_HOTSPOTS = [
  {
    id: "flir",
    title: "FLIR MLX90640 Thermal Mast",
    category: "Perception",
    badge: "32×24 RADIOMETRIC ARRAY",
    description: "Far-infrared sensor array with germanium optics on an SG90 pan servo. Detects thermal radiation between -40°C and +300°C through pitch-black, smoke-engulfed corridors with 55° horizontal FOV.",
    spec: "I2C 0x33 @ 400 kHz • 3.3V Filtered Rail • <125ms Lock-on",
    x: 48,
    y: 20,
  },
  {
    id: "nozzle",
    title: "High-Pressure Suppression Turret",
    category: "Actuation",
    badge: "4.5 L/MIN @ 4.2 BAR",
    description: "Brass atomization nozzle driven by a 12V diaphragm pump switched via an IRLZ44N logic-level N-channel MOSFET. Equipped with flyback diode suppression and 180° frontal pan articulation.",
    spec: "Direct 12V LiPo • 3.2A Load • 1N4007 Snubber Diode",
    x: 62,
    y: 26,
  },
  {
    id: "compute",
    title: "Dual-Compute System (Pi 5 + ESP32)",
    category: "Processing",
    badge: "REAL-TIME + SLAM CORES",
    description: "Raspberry Pi 5 handles SLAM, WebSockets, Three.js telemetry, and cloud sync. ESP32 dual-core Xtensa MCU handles microsecond-level HC-SR04 sonar pulses and 20 kHz ultrasonic motor PWM with a 500ms safety watchdog.",
    spec: "UART 115,200 Baud • Isolated Dual-Buck Power (5V/3A + 5V/4A)",
    x: 50,
    y: 52,
  },
  {
    id: "tracks",
    title: "Continuous All-Terrain Tracks",
    category: "Mobility",
    badge: "ZERO-RADIUS DIFFERENTIAL",
    description: "Steel-reinforced rubber tread differential drive powered by high-torque DC gearmotors via a TB6612FNG H-Bridge. Provides zero-turn radius agility across debris, wet floors, and collapsed structural drywall.",
    spec: "12V Motor Rail • 0.60 m/s Max Speed • Aluminum Chassis",
    x: 24,
    y: 72,
  },
  {
    id: "flame",
    title: "Tri-Zone Flame Photodiode Array",
    category: "Triangulation",
    badge: "BEARING-ONLY EIF",
    description: "Three wide-angle UV/IR flame photodiode sensors positioned at -30°, 0°, and +30° relative to chassis heading. Feeds direct spatial angles into the Extended Information Filter for distance-free triangulation.",
    spec: "ESP32 ADC1 Pins 25, 26, 33 • 760–1100 nm Sensitivity",
    x: 74,
    y: 42,
  },
];

// Interactive Smoke vs. Thermal Penetration Canvas
function SmokePenetrationView() {
  const [visionMode, setVisionMode] = useState("thermal"); // "optical" | "thermal"
  const [sliderPos, setSliderPos] = useState(50); // percentage for split view
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animId;
    let t = 0;

    const render = () => {
      t += 0.03;
      const w = canvas.width, h = canvas.height;

      // 1. Draw Background Room Geometry (Dark industrial hall)
      ctx.fillStyle = "#080B11";
      ctx.fillRect(0, 0, w, h);

      // Floor perspective lines
      ctx.strokeStyle = "rgba(148, 163, 184, 0.12)";
      ctx.lineWidth = 1;
      for (let i = -4; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo(w / 2 + i * 40, h * 0.45);
        ctx.lineTo(w / 2 + i * 160, h);
        ctx.stroke();
      }

      // Fire Coordinates (center-right)
      const fireX = w * 0.68;
      const fireY = h * 0.52;

      // ---- LAYER A: OPTICAL (Zero-Visibility Smoke) ----
      const drawOptical = (clipWidth) => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, clipWidth, h);
        ctx.clip();

        // Very dark smoky room
        ctx.fillStyle = "#0C0F17";
        ctx.fillRect(0, 0, w, h);

        // Faint orange murk where fire is hidden behind thick smoke
        const faintGlow = ctx.createRadialGradient(fireX, fireY, 0, fireX, fireY, 180);
        faintGlow.addColorStop(0, "rgba(234, 88, 12, 0.25)");
        faintGlow.addColorStop(0.5, "rgba(180, 83, 9, 0.08)");
        faintGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = faintGlow;
        ctx.fillRect(0, 0, w, h);

        // Billowing volumetric smoke particles (obscuring vision completely)
        for (let i = 0; i < 24; i++) {
          const px = ((i * 37 + t * 45) % (w + 120)) - 60;
          const py = h * 0.3 + Math.sin(t * 0.8 + i) * 80 + (i % 5) * 35;
          const radius = 60 + (i % 4) * 25;
          const smokeGrad = ctx.createRadialGradient(px, py, 0, px, py, radius);
          smokeGrad.addColorStop(0, "rgba(22, 27, 38, 0.88)");
          smokeGrad.addColorStop(0.6, "rgba(15, 23, 42, 0.65)");
          smokeGrad.addColorStop(1, "rgba(10, 15, 25, 0)");
          ctx.fillStyle = smokeGrad;
          ctx.beginPath();
          ctx.arc(px, py, radius, 0, Math.PI * 2);
          ctx.fill();
        }

        // Overlay Label
        ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
        ctx.font = "11px 'Martian Mono', monospace";
        ctx.fillText("OPTICAL CAMERA (Zero Visibility • Thick Smoke)", 20, 30);
        ctx.restore();
      };

      // ---- LAYER B: FLIR RADIOMETRIC THERMAL (Smoke Penetration) ----
      const drawThermal = (clipX, clipWidth) => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(clipX, 0, clipWidth, h);
        ctx.clip();

        // Thermal Ironbow Base Room Convection
        ctx.fillStyle = "#0F1123";
        ctx.fillRect(0, 0, w, h);

        // Cool floor thermal gradient
        const floorGrad = ctx.createLinearGradient(0, h * 0.45, 0, h);
        floorGrad.addColorStop(0, "#12142B");
        floorGrad.addColorStop(1, "#1A163B");
        ctx.fillStyle = floorGrad;
        ctx.fillRect(0, h * 0.45, w, h * 0.55);

        // Radiometric Fire Heat Signature (Pierces clean through smoke!)
        const heatPulse = Math.sin(t * 3) * 6;
        const fireHeat = ctx.createRadialGradient(fireX, fireY, 4, fireX, fireY, 110 + heatPulse);
        fireHeat.addColorStop(0, "#FFF9E6"); // White-hot core (~800°C)
        fireHeat.addColorStop(0.18, "#FEF08A"); // Pale yellow
        fireHeat.addColorStop(0.42, "#F97316"); // Vivid orange plume
        fireHeat.addColorStop(0.72, "#C026D3"); // Magenta thermal gradient
        fireHeat.addColorStop(0.92, "#38BDF8"); // Cyan thermal boundary
        fireHeat.addColorStop(1, "transparent");

        ctx.fillStyle = fireHeat;
        ctx.beginPath();
        ctx.arc(fireX, fireY, 110 + heatPulse, 0, Math.PI * 2);
        ctx.fill();

        // 32x24 Radiometric Pixel Grid Texture (MLX90640 signature)
        ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
        ctx.lineWidth = 1;
        const cellSize = 18;
        for (let gx = 0; gx < w; gx += cellSize) {
          ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
        }
        for (let gy = 0; gy < h; gy += cellSize) {
          ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
        }

        // Tactical Reticle locked on Fire Centroid
        ctx.strokeStyle = "#FF4A2B";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(fireX, fireY, 28, 0, Math.PI * 2);
        ctx.stroke();

        // Crosshairs
        ctx.beginPath();
        ctx.moveTo(fireX - 42, fireY); ctx.lineTo(fireX - 12, fireY);
        ctx.moveTo(fireX + 12, fireY); ctx.lineTo(fireX + 42, fireY);
        ctx.moveTo(fireX, fireY - 42); ctx.lineTo(fireX, fireY - 12);
        ctx.moveTo(fireX, fireY + 12); ctx.lineTo(fireX, fireY + 42);
        ctx.stroke();

        // Reticle Data Tag
        ctx.fillStyle = "rgba(10, 13, 20, 0.85)";
        ctx.fillRect(fireX + 34, fireY - 26, 150, 48);
        ctx.strokeStyle = "rgba(255, 74, 43, 0.6)";
        ctx.strokeRect(fireX + 34, fireY - 26, 150, 48);

        ctx.fillStyle = "#FF6B4A";
        ctx.font = "bold 11px 'Martian Mono', monospace";
        ctx.fillText("FLIR THERMAL LOCK", fireX + 42, fireY - 10);
        ctx.fillStyle = "#E2E8F0";
        ctx.font = "10px 'Martian Mono', monospace";
        ctx.fillText("PEAK: 814.2°C", fireX + 42, fireY + 4);
        ctx.fillText("BEARING: +18.4°", fireX + 42, fireY + 16);

        // Overlay Label
        ctx.fillStyle = "#38BDF8";
        ctx.font = "bold 11px 'Martian Mono', monospace";
        ctx.fillText("FLIR MLX90640 THERMAL (Smoke Pierced • 32×24 Array)", Math.max(clipX + 20, 20), 30);
        ctx.restore();
      };

      // Render according to mode or split slider
      if (visionMode === "optical") {
        drawOptical(w);
      } else if (visionMode === "thermal") {
        drawThermal(0, w);
      } else {
        // Split view
        const splitX = (sliderPos / 100) * w;
        drawOptical(splitX);
        drawThermal(splitX, w - splitX);

        // Divider Line
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(splitX, 0);
        ctx.lineTo(splitX, h);
        ctx.stroke();

        // Handle indicator circle
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.arc(splitX, h / 2, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#0A0D14";
        ctx.font = "bold 10px 'Martian Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText("⟷", splitX, h / 2 + 3);
        ctx.textAlign = "left";
      }

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [visionMode, sliderPos]);

  return (
    <div className="rounded-2xl border border-white/10 bg-[#07090E] p-4 sm:p-6 space-y-4 shadow-2xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-sky-400 font-bold uppercase tracking-wider">
            <span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse" />
            Zero-Visibility Sensor Demonstration
          </div>
          <h3 className="font-display font-bold text-lg text-white mt-0.5">
            Compare Optical Camera vs. FLIR Radiometric Thermal Sensor
          </h3>
        </div>

        {/* View Controls */}
        <div className="flex items-center gap-1.5 bg-slate-900/90 p-1 rounded-xl border border-white/10 text-xs font-mono">
          <button
            onClick={() => { playSound("tab"); setVisionMode("split"); }}
            className={`px-3 py-1.5 rounded-lg transition-all ${visionMode === "split" ? "bg-white text-black font-bold shadow-sm" : "text-slate-400 hover:text-white"}`}
          >
            Interactive Split ⟷
          </button>
          <button
            onClick={() => { playSound("tab"); setVisionMode("thermal"); }}
            className={`px-3 py-1.5 rounded-lg transition-all ${visionMode === "thermal" ? "bg-sky-500 text-white font-bold shadow-sm" : "text-slate-400 hover:text-white"}`}
          >
            FLIR Thermal Only
          </button>
          <button
            onClick={() => { playSound("tab"); setVisionMode("optical"); }}
            className={`px-3 py-1.5 rounded-lg transition-all ${visionMode === "optical" ? "bg-slate-700 text-white font-bold shadow-sm" : "text-slate-400 hover:text-white"}`}
          >
            Optical Smoke Only
          </button>
        </div>
      </div>

      {/* Canvas Viewport */}
      <div className="relative rounded-xl overflow-hidden border border-white/10 bg-black aspect-[16/9] max-h-[480px]">
        <canvas ref={canvasRef} width={800} height={450} className="w-full h-full block" />

        {/* Split view drag slider */}
        {visionMode === "split" && (
          <input
            type="range"
            min="5"
            max="95"
            value={sliderPos}
            onChange={(e) => setSliderPos(Number(e.target.value))}
            className="absolute inset-x-4 bottom-4 z-20 accent-sky-400 cursor-ew-resize opacity-80 hover:opacity-100 transition-opacity"
            aria-label="Drag to compare optical smoke vs thermal penetration"
          />
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-slate-400 font-mono gap-2 pt-1">
        <span>Drag the slider or click tabs to observe how far-infrared radiation pierces dense particulate matter.</span>
        <span className="text-sky-400 font-semibold shrink-0">Wavelength: 8–14 µm Long-Wave IR</span>
      </div>
    </div>
  );
}

export default function Home({ onEnterConsole }) {
  const [selectedHotspot, setSelectedHotspot] = useState(CHASSIS_HOTSPOTS[0]);

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 font-sans selection:bg-sky-500/30 selection:text-white flex flex-col relative overflow-x-hidden">
      {/* Background Engineering Grain */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:28px_28px]" />

      {/* 1. TOP GLOBAL NAVIGATION BAR */}
      <header className="border-b border-white/[0.08] bg-[#0A0D14]/90 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Logo & Identity */}
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-red-600 flex items-center justify-center text-white font-display font-black text-sm shadow-md">
              F
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display font-extrabold text-base tracking-tight text-white">
                  FIREBOT
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30 font-bold">
                  v2.4
                </span>
              </div>
              <p className="text-[10px] font-mono text-slate-400 leading-none">
                Autonomous Structural Fire Suppression
              </p>
            </div>
          </div>

          {/* Center Navigation Modules */}
          <nav className="hidden md:flex items-center gap-1 text-xs font-mono">
            <button
              className="px-3 py-1.5 rounded-lg text-white font-bold bg-white/10 border border-white/15"
              disabled
            >
              Overview
            </button>
            <button
              onClick={() => { playSound("tab"); onEnterConsole("live"); }}
              className="px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
            >
              Tactical Console
            </button>
            <button
              onClick={() => { playSound("tab"); onEnterConsole("sim"); }}
              className="px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
            >
              2D Simulator
            </button>
            <button
              onClick={() => { playSound("tab"); onEnterConsole("mujoco"); }}
              className="px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
            >
              MuJoCo 3D
            </button>
            <button
              onClick={() => { playSound("tab"); onEnterConsole("voice"); }}
              className="px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
            >
              Voice Studio
            </button>
            <button
              onClick={() => { playSound("tab"); onEnterConsole("about"); }}
              className="px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
            >
              Architecture
            </button>
          </nav>

          {/* Right Action */}
          <div className="flex items-center gap-2.5">
            <a
              href="/FireBot_Hardware_and_Wiring_Specification.pdf"
              download="FireBot_Hardware_and_Wiring_Specification.pdf"
              className="hidden sm:flex px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/10 text-xs font-mono text-slate-300 hover:text-white transition-colors items-center gap-1.5"
            >
              <span>PDF Spec</span>
              <span className="text-[10px] text-slate-500">↓</span>
            </a>

            <button
              onClick={() => {
                playSound("tab");
                onEnterConsole("live");
              }}
              className="px-4 py-2 rounded-xl bg-white hover:bg-slate-200 text-black font-semibold text-xs tracking-wide transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
            >
              <span>Launch Command Center</span>
              <span>→</span>
            </button>
          </div>
        </div>
      </header>

      {/* 2. HERO HEADLINE & VALUE PROPOSITION */}
      <section className="relative pt-16 pb-12 sm:pt-24 sm:pb-16 px-4 sm:px-6 max-w-7xl mx-auto w-full space-y-8 text-center">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-white/10 text-xs font-mono text-slate-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>PRODUCTION-READY AUTONOMOUS ROBOTICS</span>
          <span className="text-slate-600">•</span>
          <span className="text-sky-400 font-semibold">ESP32 + RASPBERRY PI 5</span>
        </div>

        <div className="max-w-4xl mx-auto space-y-4">
          <h1 className="font-display font-black text-3xl sm:text-5xl lg:text-6xl tracking-tight text-white leading-[1.1]">
            Autonomous Fire Suppression for Zero-Visibility Environments
          </h1>
          <p className="text-base sm:text-lg text-slate-300 max-w-2xl mx-auto leading-relaxed font-normal">
            Where human firefighters cannot safely tread, FireBot navigates dense smoke, pinpoints thermal fire centroids through wall convection, and delivers high-pressure suppression with sub-second natural language voice control.
          </p>
        </div>

        {/* Primary CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <button
            onClick={() => {
              playSound("tab");
              onEnterConsole("live");
            }}
            className="px-6 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm tracking-wide transition-all shadow-lg shadow-red-600/25 flex items-center gap-2 cursor-pointer"
          >
            <span>Enter Tactical Live Ops</span>
            <span>→</span>
          </button>

          <button
            onClick={() => {
              playSound("tab");
              onEnterConsole("sim");
            }}
            className="px-5 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/15 text-white font-semibold text-sm transition-all flex items-center gap-2 cursor-pointer"
          >
            <span>Launch 2D SLAM Simulator</span>
            <span className="text-xs text-slate-400 font-mono">[S]</span>
          </button>

          <button
            onClick={() => {
              playSound("tab");
              onEnterConsole("mujoco");
            }}
            className="px-5 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/15 text-white font-semibold text-sm transition-all flex items-center gap-2 cursor-pointer"
          >
            <span>MuJoCo 3D Physics</span>
            <span className="text-xs text-slate-400 font-mono">[M]</span>
          </button>
        </div>

        {/* Key Engineering Metrics Ribbon */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-4xl mx-auto pt-8 border-t border-white/[0.08] text-left">
          <div className="p-4 rounded-2xl bg-slate-900/50 border border-white/10 space-y-1">
            <span className="text-[11px] font-mono text-slate-400 block uppercase tracking-wider">Natural Language SLM</span>
            <span className="font-display font-extrabold text-2xl text-white">&lt; 185 ms</span>
            <span className="text-xs text-slate-400 block">Sub-second Groq Allam/Qwen</span>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/50 border border-white/10 space-y-1">
            <span className="text-[11px] font-mono text-slate-400 block uppercase tracking-wider">Radiometric Thermal</span>
            <span className="font-display font-extrabold text-2xl text-sky-400">32 × 24 px</span>
            <span className="text-xs text-slate-400 block">FLIR MLX90640 Far-IR Array</span>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/50 border border-white/10 space-y-1">
            <span className="text-[11px] font-mono text-slate-400 block uppercase tracking-wider">Hydraulic Delivery</span>
            <span className="font-display font-extrabold text-2xl text-cyan-400">4.5 L/min</span>
            <span className="text-xs text-slate-400 block">4.2 Bar Diaphragm Pump</span>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/50 border border-white/10 space-y-1">
            <span className="text-[11px] font-mono text-slate-400 block uppercase tracking-wider">Hardware Fail-Safe</span>
            <span className="font-display font-extrabold text-2xl text-red-400">500 ms</span>
            <span className="text-xs text-slate-400 block">ESP32 Watchdog Gate Cutoff</span>
          </div>
        </div>
      </section>

      {/* 3. INTERACTIVE SMOKE PENETRATION SHOWCASE */}
      <section className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        <SmokePenetrationView />
      </section>

      {/* 4. INTERACTIVE PHYSICAL CHASSIS & WIRING MATRIX */}
      <section className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-12 space-y-8">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-mono text-sky-400 font-bold uppercase tracking-wider">
            <span>PHYSICAL HARDWARE SPECIFICATION</span>
            <span className="text-slate-600">•</span>
            <span>DUAL-COMPUTE ARCHITECTURE</span>
          </div>
          <h2 className="font-display font-bold text-2xl sm:text-3xl text-white">
            Engineered for Extreme Thermal &amp; Electrical Resilience
          </h2>
          <p className="text-sm text-slate-400 max-w-2xl">
            Select any subsystem hotspot below to inspect the real circuit pinouts, electrical rails, and communication protocols.
          </p>
        </div>

        {/* Interactive Hotspot Inspector */}
        <div className="grid lg:grid-cols-[1.2fr_1fr] gap-6 items-start">
          {/* Left: Interactive Rover Schematic Illustration */}
          <div className="rounded-2xl border border-white/10 bg-[#0A0D14] p-6 space-y-4 relative">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400 pb-2 border-b border-white/10">
              <span className="font-bold text-white">FB-01 INDUSTRIAL SCHEMATIC</span>
              <span>SCALE: 1:1 • TOP-DOWN VIEW</span>
            </div>

            {/* Vector Rover Diagram with Interactive Hotspot Pins */}
            <div className="relative aspect-[16/10] bg-slate-950/80 rounded-xl border border-white/[0.06] overflow-hidden flex items-center justify-center p-4">
              {/* Rover Body Graphic */}
              <svg viewBox="0 0 500 320" className="w-full h-full max-h-[300px]">
                {/* Left Track */}
                <rect x="70" y="40" width="80" height="240" rx="14" fill="#131824" stroke="#334155" strokeWidth="2" />
                {Array.from({ length: 9 }).map((_, i) => (
                  <line key={`lt-${i}`} x1="72" y1={55 + i * 24} x2="148" y2={55 + i * 24} stroke="#1E293B" strokeWidth="2.5" />
                ))}

                {/* Right Track */}
                <rect x="350" y="40" width="80" height="240" rx="14" fill="#131824" stroke="#334155" strokeWidth="2" />
                {Array.from({ length: 9 }).map((_, i) => (
                  <line key={`rt-${i}`} x1="352" y1={55 + i * 24} x2="428" y2={55 + i * 24} stroke="#1E293B" strokeWidth="2.5" />
                ))}

                {/* Main Aluminum Chassis */}
                <rect x="130" y="60" width="240" height="200" rx="18" fill="#0F172A" stroke="#475569" strokeWidth="2.5" />

                {/* Electronics Bay & Heatsink Fins */}
                <rect x="160" y="110" width="180" height="120" rx="8" fill="#090E17" stroke="#334155" strokeWidth="1.5" />
                <text x="250" y="150" fill="#64748B" fontSize="10" fontFamily="'Martian Mono', monospace" textAnchor="middle">DUAL COMPUTE CORE</text>
                <text x="250" y="165" fill="#38BDF8" fontSize="9" fontFamily="'Martian Mono', monospace" textAnchor="middle">ESP32 + PI 5</text>

                {/* Water Reservoir / Turret Mount */}
                <circle cx="250" cy="90" r="32" fill="#1E293B" stroke="#0284C7" strokeWidth="2" />
                <rect x="242" y="42" width="16" height="42" rx="4" fill="#EA580C" stroke="#F97316" strokeWidth="1.5" />
                <circle cx="250" cy="42" r="6" fill="#FDE047" />

                {/* FLIR Mast Sensor Pod */}
                <rect x="228" y="22" width="44" height="22" rx="6" fill="#0369A1" stroke="#38BDF8" strokeWidth="1.5" />
                <circle cx="250" cy="33" r="5" fill="#E0F2FE" />
              </svg>

              {/* Clickable Hotspots overlay */}
              {CHASSIS_HOTSPOTS.map((h) => (
                <button
                  key={h.id}
                  onClick={() => { playSound("click"); setSelectedHotspot(h); }}
                  style={{ left: `${h.x}%`, top: `${h.y}%` }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 p-2 rounded-full cursor-pointer transition-all ${
                    selectedHotspot.id === h.id
                      ? "scale-125 z-20"
                      : "hover:scale-110 opacity-80"
                  }`}
                  title={h.title}
                >
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white shadow-lg ${
                    selectedHotspot.id === h.id
                      ? "bg-sky-400 ring-4 ring-sky-400/30"
                      : "bg-slate-800 border border-white/20 hover:bg-slate-700"
                  }`}>
                    •
                  </span>
                </button>
              ))}
            </div>

            <p className="text-xs text-slate-400 font-mono text-center">
              Click the hotspots above to view specific electrical pinouts and subsystem specifications.
            </p>
          </div>

          {/* Right: Selected Subsystem Details Panel */}
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <span className="text-[10px] font-mono text-sky-400 font-bold uppercase tracking-wider bg-sky-500/10 px-2.5 py-1 rounded-md border border-sky-500/20">
                {selectedHotspot.category}
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                {selectedHotspot.badge}
              </span>
            </div>

            <h3 className="font-display font-extrabold text-xl text-white">
              {selectedHotspot.title}
            </h3>

            <p className="text-sm text-slate-300 leading-relaxed font-sans">
              {selectedHotspot.description}
            </p>

            <div className="p-3.5 rounded-xl bg-black/50 border border-white/10 space-y-1 font-mono text-xs">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Electrical &amp; Bus Topology</span>
              <span className="text-sky-400 font-semibold">{selectedHotspot.spec}</span>
            </div>

            <div className="pt-2 flex items-center justify-between">
              <a
                href="/FireBot_Hardware_and_Wiring_Specification.pdf"
                download="FireBot_Hardware_and_Wiring_Specification.pdf"
                className="text-xs text-slate-300 hover:text-white font-mono flex items-center gap-1.5 underline underline-offset-4"
              >
                <span>Full Pinout in PDF Specification</span>
                <span>→</span>
              </a>

              <button
                onClick={() => { playSound("tab"); onEnterConsole("live"); }}
                className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs uppercase tracking-wider font-mono transition-colors"
              >
                Inspect Live Telemetry
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 5. FOUR OPERATIONAL CONSOLES GRID */}
      <section className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-12 space-y-6">
        <div className="space-y-1">
          <div className="text-xs font-mono text-sky-400 font-bold uppercase tracking-wider">
            MISSION MODULES &amp; INTERFACES
          </div>
          <h2 className="font-display font-bold text-2xl sm:text-3xl text-white">
            Dedicated Command &amp; Simulation Environments
          </h2>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Tactical Console */}
          <div
            onClick={() => { playSound("tab"); onEnterConsole("live"); }}
            className="p-6 rounded-2xl border border-white/10 bg-slate-900/40 hover:bg-slate-900/80 hover:border-sky-400/40 transition-all cursor-pointer flex flex-col justify-between gap-6 group"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-2xl p-2 rounded-xl bg-slate-800 border border-white/10">🎮</span>
                <span className="text-[10px] font-mono text-slate-400 group-hover:text-sky-400 transition-colors">[L]</span>
              </div>
              <h3 className="font-display font-bold text-lg text-white group-hover:text-sky-400 transition-colors">
                Tactical Command Console
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed font-sans">
                Real-time operational cockpit with live 32×24 FLIR thermal heatmap, forward camera HUD, manual teleoperation, and E-STOP overrides.
              </p>
            </div>
            <span className="text-xs font-mono text-sky-400 font-semibold flex items-center gap-1 group-hover:translate-x-1 transition-transform">
              <span>Open Console</span>
              <span>→</span>
            </span>
          </div>

          {/* Card 2: 2D Simulator */}
          <div
            onClick={() => { playSound("tab"); onEnterConsole("sim"); }}
            className="p-6 rounded-2xl border border-white/10 bg-slate-900/40 hover:bg-slate-900/80 hover:border-emerald-400/40 transition-all cursor-pointer flex flex-col justify-between gap-6 group"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-2xl p-2 rounded-xl bg-slate-800 border border-white/10">🗺️</span>
                <span className="text-[10px] font-mono text-slate-400 group-hover:text-emerald-400 transition-colors">[S]</span>
              </div>
              <h3 className="font-display font-bold text-lg text-white group-hover:text-emerald-400 transition-colors">
                2D SLAM &amp; RRT* Simulator
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed font-sans">
                Autonomous multi-room exploration engine. Generates randomized buildings, runs RRT* obstacle avoidance, and tests voice directives.
              </p>
            </div>
            <span className="text-xs font-mono text-emerald-400 font-semibold flex items-center gap-1 group-hover:translate-x-1 transition-transform">
              <span>Launch Simulator</span>
              <span>→</span>
            </span>
          </div>

          {/* Card 3: MuJoCo 3D Physics */}
          <div
            onClick={() => { playSound("tab"); onEnterConsole("mujoco"); }}
            className="p-6 rounded-2xl border border-white/10 bg-slate-900/40 hover:bg-slate-900/80 hover:border-amber-400/40 transition-all cursor-pointer flex flex-col justify-between gap-6 group"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-2xl p-2 rounded-xl bg-slate-800 border border-white/10">🎲</span>
                <span className="text-[10px] font-mono text-slate-400 group-hover:text-amber-400 transition-colors">[M]</span>
              </div>
              <h3 className="font-display font-bold text-lg text-white group-hover:text-amber-400 transition-colors">
                MuJoCo 3D Rigid-Body
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed font-sans">
                Physics-consistent simulation across 8 semantic industrial rooms with 36-beam lidar sweeps and GPU particle fire/smoke dynamics.
              </p>
            </div>
            <span className="text-xs font-mono text-amber-400 font-semibold flex items-center gap-1 group-hover:translate-x-1 transition-transform">
              <span>Launch 3D Physics</span>
              <span>→</span>
            </span>
          </div>

          {/* Card 4: Voice Studio */}
          <div
            onClick={() => { playSound("tab"); onEnterConsole("voice"); }}
            className="p-6 rounded-2xl border border-white/10 bg-slate-900/40 hover:bg-slate-900/80 hover:border-purple-400/40 transition-all cursor-pointer flex flex-col justify-between gap-6 group"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-2xl p-2 rounded-xl bg-slate-800 border border-white/10">🎙️</span>
                <span className="text-[10px] font-mono text-slate-400 group-hover:text-purple-400 transition-colors">[V]</span>
              </div>
              <h3 className="font-display font-bold text-lg text-white group-hover:text-purple-400 transition-colors">
                Voice Studio &amp; Calibration
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed font-sans">
                Operator acoustic profiling with 192-dim ECAPA-TDNN speaker verification and personalized Whisper heads synced to Hugging Face Hub.
              </p>
            </div>
            <span className="text-xs font-mono text-purple-400 font-semibold flex items-center gap-1 group-hover:translate-x-1 transition-transform">
              <span>Open Voice Studio</span>
              <span>→</span>
            </span>
          </div>
        </div>
      </section>

      {/* 6. CLEAN FOOTER */}
      <footer className="mt-auto border-t border-white/[0.08] bg-[#0A0D14] py-8 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-300">FIREBOT PLATFORM</span>
            <span>//</span>
            <span>Engineered by Ananya Sridhar &amp; Avinandan</span>
          </div>

          <div className="flex items-center gap-4">
            <a
              href="https://github.com/darayavahoush/firebot"
              target="_blank"
              rel="noreferrer"
              className="hover:text-white transition-colors"
            >
              GitHub Repository
            </a>
            <a
              href="https://huggingface.co/anabaena/firebot-voice-intent"
              target="_blank"
              rel="noreferrer"
              className="hover:text-white transition-colors"
            >
              Hugging Face Models
            </a>
            <a
              href="/FireBot_Hardware_and_Wiring_Specification.pdf"
              download="FireBot_Hardware_and_Wiring_Specification.pdf"
              className="hover:text-white transition-colors text-sky-400"
            >
              Hardware Specification (PDF)
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
