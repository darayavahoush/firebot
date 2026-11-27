/**
 * Illustration slots — the contract between the UI and the artwork.
 * Each slot is rendered by <Illustration name="…" />; the artwork lives in src/illustrations/<name>.jsx.
 * `ratio` is the CSS aspect-ratio the art must fill; `where` is where it appears.
 */
export const SLOTS = {
  "hero-rover": {
    ratio: "16 / 10",
    alt: "Firebot tracked firefighting rover with a thermal mast and spray turret",
    where: "Home page hero (pages/Home.jsx)",
  },
  "no-signal": {
    ratio: "4 / 3",
    alt: "Rover with a dashed signal arc, no connection",
    where: "Live Ops when no telemetry frame has arrived; offline states",
  },
  "empty-history": {
    ratio: "4 / 3",
    alt: "Empty run log",
    where: "Run History when there are no recorded runs (pages/History.jsx)",
  },
  "empty-log": {
    ratio: "4 / 3",
    alt: "No commands yet",
    where: "CommandLog empty state (components/CommandLog.jsx)",
  },
  "voice-studio": {
    ratio: "16 / 10",
    alt: "Operator microphone and waveform",
    where: "Voice Studio header (pages/VoiceCalibration.jsx)",
  },
  "sim-world": {
    ratio: "16 / 10",
    alt: "Top-down floor plan with a planned path and a fire marker",
    where: "2D Simulator header / loading state (pages/Simulator.jsx)",
  },
  "mujoco-3d": {
    ratio: "16 / 10",
    alt: "Isometric rover with lidar beams",
    where: "MuJoCo page header (pages/MuJoCo.jsx)",
  },
  "architecture": {
    ratio: "16 / 9",
    alt: "System diagram: sensors, state estimator, planner, actuators",
    where: "Architecture page header (pages/About.jsx)",
  },
  "error-generic": {
    ratio: "4 / 3",
    alt: "Something went wrong",
    where: "Generic error / failed-request states",
  },
};
