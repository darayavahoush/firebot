import React from "react";

export const AVATAR_DEFINITIONS = {
  shield: {
    id: "shield",
    name: "Cyber Aegis",
    tagline: "Mission Commander",
    color: "#3B82F6",
    bgGradient: "from-blue-600/30 to-indigo-900/40",
    borderColor: "border-blue-500",
    renderIcon: (size = 28) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  lightning: {
    id: "lightning",
    name: "Volt Strike",
    tagline: "Rapid Teleop Pilot",
    color: "#00F0FF",
    bgGradient: "from-cyan-500/30 to-blue-900/40",
    borderColor: "border-cyan-400",
    renderIcon: (size = 28) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
  fire: {
    id: "fire",
    name: "Pyro Core",
    tagline: "Hazard Suppression",
    color: "#FF4A2B",
    bgGradient: "from-red-600/30 to-orange-950/40",
    borderColor: "border-red-500",
    renderIcon: (size = 28) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
      </svg>
    ),
  },
  hawk: {
    id: "hawk",
    name: "Apex Raptor",
    tagline: "Lidar & Recon Scout",
    color: "#10B981",
    bgGradient: "from-emerald-600/30 to-teal-950/40",
    borderColor: "border-emerald-500",
    renderIcon: (size = 28) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  gear: {
    id: "gear",
    name: "Titan Forge",
    tagline: "Robotics Systems",
    color: "#F59E0B",
    bgGradient: "from-amber-600/30 to-yellow-950/40",
    borderColor: "border-amber-500",
    renderIcon: (size = 28) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  crosshair: {
    id: "crosshair",
    name: "Target Lock",
    tagline: "Tactical Navigator",
    color: "#F0559B",
    bgGradient: "from-pink-600/30 to-purple-950/40",
    borderColor: "border-pink-500",
    renderIcon: (size = 28) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="22" y1="12" x2="18" y2="12" />
        <line x1="6" y1="12" x2="2" y2="12" />
        <line x1="12" y1="6" x2="12" y2="2" />
        <line x1="12" y1="22" x2="12" y2="18" />
      </svg>
    ),
  },
  brain: {
    id: "brain",
    name: "Synapse AI",
    tagline: "Fusion & DRL Lead",
    color: "#8B5CF6",
    bgGradient: "from-purple-600/30 to-indigo-950/40",
    borderColor: "border-purple-500",
    renderIcon: (size = 28) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04" />
        <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04" />
      </svg>
    ),
  },
  satellite: {
    id: "satellite",
    name: "Starlink Orbit",
    tagline: "Telemetry Comms",
    color: "#14B8A6",
    bgGradient: "from-teal-600/30 to-cyan-950/40",
    borderColor: "border-teal-500",
    renderIcon: (size = 28) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 10a7.5 7.5 0 0 0 10 10" />
        <path d="M4 14a3.5 3.5 0 0 0 5 5" />
        <path d="M4 6a11.5 11.5 0 0 1 15 15" />
        <circle cx="4" cy="20" r="1" />
      </svg>
    ),
  },
};

export function OperatorAvatarBadge({ avatarId = "shield", size = "md", active = false, colorOverride = null }) {
  const def = AVATAR_DEFINITIONS[avatarId] || AVATAR_DEFINITIONS.shield;
  const color = colorOverride || def.color;

  const sizeClasses = {
    sm: "w-8 h-8 rounded-lg text-[14px]",
    md: "w-11 h-11 rounded-xl text-[18px]",
    lg: "w-16 h-16 rounded-2xl text-[24px]",
    xl: "w-20 h-20 rounded-2xl text-[30px]",
  }[size] || "w-11 h-11 rounded-xl text-[18px]";

  const iconSizes = { sm: 16, md: 22, lg: 32, xl: 38 }[size] || 22;

  return (
    <div
      className={`relative shrink-0 flex items-center justify-center transition-all duration-300 ${sizeClasses} bg-gradient-to-br ${def.bgGradient} border ${
        active ? `${def.borderColor} shadow-[0_0_18px_rgba(240,85,155,0.4)] ring-2 ring-offset-2 ring-offset-base ring-${def.id}` : "border-line/60"
      }`}
      style={{
        boxShadow: active ? `0 0 20px ${color}55` : "none",
        borderColor: active ? color : undefined,
      }}
    >
      <div style={{ color }}>{def.renderIcon(iconSizes)}</div>
      {active && (
        <span
          className="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-base animate-pulse"
          style={{ backgroundColor: color }}
        />
      )}
    </div>
  );
}
