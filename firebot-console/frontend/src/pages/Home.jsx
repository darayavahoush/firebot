import React, { useState, useEffect, useRef } from "react";
import { PageHeader, Panel, Stat, Button, Badge, Illustration } from "../components/ui";
import { playSound } from "../lib/sound.js";

const FACTS = [
  { label: "Voice command latency", value: "< 185 ms", hint: "Natural-language intent" },
  { label: "Thermal array", value: "32 × 24", hint: "FLIR MLX90640, radiometric" },
  { label: "Water delivery", value: "4.5 L/min", hint: "12 V diaphragm pump" },
  { label: "Fail-safe watchdog", value: "500 ms", hint: "ESP32 cuts motors + pump" },
];

const PIPELINE = [
  {
    step: "01",
    title: "Sense",
    body: "A thermal camera and three flame photodiodes see through smoke. Sonar and lidar keep the rover off the walls.",
  },
  {
    step: "02",
    title: "Decide",
    body: "An information filter triangulates the fire from bearings alone, while RRT* plans a safe path to it.",
  },
  {
    step: "03",
    title: "Act",
    body: "Tracked differential drive closes in, the nozzle aims, and the pump switches on. Operators can step in by joystick or voice.",
  },
];

const DESTINATIONS = [
  { id: "live", title: "Live ops", body: "Telemetry, thermal feed and teleoperation." },
  { id: "sim", title: "2D simulator", body: "Plan, map and search in the browser." },
  { id: "mujoco", title: "3D physics", body: "Rigid-body dynamics and lidar sweep." },
  { id: "voice", title: "Voice studio", body: "Operator profiles and custom commands." },
  { id: "history", title: "Run history", body: "Past sorties, analytics and replay." },
  { id: "about", title: "Architecture", body: "Estimation, planning and hardware." },
];

const CHASSIS_HOTSPOTS = [
  {
    id: "flir",
    title: "FLIR MLX90640 Thermal Mast",
    category: "Perception",
    badge: "32 × 24 radiometric array",
    description:
      "Far-infrared sensor array with germanium optics on an SG90 pan servo. Detects thermal radiation between -40°C and +300°C through pitch-black, smoke-engulfed corridors with 55° horizontal FOV.",
    spec: "I2C 0x33 @ 400 kHz • 3.3V filtered rail • <125ms lock-on",
    x: 48,
    y: 22,
  },
  {
    id: "nozzle",
    title: "High-Pressure Suppression Turret",
    category: "Actuation",
    badge: "4.5 L/min @ 4.2 bar",
    description:
      "Brass atomization nozzle driven by a 12V diaphragm pump switched via an IRLZ44N logic-level N-channel MOSFET. Equipped with flyback diode suppression and 180° frontal pan articulation.",
    spec: "Direct 12V LiPo • 3.2A load • 1N4007 snubber diode",
    x: 68,
    y: 35,
  },
  {
    id: "compute",
    title: "Dual-Compute System (Pi 5 + ESP32)",
    category: "Processing",
    badge: "Real-time + SLAM cores",
    description:
      "Raspberry Pi 5 handles SLAM, WebSockets, Three.js telemetry, and cloud sync. ESP32 dual-core Xtensa MCU handles microsecond-level HC-SR04 sonar pulses and 20 kHz ultrasonic motor PWM with a 500ms safety watchdog.",
    spec: "UART 115,200 baud • Isolated dual-buck power (5V/3A + 5V/4A)",
    x: 45,
    y: 52,
  },
  {
    id: "tracks",
    title: "Continuous All-Terrain Tracks",
    category: "Mobility",
    badge: "Zero-radius differential",
    description:
      "Steel-reinforced rubber tread differential drive powered by high-torque DC gearmotors via a TB6612FNG H-Bridge. Provides zero-turn radius agility across debris, wet floors, and collapsed structural drywall.",
    spec: "12V motor rail • 0.60 m/s max speed • Aluminum chassis",
    x: 25,
    y: 72,
  },
  {
    id: "flame",
    title: "Tri-Zone Flame Photodiode Array",
    category: "Triangulation",
    badge: "Bearing-only EIF",
    description:
      "Three wide-angle UV/IR flame photodiode sensors positioned at -30°, 0°, and +30° relative to chassis heading. Feeds direct spatial angles into the Extended Information Filter for distance-free triangulation.",
    spec: "ESP32 ADC1 pins 25, 26, 33 • 760–1100 nm sensitivity",
    x: 78,
    y: 46,
  },
];

