// three.js view of a MuJoCo-backed episode. Sim coordinates are used as-is (x, y on the floor,
// z up), so the camera's up-vector is +z. The server streams scene geometry once and small
// per-tick frames; this class turns them into meshes and animates the rover.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const FLOOR = {
  office: 0x6b4a32,
  storage: 0x5b5f66,
  workshop: 0x3b6f78,
  atrium: 0x2f6b3a,
  datacenter: 0x1a2936,
  hazmat_lab: 0x6e6328,
  control_room: 0x27313f,
};

const PROP = {
  table: 0x8a5a34,
  shelf: 0x9aa3ad,
  crate: 0xb98a4e,
  barrel: 0xb5452e,
  shrub: 0x2f8f4a,
  tree: 0x6b4a2b,
  pillar: 0x8a8f96,
  column: 0x7a8088,
  server_rack: 0x1f2733,
  generator: 0x3b4452,
  gas_cylinder: 0xd4a520,
  pallet: 0x967245,
  console: 0x252e3b,
  bench: 0x735538,
};

const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...o });

function createHeatmapTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255, 255, 230, 0.95)");
  g.addColorStop(0.2, "rgba(255, 175, 40, 0.85)");
  g.addColorStop(0.5, "rgba(235, 45, 25, 0.5)");
  g.addColorStop(0.8, "rgba(130, 15, 70, 0.2)");
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

function createSoftDiscTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255, 255, 255, 1)");
  g.addColorStop(0.4, "rgba(240, 240, 240, 0.6)");
  g.addColorStop(0.8, "rgba(200, 200, 200, 0.15)");
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function createRoomTexture(kind) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");

  if (kind === "datacenter") {
    // High-tech server room floor tiles with underfloor LED conduit glow
    ctx.fillStyle = "#121a24";
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = "#1b2736";
    ctx.lineWidth = 3;
    for (let i = 0; i <= 256; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0); ctx.lineTo(i, 256);
      ctx.moveTo(0, i); ctx.lineTo(256, i);
      ctx.stroke();
    }
    // Perforated vent pattern
    ctx.fillStyle = "#16202c";
    for (let x = 8; x < 256; x += 64) {
      for (let y = 8; y < 256; y += 64) {
        ctx.fillRect(x + 4, y + 4, 48, 48);
      }
    }
    // Glowing cyan intersection nodes
    ctx.fillStyle = "#00d4ff";
    ctx.shadowColor = "#00f0ff";
    ctx.shadowBlur = 8;
    for (let x = 64; x < 256; x += 64) {
      for (let y = 64; y < 256; y += 64) {
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.shadowBlur = 0;
  } else if (kind === "hazmat_lab") {
    // High-gloss sterile laboratory epoxy with hazard perimeter warning stripes
    ctx.fillStyle = "#e9edf2";
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = "#d0d7e2";
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, 126, 126);
    ctx.strokeRect(130, 2, 124, 126);
    ctx.strokeRect(2, 130, 126, 124);
    ctx.strokeRect(130, 130, 124, 124);

    ctx.save();
    ctx.strokeStyle = "#d69e2e";
    ctx.lineWidth = 6;
    for (let i = -256; i < 512; i += 28) {
      ctx.beginPath();
      ctx.moveTo(i, 0); ctx.lineTo(i + 20, 20);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i, 236); ctx.lineTo(i + 20, 256);
      ctx.stroke();
    }
    ctx.restore();
  } else if (kind === "control_room") {
    // Tactical command center dark slate panels with illuminated telemetry traces
    ctx.fillStyle = "#1a222e";
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = "#253245";
    ctx.lineWidth = 2;
    for (let x = 0; x < 256; x += 64) {
      for (let y = 0; y < 256; y += 64) {
        ctx.strokeRect(x + 2, y + 2, 60, 60);
      }
    }
    ctx.strokeStyle = "#00b4d8";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 128); ctx.lineTo(64, 128); ctx.lineTo(96, 160); ctx.lineTo(256, 160);
    ctx.moveTo(160, 0); ctx.lineTo(160, 96); ctx.lineTo(192, 128); ctx.lineTo(192, 256);
    ctx.stroke();
  } else if (kind === "workshop") {
    // Industrial steel tread plate with diamond pattern
    ctx.fillStyle = "#333b47";
    ctx.fillRect(0, 0, 256, 256);

    ctx.fillStyle = "#4a5568";
    const drawDiamond = (cx, cy, angle) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(0, 0, 9, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    for (let x = 16; x < 256; x += 32) {
      for (let y = 16; y < 256; y += 32) {
        drawDiamond(x, y, Math.PI / 4);
        drawDiamond(x + 16, y + 16, -Math.PI / 4);
      }
    }
  } else if (kind === "storage") {
    // Sealed logistics slab with yellow forklift aisle guide dashes
    ctx.fillStyle = "#424852";
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = "#2d333b";
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, 252, 252);
    ctx.beginPath();
    ctx.moveTo(128, 0); ctx.lineTo(128, 256);
    ctx.stroke();

    ctx.fillStyle = "#eab308";
    for (let y = 12; y < 256; y += 40) {
      ctx.fillRect(8, y, 10, 22);
      ctx.fillRect(238, y, 10, 22);
    }
  } else if (kind === "office") {
    // Warm parquet hardwood planks
    ctx.fillStyle = "#6d4c33";
    ctx.fillRect(0, 0, 256, 256);

    for (let bx = 0; bx < 4; bx++) {
      for (let by = 0; by < 4; by++) {
        const isHoriz = (bx + by) % 2 === 0;
        const ox = bx * 64;
        const oy = by * 64;

        ctx.strokeStyle = "#4e3522";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(ox, oy, 64, 64);

        for (let p = 0; p < 4; p++) {
          const shade = ((bx * 7 + by * 13 + p * 19) % 35) - 17;
          ctx.fillStyle = `rgb(${109 + shade}, ${76 + Math.round(shade * 0.7)}, ${51 + Math.round(shade * 0.5)})`;
          if (isHoriz) {
            ctx.fillRect(ox + 1, oy + p * 16 + 1, 62, 14);
          } else {
            ctx.fillRect(ox + p * 16 + 1, oy + 1, 14, 62);
          }
        }
      }
    }
  } else if (kind === "atrium") {
    // Terrazzo marble with polished brass inlays
    ctx.fillStyle = "#e3e8ee";
    ctx.fillRect(0, 0, 256, 256);

    const speckles = ["#b0bac6", "#8d9ba8", "#cfd7df", "#707d8a"];
    for (let i = 0; i < 180; i++) {
      ctx.fillStyle = speckles[i % speckles.length];
      const rx = (i * 73) % 256;
      const ry = (i * 137) % 256;
      const rw = 2 + (i % 4);
      const rh = 2 + ((i + 2) % 3);
      ctx.fillRect(rx, ry, rw, rh);
    }

    ctx.strokeStyle = "#c69c4e";
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, 256, 256);
    ctx.beginPath();
    ctx.moveTo(128, 0); ctx.lineTo(128, 256);
    ctx.moveTo(0, 128); ctx.lineTo(256, 128);
    ctx.stroke();
  } else {
    ctx.fillStyle = "#3a414e";
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = "#2b313c";
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, 256, 256);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createGroundTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext("2d");

  // Dark asphalt tarmac
  ctx.fillStyle = "#14171e";
  ctx.fillRect(0, 0, 512, 512);

  // Speckled asphalt aggregate grain
  for (let i = 0; i < 400; i++) {
    const rx = (i * 89) % 512;
    const ry = (i * 193) % 512;
    ctx.fillStyle = (i % 2 === 0) ? "#1f242d" : "#0e1015";
    ctx.fillRect(rx, ry, 2, 2);
  }

  // Perimeter parking and road border
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, 496, 496);

  // Yellow corridor center safety dashes
  ctx.strokeStyle = "rgba(234, 179, 8, 0.5)";
  ctx.lineWidth = 4;
  ctx.setLineDash([24, 24]);
  ctx.beginPath();
  ctx.moveTo(256, 0); ctx.lineTo(256, 512);
  ctx.moveTo(0, 256); ctx.lineTo(512, 256);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createScorchTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");

  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 120);
  g.addColorStop(0, "rgba(10, 10, 12, 0.95)");
  g.addColorStop(0.35, "rgba(25, 22, 20, 0.85)");
  g.addColorStop(0.65, "rgba(60, 45, 35, 0.45)");
  g.addColorStop(0.88, "rgba(90, 70, 50, 0.15)");
  g.addColorStop(1, "rgba(0, 0, 0, 0)");

  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);

  // Carbon ash soot flecks
  ctx.fillStyle = "rgba(15, 12, 10, 0.7)";
  for (let i = 0; i < 90; i++) {
    const angle = i * 2.399;
    const r = Math.sqrt(i / 90) * 110;
    const x = 128 + Math.cos(angle) * r;
    const y = 128 + Math.sin(angle) * r;
    ctx.beginPath();
    ctx.arc(x, y, 1.5 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }

  return new THREE.CanvasTexture(c);
}

function createFoliageTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");

  // Deep forest green base
  ctx.fillStyle = "#1e3d29";
  ctx.fillRect(0, 0, 256, 256);

  // Variegated leafy mottling and leaf shape silhouettes
  const greens = ["#265337", "#2d6342", "#183321", "#36754e", "#1b3d27", "#44895c"];
  for (let i = 0; i < 600; i++) {
    ctx.fillStyle = greens[i % greens.length];
    const x = (i * 97) % 256;
    const y = (i * 151) % 256;
    const r = 3 + (i % 6);
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.6, i * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Dappled leaf highlights
  ctx.fillStyle = "rgba(100, 180, 110, 0.25)";
  for (let i = 0; i < 120; i++) {
    const x = (i * 179) % 256;
    const y = (i * 223) % 256;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createBarkTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");

  // Dark timber base
  ctx.fillStyle = "#382417";
  ctx.fillRect(0, 0, 256, 256);

  // Vertical furrowed bark grooves
  for (let x = 0; x < 256; x += 4) {
    const tone = 30 + Math.sin(x * 0.3) * 15 + ((x * 17) % 20);
    ctx.fillStyle = `rgb(${tone + 25}, ${tone + 8}, ${Math.max(10, tone - 5)})`;
    ctx.fillRect(x, 0, 3 + (x % 3), 256);
  }

  // Bark striations
  ctx.strokeStyle = "rgba(25, 14, 8, 0.6)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 40; i++) {
    const x = (i * 37) % 256;
    const y = (i * 59) % 256;
    ctx.beginPath();
    ctx.ellipse(x, y, 4, 18, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export default class MujocoScene {
  constructor(canvasHost) {
    this.host = canvasHost;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x0a0714);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;

    this.host.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0a0714, 30, 80);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    // Atmospheric lighting with realistic shadows
    this.hemiLight = new THREE.HemisphereLight(0xe5edff, 0x221832, 0.85);
    this.scene.add(this.hemiLight);

    this.sun = new THREE.DirectionalLight(0xfff5ea, 1.25);
    this.sun.position.set(12, 10, 18);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.width = 2048;
    this.sun.shadow.mapSize.height = 2048;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.world = new THREE.Group();
    this.scene.add(this.world);

    // Visual layer flags
    this.showLidar = true;
    this.showPath = true;
    this.showParticles = true;
    this.showSensors = true;
    this.showHeatmap = true;

    this.cameraMode = "orbit";
    this.target = { x: 0, y: 0, th: 0, turret: 0 };
    this.trail = [];
    this.animatedLeds = [];
    this.lastFrameTime = performance.now();

    this.softTexture = createSoftDiscTexture();
    this.heatTexture = createHeatmapTexture();
    this.groundTexture = createGroundTexture();
    this.scorchTexture = createScorchTexture();
    this.foliageTexture = createFoliageTexture();
    this.barkTexture = createBarkTexture();
    this.roomTextures = {};
    for (const k of ["office", "storage", "workshop", "atrium", "datacenter", "hazmat_lab", "control_room"]) {
      this.roomTextures[k] = createRoomTexture(k);
    }

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(this.host);
    this.resize();
    this._raf = requestAnimationFrame(() => this.loop());
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
    this.controls.dispose();
    this.softTexture.dispose();
    this.heatTexture.dispose();
    this.groundTexture.dispose();
    this.scorchTexture.dispose();
    this.foliageTexture.dispose();
    this.barkTexture.dispose();
    if (this.roomTextures) {
      for (const t of Object.values(this.roomTextures)) t.dispose();
    }
    this.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  clear() {
    this.world.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) [].concat(o.material).forEach((m) => m.dispose());
    });
    this.world.clear();
    this.trail = [];
    this.animatedLeds = [];
  }

  // ---- static scene ----------------------------------------------------------------------
  load(sc) {
    this.clear();
    this.sc = sc;
    const { width: W, height: H, wall_height: WH } = sc;
    const maxDim = Math.max(W, H);

    // Adjust sun shadows to encompass the episode space
    if (this.sun) {
      this.sun.position.set(W * 0.35, -H * 0.25, 18);
      this.sun.target.position.set(W / 2, H / 2, 0);
      this.sun.shadow.camera.left = -maxDim * 0.8;
      this.sun.shadow.camera.right = maxDim * 0.8;
      this.sun.shadow.camera.top = maxDim * 0.8;
      this.sun.shadow.camera.bottom = -maxDim * 0.8;
      this.sun.shadow.camera.near = 1;
      this.sun.shadow.camera.far = 60;
      this.sun.shadow.camera.updateProjectionMatrix();
    }

    // Exterior Ground plane with realistic tarmac texture
    const groundTex = this.groundTexture.clone();
    groundTex.needsUpdate = true;
    groundTex.wrapS = THREE.RepeatWrapping;
    groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(Math.max(2, Math.round((W + 24) / 4)), Math.max(2, Math.round((H + 24) / 4)));
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(W + 24, H + 24),
      new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.9, metalness: 0.1 })
    );
    ground.receiveShadow = true;
    ground.position.set(W / 2, H / 2, -0.01);
    this.world.add(ground);

    // Architectural Floor Rooms with procedural materials
    for (const r of sc.rooms || []) {
      const tex = this.roomTextures[r.kind] || this.roomTextures.workshop;
      const roomTex = tex.clone();
      roomTex.needsUpdate = true;
      roomTex.wrapS = THREE.RepeatWrapping;
      roomTex.wrapT = THREE.RepeatWrapping;
      roomTex.repeat.set(Math.max(1, Math.round(r.w / 1.5)), Math.max(1, Math.round(r.h / 1.5)));

      const roughness = r.kind === "hazmat_lab" ? 0.25 : (r.kind === "datacenter" ? 0.4 : 0.75);
      const metalness = r.kind === "workshop" ? 0.6 : (r.kind === "datacenter" ? 0.45 : 0.08);

      const f = new THREE.Mesh(
        new THREE.PlaneGeometry(r.w, r.h),
        new THREE.MeshStandardMaterial({ map: roomTex, roughness, metalness })
      );
      f.receiveShadow = true;
      f.position.set(r.x + r.w / 2, r.y + r.h / 2, 0);
      this.world.add(f);

      // Distinct architectural room border line
      const borderGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-r.w / 2, -r.h / 2, 0.003),
        new THREE.Vector3(r.w / 2, -r.h / 2, 0.003),
        new THREE.Vector3(r.w / 2, r.h / 2, 0.003),
        new THREE.Vector3(-r.w / 2, r.h / 2, 0.003),
        new THREE.Vector3(-r.w / 2, -r.h / 2, 0.003),
      ]);
      const border = new THREE.Line(borderGeom, new THREE.LineBasicMaterial({ color: 0x1f2733, transparent: true, opacity: 0.6 }));
      border.position.set(r.x + r.w / 2, r.y + r.h / 2, 0);
      this.world.add(border);
    }

    // Architectural Walls with Solid Core, Baseboard Skirting, and Crown Cap Trim
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x3d4654,
      roughness: 0.72,
      metalness: 0.12,
    });
    const baseboardMat = new THREE.MeshStandardMaterial({
      color: 0x161a22,
      roughness: 0.5,
      metalness: 0.35,
    });
    const crownMat = new THREE.MeshStandardMaterial({
      color: 0x687486,
      roughness: 0.4,
      metalness: 0.6,
    });

    for (const [x, y, w, h] of sc.walls) {
      // Main wall block
      const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, WH), wallMat);
      wallMesh.position.set(x + w / 2, y + h / 2, WH / 2);
      wallMesh.castShadow = true;
      wallMesh.receiveShadow = true;
      this.world.add(wallMesh);

      // Baseboard kickplate (0.12m tall, slightly protruding)
      const bw = w > h ? w : w + 0.04;
      const bh = h > w ? h : h + 0.04;
      const baseboard = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.12), baseboardMat);
      baseboard.position.set(x + w / 2, y + h / 2, 0.06);
      baseboard.castShadow = true;
      baseboard.receiveShadow = true;
      this.world.add(baseboard);

      // Crown molding cap (0.04m tall)
      const cap = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.04), crownMat);
      cap.position.set(x + w / 2, y + h / 2, WH - 0.02);
      this.world.add(cap);
    }

    // Procedural Props
    for (const p of sc.props || []) {
      this.world.add(this.createProp(p));
    }

    // Realistic carbon soot/scorch burn decal
    const scorch = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 2.4),
      new THREE.MeshBasicMaterial({ map: this.scorchTexture, transparent: true, opacity: 0.82, depthWrite: false })
    );
    scorch.position.set(sc.fire.x, sc.fire.y, 0.003);
    this.world.add(scorch);

    // Thermal Heatmap Floor Footprint
    this.thermalDisc = new THREE.Mesh(
      new THREE.PlaneGeometry(4.8, 4.8),
      new THREE.MeshBasicMaterial({ map: this.heatTexture, transparent: true, opacity: 0.85, depthWrite: false })
    );
    this.thermalDisc.position.set(sc.fire.x, sc.fire.y, 0.004);
    this.world.add(this.thermalDisc);

    // Ceiling Emergency Hazard Alarm Strobe Beacon
    const beaconG = new THREE.Group();
    beaconG.position.set(sc.fire.x, sc.fire.y, WH - 0.05);
    const beaconMount = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.05, 16), M(0x222222, { metalness: 0.7 }));
    beaconMount.rotation.x = Math.PI / 2;
    const beaconDome = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: 0xff1e00,
        emissive: 0xff2800,
        emissiveIntensity: 0.9,
        roughness: 0.2,
        transparent: true,
        opacity: 0.88,
      })
    );
    beaconDome.rotation.x = Math.PI / 2;
    beaconG.add(beaconMount, beaconDome);
    this.world.add(beaconG);

    this.alarmLight = new THREE.PointLight(0xff2200, 0, 14, 1.4);
    this.alarmLight.position.set(sc.fire.x, sc.fire.y, WH - 0.18);
    this.world.add(this.alarmLight);

    // Fire flame core: layered flame cones + point light with shadows
    this.fire = new THREE.Group();
    const flame = (r, h, c, o) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 14), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o }));
      m.rotation.x = Math.PI / 2;
      m.position.z = h / 2;
      return m;
    };
    this.fire.add(
      flame(0.34, 0.95, 0xff501a, 0.88),
      flame(0.22, 0.65, 0xffb533, 0.92),
      flame(0.1, 0.38, 0xfff6cf, 0.98)
    );
    this.fireLight = new THREE.PointLight(0xff6e26, 3.2, 9.0, 1.4);
    this.fireLight.position.z = 0.65;
    this.fireLight.castShadow = true;
    this.fireLight.shadow.bias = -0.001;
    this.fireLight.shadow.mapSize.width = 512;
    this.fireLight.shadow.mapSize.height = 512;
    this.fire.add(this.fireLight);
    this.fire.position.set(sc.fire.x, sc.fire.y, 0);
    this.world.add(this.fire);

    // Volumetric Smoke & Ember Particle Systems
    this.initSmokeParticles(sc.fire.x, sc.fire.y);
    this.initEmberParticles(sc.fire.x, sc.fire.y);
    this.initWaterMistParticles();

    // Bayesian EIF Covariance Ellipse
    this.initEifOverlay();

    // Build Detailed Rover
    this.buildRover(sc.robot_radius);

    // Lidar scanner rays
    this.lidar = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 })
    );
    this.lidar.frustumCulled = false;
    this.world.add(this.lidar);

    // Planned path line
    this.pathLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x7de3b0, linewidth: 2 })
    );
    this.pathLine.frustumCulled = false;
    this.world.add(this.pathLine);

    // Odometry historical trail line
    this.trailLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xf0559b, transparent: true, opacity: 0.75 })
    );
    this.trailLine.frustumCulled = false;
    this.world.add(this.trailLine);

    this.target = { ...sc.robot };
    this.applyPose(this.target);
    this.controls.target.set(W / 2, H / 2, 0);
    this.setCamera(this.cameraMode);
  }

  // ---- Particle Systems ------------------------------------------------------------------
  initSmokeParticles(fx, fy) {
    const COUNT = 60;
    this.smokeCount = COUNT;
    this.smokeData = [];
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);

    for (let i = 0; i < COUNT; i++) {
      const z = Math.random() * 2.2 + 0.3;
      const angle = Math.random() * Math.PI * 2;
      const rad = Math.random() * 0.25 * (1 + z);
      const x = fx + Math.cos(angle) * rad;
      const y = fy + Math.sin(angle) * rad;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      colors[i * 3] = 0.35;
      colors[i * 3 + 1] = 0.32;
      colors[i * 3 + 2] = 0.40;

      this.smokeData.push({
        x, y, z,
        vx: (Math.random() - 0.5) * 0.08,
        vy: (Math.random() - 0.5) * 0.08,
        vz: 0.5 + Math.random() * 0.6,
        life: Math.random() * 2.0,
        maxLife: 2.2 + Math.random() * 1.0,
      });
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.55,
      map: this.softTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    this.smokePoints = new THREE.Points(geo, mat);
    this.smokePoints.frustumCulled = false;
    this.world.add(this.smokePoints);
  }

  initEmberParticles(fx, fy) {
    const COUNT = 40;
    this.emberCount = COUNT;
    this.emberData = [];
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);

    for (let i = 0; i < COUNT; i++) {
      const z = Math.random() * 1.2 + 0.1;
      const angle = Math.random() * Math.PI * 2;
      const rad = Math.random() * 0.3;
      const x = fx + Math.cos(angle) * rad;
      const y = fy + Math.sin(angle) * rad;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      colors[i * 3] = 1.0;
      colors[i * 3 + 1] = 0.65;
      colors[i * 3 + 2] = 0.15;

      this.emberData.push({
        x, y, z,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        vz: 0.9 + Math.random() * 1.4,
        phase: Math.random() * Math.PI * 2,
      });
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.18,
      map: this.softTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.emberPoints = new THREE.Points(geo, mat);
    this.emberPoints.frustumCulled = false;
    this.world.add(this.emberPoints);
  }

  initWaterMistParticles() {
    const COUNT = 120;
    this.mistCount = COUNT;
    this.mistData = [];
    const positions = new Float32Array(COUNT * 3);

    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = -100; // hide initially below floor
      this.mistData.push({
        x: 0, y: 0, z: -100,
        vx: 0, vy: 0, vz: 0,
        life: 0,
        active: false,
      });
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.16,
      map: this.softTexture,
      color: 0x8fe0f5,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mistPoints = new THREE.Points(geo, mat);
    this.mistPoints.frustumCulled = false;
    this.world.add(this.mistPoints);
  }

  initEifOverlay() {
    this.eifGroup = new THREE.Group();
    this.eifGroup.position.set(0, 0, -10); // hidden initially

    // Pulsing outer boundary ring
    const ringGeo = new THREE.RingGeometry(0.97, 1.0, 40);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    this.eifRing = ring;

    // Translucent filled ellipse disc
    const fillGeo = new THREE.CircleGeometry(0.97, 40);
    const fillMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, side: THREE.DoubleSide, transparent: true, opacity: 0.12, depthWrite: false });
    const fill = new THREE.Mesh(fillGeo, fillMat);

    // Crosshair lines
    const crossGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.25, 0, 0.005), new THREE.Vector3(0.25, 0, 0.005),
      new THREE.Vector3(0, -0.25, 0.005), new THREE.Vector3(0, 0.25, 0.005),
    ]);
    const cross = new THREE.LineSegments(crossGeo, new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.9 }));

    this.eifGroup.add(ring, fill, cross);
    this.world.add(this.eifGroup);
  }

  // ---- Procedural Prop Construction ------------------------------------------------------
  createProp(p) {
    const g = new THREE.Group();
    const z = p.height ?? 0.8;
    const kind = p.kind;

    if (kind === "server_rack") {
      // Modern datacenter server rack
      const body = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, z), M(0x1a212b, { metalness: 0.7, roughness: 0.35 }));
      body.position.z = z / 2;
      g.add(body);

      // Front bezel panel
      const front = new THREE.Mesh(new THREE.BoxGeometry(p.w * 0.92, 0.02, z * 0.92), M(0x0e141a, { roughness: 0.9 }));
      front.position.set(0, -p.h / 2 - 0.005, z / 2);
      g.add(front);

      // Glowing LED indicators along the bezel edge
      const ledCol = [0x00ff88, 0x00d0ff, 0xffa020];
      for (let i = 0; i < 6; i++) {
        const ledMat = new THREE.MeshBasicMaterial({ color: ledCol[i % 3], transparent: true, opacity: 0.9 });
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 6), ledMat);
        const lz = z * 0.2 + (i / 5) * z * 0.6;
        led.position.set(p.w * 0.38, -p.h / 2 - 0.018, lz);
        g.add(led);
        this.animatedLeds.push({ mesh: led, speed: 4 + (i % 3) * 3, phase: i * 1.1 });
      }
    } else if (kind === "gas_cylinder") {
      // Industrial pressurized gas cylinder with valve manifold
      const r = p.r ?? 0.16;
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, z * 0.75, 18), M(0xd4a520, { metalness: 0.3, roughness: 0.5 }));
      cyl.rotation.x = Math.PI / 2;
      cyl.position.z = z * 0.375;
      g.add(cyl);

      // Domed top
      const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), M(0xd4a520));
      dome.rotation.x = -Math.PI / 2;
      dome.position.z = z * 0.75;
      g.add(dome);

      // Hazard caution band
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.015, r * 1.015, z * 0.14, 18), M(0x181818));
      band.rotation.x = Math.PI / 2;
      band.position.z = z * 0.45;
      g.add(band);

      // Brass regulator / valve on top
      const valve = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.28, r * 0.28, 0.16, 12), M(0xb89222, { metalness: 0.85, roughness: 0.25 }));
      valve.rotation.x = Math.PI / 2;
      valve.position.z = z * 0.75 + 0.08;
      const wheel = new THREE.Mesh(new THREE.BoxGeometry(r * 0.85, r * 0.18, 0.035), M(0xcc2222));
      wheel.position.z = z * 0.75 + 0.18;
      g.add(valve, wheel);
    } else if (kind === "generator") {
      // Heavy standby generator / compressor
      const body = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, z * 0.82), M(0x3a4552, { metalness: 0.6, roughness: 0.4 }));
      body.position.z = z * 0.41;
      g.add(body);

      // Radiator grille slats on one side
      for (let k = 0; k < 4; k++) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(p.w * 0.8, 0.02, 0.04), M(0x181e26));
        slat.position.set(0, p.h / 2 + 0.005, z * 0.25 + k * 0.09);
        g.add(slat);
      }

      // Exhaust pipe
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, z * 0.35, 12), M(0x5a6370, { metalness: 0.8, roughness: 0.3 }));
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(p.w * 0.28, 0, z * 0.82 + z * 0.175);
      g.add(pipe);
    } else if (kind === "column") {
      // Concrete structural pillar with base and hazard stripes
      const r = p.r ?? 0.24;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(r, r, z, 20), M(0x767d87, { roughness: 0.9 }));
      col.rotation.x = Math.PI / 2;
      col.position.z = z / 2;

      const base = new THREE.Mesh(new THREE.BoxGeometry(r * 2.3, r * 2.3, 0.12), M(0x525760));
      base.position.z = 0.06;

      const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.015, r * 1.015, 0.3, 20), M(0xe6aa28, { roughness: 0.6 }));
      band.rotation.x = Math.PI / 2;
      band.position.z = 0.35;
      g.add(col, base, band);
    } else if (kind === "pallet") {
      // Timber pallet + cargo cube
      const pal = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, 0.14), M(0x8a6840, { roughness: 0.95 }));
      pal.position.z = 0.07;

      const cargo = new THREE.Mesh(new THREE.BoxGeometry(p.w * 0.86, p.h * 0.86, z * 0.75), M(0x45574a, { roughness: 0.8 }));
      cargo.position.z = 0.14 + (z * 0.75) / 2;

      // Strapping band
      const strap = new THREE.Mesh(new THREE.BoxGeometry(p.w * 0.88, 0.04, z * 0.76), M(0x1a1a1a));
      strap.position.z = cargo.position.z;
      g.add(pal, cargo, strap);
    } else if (kind === "console") {
      // Control room operator terminal with dual glowing monitors
      const desk = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, z * 0.65), M(0x232c38, { metalness: 0.5, roughness: 0.5 }));
      desk.position.z = z * 0.325;

      // Angled bridge with two glowing displays
      const screen1 = new THREE.Mesh(new THREE.BoxGeometry(p.w * 0.42, 0.03, z * 0.42), new THREE.MeshBasicMaterial({ color: 0x00d8f6 }));
      screen1.rotation.x = 0.25;
      screen1.position.set(-p.w * 0.24, -p.h * 0.15, z * 0.65 + z * 0.2);

      const screen2 = new THREE.Mesh(new THREE.BoxGeometry(p.w * 0.42, 0.03, z * 0.42), new THREE.MeshBasicMaterial({ color: 0xffaa1e }));
      screen2.rotation.x = 0.25;
      screen2.position.set(p.w * 0.24, -p.h * 0.15, z * 0.65 + z * 0.2);

      g.add(desk, screen1, screen2);
    } else if (kind === "bench") {
      // Industrial workbench with steel legs and thick wood/metal top
      const top = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, 0.08), M(0x84603e, { roughness: 0.8 }));
      top.position.z = z - 0.04;
      g.add(top);

      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, z - 0.08), M(0x252a33, { metalness: 0.8 }));
          leg.position.set(sx * (p.w / 2 - 0.06), sy * (p.h / 2 - 0.06), (z - 0.08) / 2);
          g.add(leg);
        }
      }
    } else if (kind === "barrel") {
      // Oil barrel with ribbed rims
      const r = p.r ?? 0.26;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(r, r, z, 18), M(PROP.barrel, { metalness: 0.4, roughness: 0.6 }));
      b.rotation.x = Math.PI / 2;
      b.position.z = z / 2;

      const rim1 = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.025, r * 1.025, 0.04, 18), M(0x222222));
      rim1.rotation.x = Math.PI / 2;
      rim1.position.z = z * 0.33;

      const rim2 = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.025, r * 1.025, 0.04, 18), M(0x222222));
      rim2.rotation.x = Math.PI / 2;
      rim2.position.z = z * 0.67;

      g.add(b, rim1, rim2);
    } else if (kind === "shelf") {
      // Multi-tier storage rack
      const frame = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, z), M(PROP.shelf, { wireframe: false, roughness: 0.6 }));
      frame.position.z = z / 2;
      g.add(frame);

      // Shelf tiers
      for (let k = 1; k <= 3; k++) {
        const tier = new THREE.Mesh(new THREE.BoxGeometry(p.w * 0.98, p.h * 0.98, 0.03), M(0x404754));
        tier.position.z = (k / 4) * z;
        g.add(tier);
      }
    } else if (kind === "tree") {
      // Realistic Architectural Tree: Planter base, bark trunk, branch limbs, and multi-tonal organic foliage
      const trunkR = p.r ?? 0.18;
      const trunkH = z * 0.72;
      const canopyR = p.canopy ?? Math.max(trunkR * 3.2, 0.95);

      // Stone planter rim and dark mulch bed at base
      const planterRim = new THREE.Mesh(
        new THREE.CylinderGeometry(trunkR * 3.4, trunkR * 3.8, 0.12, 16),
        M(0x4a5160, { roughness: 0.85, metalness: 0.2 })
      );
      planterRim.rotation.x = Math.PI / 2;
      planterRim.position.z = 0.06;

      const soilBed = new THREE.Mesh(
        new THREE.CylinderGeometry(trunkR * 3.3, trunkR * 3.3, 0.04, 16),
        M(0x231810, { roughness: 0.98 })
      );
      soilBed.rotation.x = Math.PI / 2;
      soilBed.position.z = 0.11;
      g.add(planterRim, soilBed);

      // Tapered bark trunk with vertical grain texture
      const trunkMat = new THREE.MeshStandardMaterial({
        map: this.barkTexture,
        roughness: 0.95,
        metalness: 0.0,
      });
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(trunkR * 0.62, trunkR * 1.15, trunkH, 12),
        trunkMat
      );
      trunk.rotation.x = Math.PI / 2;
      trunk.position.z = trunkH / 2 + 0.08;
      g.add(trunk);

      // Angled branch forks splitting into canopy
      for (const [ba, bp] of [[0.42, 0], [-0.38, Math.PI * 0.68], [0.36, -Math.PI * 0.72]]) {
        const branch = new THREE.Mesh(
          new THREE.CylinderGeometry(trunkR * 0.25, trunkR * 0.45, trunkH * 0.45, 8),
          trunkMat
        );
        branch.rotation.x = Math.PI / 2 + ba;
        branch.rotation.z = bp;
        branch.position.set(Math.cos(bp) * trunkR * 0.35, Math.sin(bp) * trunkR * 0.35, trunkH * 0.82);
        g.add(branch);
      }

      // Multi-tonal faceted foliage clusters (flatShading + procedural foliage texture to break up waxy reflections)
      const leafMatShadow = new THREE.MeshStandardMaterial({
        color: 0x183822,
        map: this.foliageTexture,
        roughness: 0.98,
        metalness: 0.0,
        flatShading: true,
      });
      const leafMatMid = new THREE.MeshStandardMaterial({
        color: 0x2d6a4f,
        map: this.foliageTexture,
        roughness: 0.96,
        metalness: 0.0,
        flatShading: true,
      });
      const leafMatCrown = new THREE.MeshStandardMaterial({
        color: 0x40916c,
        map: this.foliageTexture,
        roughness: 0.92,
        metalness: 0.0,
        flatShading: true,
      });

      // Layered organic foliage clusters using faceted dodecahedrons (no shiny spheres)
      const foliageClusters = [
        [0, 0, 0.75, 1.0, leafMatMid, 0.1],
        [0.42 * canopyR, 0.2 * canopyR, 0.62, 0.74, leafMatShadow, 0.5],
        [-0.38 * canopyR, 0.28 * canopyR, 0.66, 0.72, leafMatMid, -0.4],
        [0.1 * canopyR, -0.42 * canopyR, 0.62, 0.76, leafMatShadow, 0.8],
        [-0.15 * canopyR, -0.15 * canopyR, 0.92, 0.65, leafMatCrown, 1.2],
        [0.18 * canopyR, 0.1 * canopyR, 1.06, 0.52, leafMatCrown, -0.7],
      ];

      for (const [cx, cy, fz, fscale, fmat, frot] of foliageClusters) {
        const cluster = new THREE.Mesh(
          new THREE.DodecahedronGeometry(canopyR * fscale, 1),
          fmat
        );
        cluster.position.set(cx, cy, trunkH + canopyR * fz);
        cluster.rotation.set(frot * 0.7, frot * 0.5, frot);
        g.add(cluster);
      }
    } else if (kind === "shrub") {
      // Dense faceted ornamental bush with mulch base
      const r = p.r ?? 0.38;
      const shrubMat1 = new THREE.MeshStandardMaterial({
        color: 0x1c4428,
        map: this.foliageTexture,
        roughness: 0.98,
        metalness: 0.0,
        flatShading: true,
      });
      const shrubMat2 = new THREE.MeshStandardMaterial({
        color: 0x2d6844,
        map: this.foliageTexture,
        roughness: 0.95,
        metalness: 0.0,
        flatShading: true,
      });

      // Mulch ring
      const mulch = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 1.3, r * 1.4, 0.05, 14),
        M(0x231810, { roughness: 0.95 })
      );
      mulch.rotation.x = Math.PI / 2;
      mulch.position.z = 0.025;
      g.add(mulch);

      // Clustered leafy lobes using faceted geometry
      const lobes = [
        [0, 0, z * 0.5, r * 1.05, shrubMat2],
        [r * 0.45, r * 0.2, z * 0.42, r * 0.75, shrubMat1],
        [-r * 0.4, r * 0.35, z * 0.45, r * 0.7, shrubMat2],
        [0.05, -r * 0.5, z * 0.4, r * 0.78, shrubMat1],
      ];
      for (const [lx, ly, lz, lr, lmat] of lobes) {
        const lobe = new THREE.Mesh(new THREE.DodecahedronGeometry(lr, 1), lmat);
        lobe.position.set(lx, ly, lz);
        g.add(lobe);
      }
    } else if (p.r != null) {
      // Other round props: generic cylinder
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, z, 16), M(PROP[kind] ?? 0x888888));
      cyl.rotation.x = Math.PI / 2;
      cyl.position.z = z / 2;
      g.add(cyl);
    } else {
      // Generic boxes: table, crate, etc.
      const col = PROP[kind] ?? 0x888888;
      const b = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, z), M(col));
      b.position.z = z / 2;
      g.add(b);
    }

    g.position.set(p.x, p.y, 0);
    g.rotation.z = p.yaw ?? 0;
    g.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    return g;
  }

  buildRover(R) {
    this.rover = new THREE.Group();

    // Chassis body with shadow casting and metallic bevel
    const body = new THREE.Mesh(new THREE.BoxGeometry(R * 1.9, R * 1.3, 0.12), M(0x9aa3b5, { metalness: 0.55, roughness: 0.35 }));
    body.position.z = 0.14;
    body.castShadow = true;
    body.receiveShadow = true;

    // High-visibility front bumper
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.08, R * 1.3, 0.1), M(0xff4a2b, { roughness: 0.4 }));
    nose.position.set(R * 0.95, 0, 0.16);
    nose.castShadow = true;

    // Front sensor mast head (FPV camera anchor)
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 10), M(0x2a2f3a, { metalness: 0.8 }));
    mast.rotation.x = Math.PI / 2;
    mast.position.set(R * 0.65, 0, 0.27);
    mast.castShadow = true;

    const cameraHead = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.05), M(0x1e2430));
    cameraHead.position.set(R * 0.65, 0, 0.34);
    cameraHead.castShadow = true;

    // Thermal lens optic glowing cyan
    const optic = new THREE.Mesh(new THREE.CircleGeometry(0.02, 12), new THREE.MeshBasicMaterial({ color: 0x00f0ff }));
    optic.rotation.y = Math.PI / 2;
    optic.position.set(R * 0.68 + 0.001, 0, 0.34);
    this.rover.add(body, nose, mast, cameraHead, optic);

    // Dual high-intensity LED headlights with realistic forward illumination
    for (const sy of [-R * 0.42, R * 0.42]) {
      const lens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.022, 0.02, 12),
        new THREE.MeshBasicMaterial({ color: 0xe8f6ff })
      );
      lens.rotation.z = Math.PI / 2;
      lens.position.set(R * 0.98, sy, 0.15);
      this.rover.add(lens);

      const spot = new THREE.SpotLight(0xedf6ff, 3.2, 9.5, Math.PI / 5, 0.35, 1.2);
      spot.position.set(R * 0.98, sy, 0.15);
      spot.target.position.set(R * 0.98 + 4.0, sy, 0.04);
      this.rover.add(spot);
      this.rover.add(spot.target);
    }

    // 4 Heavy-duty all-terrain wheels with rim detailing
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.055, 16), M(0x18181c, { roughness: 0.85, metalness: 0.2 }));
        w.rotation.x = Math.PI / 2;
        w.position.set(sx * R * 0.65, sy * R * 0.72, 0.06);
        w.castShadow = true;
        this.rover.add(w);
      }
    }

    // Safety ring / footprint disc on ground
    const disc = new THREE.Mesh(new THREE.RingGeometry(R - 0.015, R, 40), new THREE.MeshBasicMaterial({ color: 0xf0559b, side: THREE.DoubleSide }));
    disc.position.z = 0.01;
    this.rover.add(disc);

    // Water cannon turret
    this.turretG = new THREE.Group();
    this.turretG.position.set(0, 0, 0.24);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.065, 16), M(0x2e3440, { metalness: 0.6 }));
    base.rotation.x = Math.PI / 2;
    base.castShadow = true;
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.028, 0.24, 12), M(0x3da5ff, { metalness: 0.7, roughness: 0.3 }));
    noz.rotation.z = -Math.PI / 2;
    noz.position.x = 0.13;
    noz.castShadow = true;
    this.turretG.add(base, noz);

    // Translucent high-speed water jet cone
    this.spray = new THREE.Mesh(
      new THREE.ConeGeometry(0.24, 2.8, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
    );
    this.spray.rotation.z = -Math.PI / 2;
    this.spray.position.x = 1.4 + 0.2;
    this.spray.visible = false;
    this.turretG.add(this.spray);
    this.rover.add(this.turretG);

    // Ultrasonic Acoustic Cones (Front, Left, Right, Rear)
    this.ultrasonicCones = new THREE.Group();
    const angles = [0, Math.PI / 2, -Math.PI / 2, Math.PI];
    for (const a of angles) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.48, 1.8, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x55ffb0, transparent: true, opacity: 0.15, side: THREE.DoubleSide })
      );
      cone.rotation.z = a - Math.PI / 2;
      cone.position.set(Math.cos(a) * (R + 0.9), Math.sin(a) * (R + 0.9), 0.12);
      this.ultrasonicCones.add(cone);
    }
    this.rover.add(this.ultrasonicCones);

    this.world.add(this.rover);
  }

  // ---- per-frame updates -----------------------------------------------------------------
  applyPose(p) {
    this.rover.position.set(p.x, p.y, 0);
    this.rover.rotation.z = p.th;
    this.turretG.rotation.z = p.turret;
  }

  frame(f) {
    this.target = { x: f.x, y: f.y, th: f.th, turret: f.turret };
    this.firePower = f.fire_p;
    this.isPumping = !!f.pump;
    this.spray.visible = this.isPumping;

    // Update Bayesian EIF uncertainty ellipse
    if (f.est && this.eifGroup) {
      const sig = Math.max(0.3, Math.min(f.est.sigma, 6.0));
      this.eifGroup.position.set(f.est.x, f.est.y, 0.015);
      this.eifGroup.scale.set(sig, sig, 1);
      this.eifGroup.visible = this.showSensors;
    } else if (this.eifGroup) {
      this.eifGroup.visible = false;
    }

    if (this.ultrasonicCones) {
      this.ultrasonicCones.visible = this.showSensors;
    }

    // Lidar rays: 36 beams
    const n = f.scan?.length || 0;
    if (n > 0) {
      const pos = new Float32Array(n * 6);
      const col = new Float32Array(n * 6);
      const c = new THREE.Color();
      for (let k = 0; k < n; k++) {
        const a = f.th - Math.PI + (2 * Math.PI * k) / n;
        const d = f.scan[k];
        pos.set([f.x, f.y, 0.15, f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, 0.15], k * 6);
        c.setHSL(0.02 + 0.33 * Math.min(d / 3, 1), 0.9, 0.55);
        col.set([c.r, c.g, c.b, c.r, c.g, c.b], k * 6);
      }
      this.lidar.geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      this.lidar.geometry.setAttribute("color", new THREE.BufferAttribute(col, 3));
    }
    this.lidar.visible = this.showLidar;

    // Planned path
    const pts = (f.path || []).map(([x, y]) => new THREE.Vector3(x, y, 0.05));
    this.pathLine.geometry.setFromPoints(pts);
    this.pathLine.visible = this.showPath && pts.length > 1;

    // Odometry trail
    this.trail.push(new THREE.Vector3(f.x, f.y, 0.03));
    if (this.trail.length > 1600) this.trail.shift();
    this.trailLine.geometry.setFromPoints(this.trail);
  }

  setCamera(mode) {
    this.cameraMode = mode;
    if (!this.sc) return;
    const { width: W, height: H } = this.sc;

    if (mode === "top") {
      this.camera.position.set(W / 2, H / 2 - 0.001, Math.max(W, H) * 1.15);
      this.controls.target.set(W / 2, H / 2, 0);
    } else if (mode === "orbit") {
      this.camera.position.set(W * 0.5, -H * 0.38, Math.max(W, H) * 0.88);
      this.controls.target.set(W / 2, H / 2, 0);
    }
    this.controls.enabled = mode === "orbit" || mode === "top";
    this.controls.update();
  }

  loop() {
    this._raf = requestAnimationFrame(() => this.loop());
    const now = performance.now();
    const dt = Math.min((now - this.lastFrameTime) * 0.001, 0.1);
    this.lastFrameTime = now;
    const tt = now * 0.001;

    // Rover interpolation
    if (this.rover) {
      const p = this.rover.position;
      const k = 0.25;
      const t = this.target;
      p.x += (t.x - p.x) * k;
      p.y += (t.y - p.y) * k;
      const dth = Math.atan2(Math.sin(t.th - this.rover.rotation.z), Math.cos(t.th - this.rover.rotation.z));
      this.rover.rotation.z += dth * k;
      this.turretG.rotation.z += (t.turret - this.turretG.rotation.z) * k;

      const rth = this.rover.rotation.z;
      const tth = rth + this.turretG.rotation.z;

      // Camera Modes
      if (this.cameraMode === "follow") {
        this.camera.position.set(p.x - Math.cos(rth) * 2.5, p.y - Math.sin(rth) * 2.5, 1.8);
        this.camera.lookAt(p.x + Math.cos(rth) * 1.5, p.y + Math.sin(rth) * 1.5, 0.35);
      } else if (this.cameraMode === "fpv") {
        // Sensor mast first-person perspective
        const eyeX = p.x + Math.cos(rth) * 0.22;
        const eyeY = p.y + Math.sin(rth) * 0.22;
        const eyeZ = 0.34;
        this.camera.position.set(eyeX, eyeY, eyeZ);
        this.camera.lookAt(eyeX + Math.cos(rth) * 4.0, eyeY + Math.sin(rth) * 4.0, eyeZ - 0.06);
      } else if (this.cameraMode === "turret") {
        // Gunner view looking straight down the water nozzle barrel
        const eyeX = p.x + Math.cos(tth) * 0.18;
        const eyeY = p.y + Math.sin(tth) * 0.18;
        const eyeZ = 0.32;
        this.camera.position.set(eyeX, eyeY, eyeZ);
        this.camera.lookAt(eyeX + Math.cos(tth) * 5.0, eyeY + Math.sin(tth) * 5.0, eyeZ);
      }
    }

    // Fire flame & Thermal Heatmap animation with dynamic flicker and flame swirl
    if (this.fire) {
      const pw = this.firePower ?? 1;
      const fl = 1 + 0.14 * Math.sin(tt * 19) + 0.08 * Math.sin(tt * 33);
      this.fire.visible = pw > 0.01;
      this.fire.scale.set(pw * fl * 0.9 + 0.1, pw * fl * 0.9 + 0.1, pw * (0.9 + 0.12 * fl) + 0.05);
      this.fire.rotation.z = Math.sin(tt * 3.8) * 0.07;
      this.fireLight.intensity = 3.2 * pw * fl;

      if (this.thermalDisc) {
        this.thermalDisc.visible = this.showHeatmap && pw > 0.01;
        const discScale = Math.max(0.2, Math.sqrt(pw) * fl * 1.1);
        this.thermalDisc.scale.set(discScale, discScale, 1);
        this.thermalDisc.material.opacity = 0.85 * pw * fl;
      }
    }

    // Emergency Hazard Alarm Strobe flashing in the fire zone
    if (this.alarmLight && (this.firePower ?? 1) > 0.01) {
      const cycle = (tt * 3.2) % 1.0;
      const flash = (cycle < 0.12) || (cycle > 0.22 && cycle < 0.34);
      this.alarmLight.intensity = flash ? 4.2 : 0.15;
    } else if (this.alarmLight) {
      this.alarmLight.intensity = 0;
    }

    // Spray water jet animation
    if (this.spray?.visible) {
      this.spray.material.opacity = 0.3 + 0.12 * Math.sin(now / 50);
    }

    // Animate Server Rack LED activity
    for (const led of this.animatedLeds) {
      const v = Math.sin(tt * led.speed + led.phase);
      led.mesh.material.opacity = v > 0.1 ? 0.95 : 0.25;
    }

    // Dynamic Smoke Particles
    if (this.smokePoints && this.sc) {
      this.smokePoints.visible = this.showParticles && (this.firePower ?? 1) > 0.01;
      if (this.smokePoints.visible) {
        const pos = this.smokePoints.geometry.attributes.position.array;
        const fx = this.sc.fire.x, fy = this.sc.fire.y;
        for (let i = 0; i < this.smokeCount; i++) {
          const d = this.smokeData[i];
          d.life += dt;
          if (d.life >= d.maxLife) {
            d.life = 0;
            d.z = 0.35 + Math.random() * 0.2;
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * 0.22;
            d.x = fx + Math.cos(a) * r;
            d.y = fy + Math.sin(a) * r;
            d.vz = 0.45 + Math.random() * 0.6;
          } else {
            d.z += d.vz * dt;
            d.x += d.vx * dt + Math.sin(tt * 2.5 + i) * 0.003;
            d.y += d.vy * dt + Math.cos(tt * 2.0 + i) * 0.003;
          }
          pos[i * 3] = d.x;
          pos[i * 3 + 1] = d.y;
          pos[i * 3 + 2] = d.z;
        }
        this.smokePoints.geometry.attributes.position.needsUpdate = true;
      }
    }

    // Dynamic Ember Particles
    if (this.emberPoints && this.sc) {
      this.emberPoints.visible = this.showParticles && (this.firePower ?? 1) > 0.01;
      if (this.emberPoints.visible) {
        const pos = this.emberPoints.geometry.attributes.position.array;
        const fx = this.sc.fire.x, fy = this.sc.fire.y;
        for (let i = 0; i < this.emberCount; i++) {
          const d = this.emberData[i];
          d.z += d.vz * dt;
          d.x += d.vx * dt + Math.sin(tt * 5.0 + d.phase) * 0.006;
          d.y += d.vy * dt + Math.cos(tt * 5.0 + d.phase) * 0.006;
          if (d.z > 2.2) {
            d.z = 0.15;
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * 0.28;
            d.x = fx + Math.cos(a) * r;
            d.y = fy + Math.sin(a) * r;
          }
          pos[i * 3] = d.x;
          pos[i * 3 + 1] = d.y;
          pos[i * 3 + 2] = d.z;
        }
        this.emberPoints.geometry.attributes.position.needsUpdate = true;
      }
    }

    // Dynamic Water Mist Spray Particles
    if (this.mistPoints && this.rover) {
      this.mistPoints.visible = this.showParticles;
      const pos = this.mistPoints.geometry.attributes.position.array;
      const rth = this.rover.rotation.z;
      const tth = rth + this.turretG.rotation.z;
      const rp = this.rover.position;
      const nozX = rp.x + Math.cos(tth) * 0.35;
      const nozY = rp.y + Math.sin(tth) * 0.35;

      for (let i = 0; i < this.mistCount; i++) {
        const d = this.mistData[i];
        if (d.active) {
          d.x += d.vx * dt;
          d.y += d.vy * dt;
          d.z += d.vz * dt;
          d.vz -= 3.5 * dt; // gravity
          d.life += dt;
          if (d.z <= 0.02 || d.life > 0.8) {
            d.active = false;
            d.z = -100;
          }
        } else if (this.isPumping && Math.random() < 0.25) {
          d.active = true;
          d.life = 0;
          d.x = nozX;
          d.y = nozY;
          d.z = 0.24;
          const sprayAngle = tth + (Math.random() - 0.5) * 0.22;
          const spd = 4.5 + Math.random() * 2.5;
          d.vx = Math.cos(sprayAngle) * spd;
          d.vy = Math.sin(sprayAngle) * spd;
          d.vz = 0.2 + (Math.random() - 0.5) * 0.3;
        }
        pos[i * 3] = d.x;
        pos[i * 3 + 1] = d.y;
        pos[i * 3 + 2] = d.z;
      }
      this.mistPoints.geometry.attributes.position.needsUpdate = true;
    }

    // Bayesian EIF soft breathing pulse
    if (this.eifRing && this.eifGroup?.visible) {
      const pulse = 1.0 + 0.04 * Math.sin(tt * 4.0);
      this.eifRing.scale.set(pulse, pulse, 1);
    }

    if (this.controls.enabled) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