function SmokePenetrationView() {
  const [visionMode, setVisionMode] = useState("split"); // "split" | "thermal" | "optical"
  const [sliderPos, setSliderPos] = useState(50);
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animId;
    let t = 0;

    const render = () => {
      t += 0.03;
      const w = canvas.width;
      const h = canvas.height;

      // Dark scope background
      ctx.fillStyle = "#0C0E12";
      ctx.fillRect(0, 0, w, h);

      // Floor perspective grid lines
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 1;
      for (let i = -5; i <= 5; i++) {
        ctx.beginPath();
        ctx.moveTo(w / 2 + i * 40, h * 0.44);
        ctx.lineTo(w / 2 + i * 170, h);
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

        // Dark smoky corridor
        ctx.fillStyle = "#0E1117";
        ctx.fillRect(0, 0, w, h);

        // Faint orange glow obscured by smoke
        const faintGlow = ctx.createRadialGradient(fireX, fireY, 0, fireX, fireY, 180);
        faintGlow.addColorStop(0, "rgba(232, 89, 12, 0.22)");
        faintGlow.addColorStop(0.5, "rgba(180, 83, 9, 0.06)");
        faintGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = faintGlow;
        ctx.fillRect(0, 0, w, h);

        // Billowing volumetric smoke particles
        for (let i = 0; i < 22; i++) {
          const px = ((i * 39 + t * 40) % (w + 120)) - 60;
          const py = h * 0.32 + Math.sin(t * 0.8 + i) * 75 + (i % 5) * 32;
          const radius = 60 + (i % 4) * 26;
          const smokeGrad = ctx.createRadialGradient(px, py, 0, px, py, radius);
          smokeGrad.addColorStop(0, "rgba(24, 28, 38, 0.90)");
          smokeGrad.addColorStop(0.65, "rgba(16, 20, 30, 0.65)");
          smokeGrad.addColorStop(1, "rgba(12, 14, 18, 0)");
          ctx.fillStyle = smokeGrad;
          ctx.beginPath();
          ctx.arc(px, py, radius, 0, Math.PI * 2);
          ctx.fill();
        }

        // Overlay Label
        ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
        ctx.font = "12px sans-serif";
        ctx.fillText("Optical camera (zero visibility in smoke)", 20, 32);
        ctx.restore();
      };

      // ---- LAYER B: FLIR RADIOMETRIC THERMAL (Smoke Pierced) ----
      const drawThermal = (clipX, clipWidth) => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(clipX, 0, clipWidth, h);
        ctx.clip();

        // Thermal Ironbow Base Chamber
        ctx.fillStyle = "#0A0D18";
        ctx.fillRect(0, 0, w, h);

        // Thermal floor gradient
        const floorGrad = ctx.createLinearGradient(0, h * 0.44, 0, h);
        floorGrad.addColorStop(0, "#0F1428");
        floorGrad.addColorStop(1, "#181335");
        ctx.fillStyle = floorGrad;
        ctx.fillRect(0, h * 0.44, w, h * 0.56);

        // Radiometric Fire Heat Signature
        const heatPulse = Math.sin(t * 3.2) * 5;
        const fireHeat = ctx.createRadialGradient(fireX, fireY, 3, fireX, fireY, 115 + heatPulse);
        fireHeat.addColorStop(0, "#FFFBEB"); // White-hot core (~800°C)
        fireHeat.addColorStop(0.18, "#FEF08A"); // Pale yellow
        fireHeat.addColorStop(0.42, "#F97316"); // Vivid orange plume
        fireHeat.addColorStop(0.72, "#C026D3"); // Magenta thermal gradient
        fireHeat.addColorStop(0.92, "#0E7C7B"); // Teal thermal boundary
        fireHeat.addColorStop(1, "transparent");

        ctx.fillStyle = fireHeat;
        ctx.beginPath();
        ctx.arc(fireX, fireY, 115 + heatPulse, 0, Math.PI * 2);
        ctx.fill();

        // Radiometric Pixel Grid Texture (MLX90640 signature)
        ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
        ctx.lineWidth = 1;
        const cellSize = 18;
        for (let gx = 0; gx < w; gx += cellSize) {
          ctx.beginPath();
          ctx.moveTo(gx, 0);
          ctx.lineTo(gx, h);
          ctx.stroke();
        }
        for (let gy = 0; gy < h; gy += cellSize) {
          ctx.beginPath();
          ctx.moveTo(0, gy);
          ctx.lineTo(w, gy);
          ctx.stroke();
        }

        // Reticle on Fire Centroid
        ctx.strokeStyle = "#E8590C";
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        ctx.arc(fireX, fireY, 26, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(fireX - 38, fireY);
        ctx.lineTo(fireX - 10, fireY);
        ctx.moveTo(fireX + 10, fireY);
        ctx.lineTo(fireX + 38, fireY);
        ctx.moveTo(fireX, fireY - 38);
        ctx.lineTo(fireX, fireY - 10);
        ctx.moveTo(fireX, fireY + 10);
        ctx.lineTo(fireX, fireY + 38);
        ctx.stroke();

        // Data tag
        ctx.fillStyle = "rgba(15, 17, 20, 0.88)";
        ctx.fillRect(fireX + 32, fireY - 26, 142, 46);
        ctx.strokeStyle = "rgba(232, 89, 12, 0.6)";
        ctx.strokeRect(fireX + 32, fireY - 26, 142, 46);

        ctx.fillStyle = "#FB7832";
        ctx.font = "600 11px sans-serif";
        ctx.fillText("FLIR THERMAL LOCK", fireX + 40, fireY - 10);
        ctx.fillStyle = "#ECEEF1";
        ctx.font = "10px monospace";
        ctx.fillText("Peak: 814.2°C", fireX + 40, fireY + 4);
        ctx.fillText("Bearing: +18.4°", fireX + 40, fireY + 16);

        // Overlay Label
        ctx.fillStyle = "#34BEBA";
        ctx.font = "600 12px sans-serif";
        ctx.fillText("FLIR radiometric thermal (32×24 array)", Math.max(clipX + 20, 20), 32);
        ctx.restore();
      };

      if (visionMode === "optical") {
        drawOptical(w);
      } else if (visionMode === "thermal") {
        drawThermal(0, w);
      } else {
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

        // Divider handle
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.arc(splitX, h / 2, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#16181D";
        ctx.font = "bold 9px sans-serif";
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
    <Panel
      title="Optical smoke vs. FLIR thermal penetration"
      actions={
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              playSound("tab");
              setVisionMode("split");
            }}
            className={`btn !py-1 !px-2.5 text-[12px] ${visionMode === "split" ? "bg-panel2 font-semibold" : ""}`}
          >
            Split view
          </button>
          <button
            type="button"
            onClick={() => {
              playSound("tab");
              setVisionMode("thermal");
            }}
            className={`btn !py-1 !px-2.5 text-[12px] ${visionMode === "thermal" ? "btn-primary !py-1 !px-2.5 text-[12px]" : ""}`}
          >
            Thermal only
          </button>
          <button
            type="button"
            onClick={() => {
              playSound("tab");
              setVisionMode("optical");
            }}
            className={`btn !py-1 !px-2.5 text-[12px] ${visionMode === "optical" ? "bg-panel2 font-semibold" : ""}`}
          >
            Optical only
          </button>
        </div>
      }
    >
      <div className="p-4 space-y-3">
        <div className="relative rounded-lg overflow-hidden border border-line bg-scope aspect-[16/9] max-h-[420px]">
          <canvas ref={canvasRef} width={800} height={450} className="w-full h-full block" />
          {visionMode === "split" && (
            <input
              type="range"
              min="5"
              max="95"
              value={sliderPos}
              onChange={(e) => setSliderPos(Number(e.target.value))}
              className="absolute inset-x-4 bottom-3 z-20 accent-telemetry cursor-ew-resize opacity-80 hover:opacity-100 transition-opacity"
              aria-label="Drag to compare optical smoke vs thermal penetration"
            />
          )}
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between text-[12px] text-muted gap-2 pt-0.5">
          <span>Drag the slider to observe how long-wave infrared radiation pierces dense particulate matter.</span>
          <span className="text-telemetry font-medium shrink-0">Wavelength: 8–14 µm LWIR</span>
        </div>
      </div>
    </Panel>
  );
}

function ChassisInspectionView({ onEnterConsole }) {
  const [selectedHotspot, setSelectedHotspot] = useState(CHASSIS_HOTSPOTS[0]);
  const [viewMode, setViewMode] = useState("photo"); // "photo" | "schematic"

  return (
    <Panel
      title="Physical chassis subsystems & wiring topology"
      actions={
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              playSound("tab");
              setViewMode("photo");
            }}
            className={`btn !py-1 !px-2.5 text-[12px] ${viewMode === "photo" ? "bg-panel2 font-semibold" : ""}`}
          >
            Chassis photo
          </button>
          <button
            type="button"
            onClick={() => {
              playSound("tab");
              setViewMode("schematic");
            }}
            className={`btn !py-1 !px-2.5 text-[12px] ${viewMode === "schematic" ? "bg-panel2 font-semibold" : ""}`}
          >
            CAD schematic
          </button>
        </div>
      }
    >
      <div className="p-4 sm:p-5 grid lg:grid-cols-12 gap-5 items-start">
        {/* Left: Interactive Diagram / Photo with Hotspots */}
        <div className="lg:col-span-7 space-y-3">
          <div className="relative aspect-[16/10] bg-scope rounded-lg border border-line overflow-hidden flex items-center justify-center">
            {viewMode === "photo" ? (
              <img
                src="/firebot-rover-detail.jpg"
                alt="Firebot physical chassis assembly detail"
                className="w-full h-full object-cover"
              />
            ) : (
              <svg viewBox="0 0 500 320" className="w-full h-full max-h-[300px] p-4" fill="none">
                {/* Left Track */}
                <rect x="70" y="40" width="80" height="240" rx="14" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink) / 0.7)" strokeWidth="2" />
                {Array.from({ length: 9 }).map((_, i) => (
                  <line key={`lt-${i}`} x1="72" y1={55 + i * 24} x2="148" y2={55 + i * 24} stroke="rgb(var(--c-line2))" strokeWidth="2" />
                ))}

                {/* Right Track */}
                <rect x="350" y="40" width="80" height="240" rx="14" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink) / 0.7)" strokeWidth="2" />
                {Array.from({ length: 9 }).map((_, i) => (
                  <line key={`rt-${i}`} x1="352" y1={55 + i * 24} x2="428" y2={55 + i * 24} stroke="rgb(var(--c-line2))" strokeWidth="2" />
                ))}

                {/* Main Aluminum Chassis */}
                <rect x="130" y="60" width="240" height="200" rx="18" fill="rgb(var(--c-panel))" stroke="rgb(var(--c-ink))" strokeWidth="2" />

                {/* Electronics Bay */}
                <rect x="160" y="110" width="180" height="120" rx="8" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-line2))" strokeWidth="1.5" />

                {/* Suppression Turret Mount */}
                <circle cx="250" cy="90" r="32" fill="rgb(var(--c-panel))" stroke="rgb(var(--c-flame))" strokeWidth="2" />
                <rect x="242" y="42" width="16" height="42" rx="4" fill="rgb(var(--c-flame))" stroke="rgb(var(--c-ink))" strokeWidth="1.5" />
                <circle cx="250" cy="42" r="5" fill="rgb(var(--c-telemetry))" />

                {/* FLIR Mast Sensor Pod */}
                <rect x="228" y="22" width="44" height="22" rx="6" fill="rgb(var(--c-panel))" stroke="rgb(var(--c-telemetry))" strokeWidth="1.5" />
                <circle cx="250" cy="33" r="5" fill="rgb(var(--c-telemetry))" />
              </svg>
            )}

            {/* Clickable Hotspots overlay */}
            {CHASSIS_HOTSPOTS.map((h) => {
              const active = selectedHotspot.id === h.id;
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => {
                    playSound("click");
                    setSelectedHotspot(h);
                  }}
                  style={{ left: `${h.x}%`, top: `${h.y}%` }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 p-2 rounded-full cursor-pointer transition-transform ${
                    active ? "scale-125 z-20" : "hover:scale-110 opacity-85"
                  }`}
                  aria-label={h.title}
                  title={h.title}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold shadow-md transition-colors ${
                      active
                        ? "bg-flame text-white ring-4 ring-flame/30"
                        : "bg-panel text-ink border border-line2 hover:border-flame"
                    }`}
                  >
                    •
                  </span>
                </button>
              );
            })}
          </div>

          {/* Hotspots Quick Switcher Chips */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {CHASSIS_HOTSPOTS.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => {
                  playSound("click");
                  setSelectedHotspot(h);
                }}
                className={`chip text-[12px] transition-colors ${
                  selectedHotspot.id === h.id
                    ? "!bg-flame/15 !text-flame !border-flame/30 font-medium"
                    : "hover:bg-panel2"
                }`}
              >
                {h.title}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Subsystem Inspector Card */}
        <div className="lg:col-span-5 panel bg-panel2/50 p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-line">
            <Badge tone="info">{selectedHotspot.category}</Badge>
            <span className="text-[12px] text-muted">{selectedHotspot.badge}</span>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-[17px] font-semibold text-ink leading-snug">{selectedHotspot.title}</h3>
            <p className="text-[13px] text-muted leading-relaxed">{selectedHotspot.description}</p>
          </div>

          <div className="p-3 rounded-lg bg-panel border border-line space-y-1">
            <div className="panel-eyebrow text-[10px]">Electrical &amp; bus topology</div>
            <div className="data text-[12px] text-telemetry font-medium break-all">{selectedHotspot.spec}</div>
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
            <a
              href="/FireBot_Hardware_and_Wiring_Specification.pdf"
              download="FireBot_Hardware_and_Wiring_Specification.pdf"
              className="text-[12.5px] text-muted hover:text-ink flex items-center gap-1 underline underline-offset-4"
            >
              Wiring PDF specification →
            </a>
            <Button
              variant="primary"
              onClick={() => {
                playSound("tab");
                onEnterConsole("live");
              }}
              className="!py-1.5 !px-3 text-[12px]"
            >
              Inspect live telemetry
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function HeroVideoBanner({ onEnterConsole, online }) {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [viewMode, setViewMode] = useState("video"); // "video" | "blueprint"

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => {
        setIsPlaying(false);
      });
    }
  }, []);

  const togglePlay = () => {
    playSound("click");
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  return (
    <div className="relative w-full rounded-2xl md:rounded-3xl overflow-hidden border border-line bg-[#0A0C10] text-white shadow-2xl">
      {/* Background Media Layer */}
      {viewMode === "video" ? (
        <div className="absolute inset-0 overflow-hidden">
          <video
            ref={videoRef}
            src="/footage.mp4"
            poster="/firebot-hero.jpg"
            autoPlay
            loop
            muted
            playsInline
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            className="w-full h-full object-cover scale-[1.03] opacity-80 transition-opacity duration-700"
          />
        </div>
      ) : (
        <div className="absolute inset-0 bg-[#0F1218] flex items-center justify-center p-8">
          <Illustration name="hero-rover" className="w-full max-h-[360px] opacity-90" />
        </div>
      )}

      {/* Atmospheric Overlays & Scrims */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(10, 12, 16, 0.75) 0%, rgba(10, 12, 16, 0.4) 40%, rgba(10, 12, 16, 0.85) 80%, rgba(10, 12, 16, 0.98) 100%)",
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none hidden md:block"
        style={{
          background:
            "radial-gradient(circle at 75% 35%, rgba(232, 89, 12, 0.12) 0%, transparent 60%)",
        }}
      />
      {/* Subtle Engineering Grid Overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255, 255, 255, 0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(255, 255, 255, 0.08) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* Interactive Hero Content Container */}
      <div className="relative z-10 flex flex-col justify-between min-h-[500px] md:min-h-[560px] p-6 sm:p-8 md:p-12 pb-0 sm:pb-0 md:pb-0">
        {/* Top HUD Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono tracking-wider">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-white/90">
            <span className={`w-2 h-2 rounded-full ${online ? "bg-emerald-400" : "bg-flame"} animate-pulse`} />
            <span className="font-semibold text-orange-400">FB-01</span>
            <span className="text-white/40">/</span>
            <span>AUTONOMOUS FIREFIGHTING ROVER</span>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Switcher */}
            <div className="flex items-center bg-black/50 backdrop-blur-md rounded-lg p-0.5 border border-white/15">
              <button
                type="button"
                onClick={() => {
                  playSound("tab");
                  setViewMode("video");
                }}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  viewMode === "video" ? "bg-white/20 text-white" : "text-white/60 hover:text-white"
                }`}
              >
                Sortie Video
              </button>
              <button
                type="button"
                onClick={() => {
                  playSound("tab");
                  setViewMode("blueprint");
                }}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  viewMode === "blueprint" ? "bg-white/20 text-white" : "text-white/60 hover:text-white"
                }`}
              >
                Schematic
              </button>
            </div>

            {/* Video Play/Pause toggle */}
            {viewMode === "video" && (
              <button
                type="button"
                onClick={togglePlay}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/50 backdrop-blur-md border border-white/15 text-white/80 hover:text-white transition-colors"
                title={isPlaying ? "Pause Video" : "Play Video"}
              >
                {isPlaying ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    <span>REC 1080P</span>
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    <span>PAUSED</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Center Typography & CTAs */}
        <div className="my-8 md:my-10 max-w-[760px] space-y-4">
          <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-teal-300">
            <span>FLIR LWIR Perception</span>
            <span className="text-white/40">•</span>
            <span>Bearing-Only EIF</span>
            <span className="text-white/40">•</span>
            <span>4.5 L/min Suppression</span>
          </div>

          <h1 className="text-3xl sm:text-5xl md:text-6xl font-semibold tracking-tight leading-[1.08] text-white">
            Find the fire.{" "}
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-orange-400 via-amber-300 to-teal-200">
              Put it out.
            </span>
          </h1>

          <p className="text-sm sm:text-base md:text-[17px] text-white/80 leading-relaxed font-normal max-w-[62ch]">
            Firebot pierces dense zero-visibility smoke using 32×24 radiometric thermal computer vision, triangulates fire bearings autonomously, and deploys high-pressure suppression with real-time teleoperation fallback.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button
              variant="primary"
              onClick={() => {
                playSound("tab");
                onEnterConsole("live");
              }}
              className="!py-2.5 !px-5 text-[14px] !bg-flame hover:!bg-flame/90 text-white font-medium shadow-lg shadow-orange-500/25 border-0"
            >
              Launch Live Ops →
            </Button>
            <Button
              onClick={() => {
                playSound("tab");
                onEnterConsole("sim");
              }}
              className="!py-2.5 !px-5 text-[14px] !bg-white/10 hover:!bg-white/20 !text-white !border-white/20 backdrop-blur-md font-medium"
            >
              Open 2D Simulator
            </Button>
            <button
              type="button"
              onClick={() => {
                playSound("tab");
                const el = document.getElementById("how-it-works-panel");
                if (el) el.scrollIntoView({ behavior: "smooth" });
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-[13px] text-white/70 hover:text-white transition-colors"
            >
              <span>Explore Architecture ↓</span>
            </button>
          </div>
        </div>

        {/* Bottom Dock: Integrated Live Telemetry Specs Strip */}
        <div className="border-t border-white/10 bg-black/60 backdrop-blur-md -mx-6 sm:-mx-8 md:-mx-12 p-4 sm:p-6 grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {FACTS.map((f) => (
            <div key={f.label} className="space-y-0.5">
              <div className="text-[11px] font-mono uppercase tracking-wider text-white/50">{f.label}</div>
              <div className="text-xl sm:text-2xl font-bold font-mono text-white tracking-tight">{f.value}</div>
              <div className="text-[12px] text-white/40">{f.hint}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Home({ onEnterConsole, frame, linkOk }) {
  const online = !!frame && linkOk;

  return (
    <main className="flex-1 min-w-0 p-6 space-y-6 max-w-[1200px] w-full mx-auto">
      <HeroVideoBanner onEnterConsole={onEnterConsole} online={online} />

      <div id="how-it-works-panel">
        <Panel
          title="How it works"
          actions={
            <Badge tone={online ? "ok" : "neutral"} dot>
              {online ? "Robot online" : "Robot offline"}
            </Badge>
          }
          bodyClassName="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-line"
        >
          {PIPELINE.map((p) => (
            <div key={p.step} className="p-5 space-y-2">
              <div className="data text-[12px] text-flame font-semibold">{p.step}</div>
              <h3 className="text-[16px] font-semibold">{p.title}</h3>
              <p className="text-[13.5px] text-muted leading-relaxed">{p.body}</p>
            </div>
          ))}
        </Panel>
      </div>

      {/* Ported from Home.legacy: Optical vs Thermal Smoke Demonstration */}
      <SmokePenetrationView />

      {/* Ported from Home.legacy: Interactive Chassis Inspection */}
      <ChassisInspectionView onEnterConsole={onEnterConsole} />

      <section aria-label="Where to next">
        <h2 className="panel-eyebrow mb-3">Where to next</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {DESTINATIONS.map((d) => (
            <button
              key={d.id}
              onClick={() => onEnterConsole(d.id)}
              className="panel text-left px-4 py-4 transition-colors hover:border-line2 hover:bg-panel2/60"
            >
              <div className="text-[14.5px] font-semibold">{d.title}</div>
              <div className="text-[13px] text-muted mt-0.5">{d.body}</div>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
