// three.js view of a MuJoCo-backed episode. Sim coordinates are used as-is (x, y on the floor,
// z up), so the camera's up-vector is +z. The server streams scene geometry once and small
// per-tick frames; this class turns them into meshes and animates the rover.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const FLOOR = { office: 0x6b4a32, storage: 0x5b5f66, workshop: 0x3b6f78, atrium: 0x2f6b3a };
const PROP = { table: 0x8a5a34, shelf: 0x9aa3ad, crate: 0xb98a4e, barrel: 0xb5452e,
               shrub: 0x2f8f4a, tree: 0x6b4a2b, pillar: 0x8a8f96 };
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...o });

export default class MujocoScene {
  constructor(canvasHost) {
    this.host = canvasHost;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x0e0919);
    this.host.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0e0919, 30, 70);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x30203f, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(6, -8, 14);
    this.scene.add(sun);
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.showLidar = true;
    this.showPath = true;
    this.cameraMode = "orbit";
    this.target = { x: 0, y: 0, th: 0, turret: 0 };
    this.trail = [];
    // the page stays mounted but display:none while another tab is showing, so watch the host
    // element itself (a window "resize" event would miss it becoming visible)
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
    this.world.traverse((o) => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  clear() {
    this.world.traverse((o) => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
    this.world.clear();
    this.trail = [];
  }

  // ---- static scene ----------------------------------------------------------------------
  load(sc) {
    this.clear();
    this.sc = sc;
    const { width: W, height: H, wall_height: WH } = sc;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + 20, H + 20), M(0x140e22));
    ground.position.set(W / 2, H / 2, -0.01);
    this.world.add(ground);
    for (const r of sc.rooms || []) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.h), M(FLOOR[r.kind] ?? 0x444444));
      f.position.set(r.x + r.w / 2, r.y + r.h / 2, 0);
      this.world.add(f);
    }
    const wallMat = M(0xd9d4e6, { transparent: true, opacity: 0.72 });
    for (const [x, y, w, h] of sc.walls) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, WH), wallMat);
      m.position.set(x + w / 2, y + h / 2, WH / 2);
      this.world.add(m);
    }
    for (const p of sc.props || []) this.world.add(this.prop(p));

    // fire: layered flame cones + a light, flickered in loop()
    this.fire = new THREE.Group();
    const flame = (r, h, c, o) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 14), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o }));
      m.rotation.x = Math.PI / 2; m.position.z = h / 2;
      return m;
    };
    this.fire.add(flame(0.32, 0.9, 0xff5a1f, 0.85), flame(0.2, 0.62, 0xffb238, 0.9), flame(0.09, 0.36, 0xfff2c9, 0.95));
    this.fireLight = new THREE.PointLight(0xff7a2a, 2.2, 6);
    this.fireLight.position.z = 0.6;
    this.fire.add(this.fireLight);
    this.fire.position.set(sc.fire.x, sc.fire.y, 0);
    this.world.add(this.fire);

    this.buildRover(sc.robot_radius);
    this.lidar = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 }));
    this.lidar.frustumCulled = false;
    this.world.add(this.lidar);
    this.pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x7de3b0 }));
    this.pathLine.frustumCulled = false;
    this.world.add(this.pathLine);
    this.trailLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xf0559b, transparent: true, opacity: 0.7 }));
    this.trailLine.frustumCulled = false;
    this.world.add(this.trailLine);

    this.target = { ...sc.robot };
    this.applyPose(this.target);
    this.controls.target.set(W / 2, H / 2, 0);
    this.setCamera(this.cameraMode);
  }

  prop(p) {
    const g = new THREE.Group();
    const z = p.height ?? 0.8;
    const col = PROP[p.kind] ?? 0x888888;
    if (p.r != null) {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, z, 16), M(p.kind === "tree" ? PROP.tree : col));
      cyl.rotation.x = Math.PI / 2; cyl.position.z = z / 2;
      g.add(cyl);
      if (p.kind === "tree" || p.kind === "shrub") {
        const c = p.canopy ?? Math.max(p.r * 2.2, 0.5);
        const leaf = M(0x2f8f4a);
        for (const [dx, dy, dz, f] of [[0, 0, 0.6, 1], [0.5, 0.2, 0.35, 0.65], [-0.45, 0.3, 0.4, 0.6], [0.1, -0.5, 0.3, 0.62]]) {
          const s = new THREE.Mesh(new THREE.SphereGeometry(c * f, 14, 10), leaf);
          s.position.set(dx * c, dy * c, z + c * dz);
          g.add(s);
        }
      }
    } else {
      const b = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, z), M(col));
      b.position.z = z / 2;
      g.add(b);
    }
    g.position.set(p.x, p.y, 0);
    g.rotation.z = p.yaw ?? 0;
    return g;
  }

  buildRover(R) {
    this.rover = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(R * 1.9, R * 1.3, 0.12), M(0x9aa3b5, { metalness: 0.4, roughness: 0.4 }));
    body.position.z = 0.14;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.08, R * 1.3, 0.1), M(0xff4a2b));
    nose.position.set(R * 0.95, 0, 0.16);
    this.rover.add(body, nose);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 12), M(0x111111));
      w.rotation.x = Math.PI / 2; w.position.set(sx * R * 0.65, sy * R * 0.72, 0.06);
      this.rover.add(w);
    }
    const disc = new THREE.Mesh(new THREE.RingGeometry(R - 0.01, R, 40), new THREE.MeshBasicMaterial({ color: 0xf0559b, side: THREE.DoubleSide }));
    disc.position.z = 0.01;
    this.rover.add(disc);
    this.turretG = new THREE.Group();
    this.turretG.position.z = 0.24;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 14), M(0x333844));
    base.rotation.x = Math.PI / 2;
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.22, 10), M(0x3da5ff));
    noz.rotation.z = -Math.PI / 2; noz.position.x = 0.12;
    this.turretG.add(base, noz);
    this.spray = new THREE.Mesh(new THREE.ConeGeometry(0.22, 2.5, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    this.spray.rotation.z = -Math.PI / 2;      // apex at the nozzle, opening forward
    this.spray.position.x = 1.25 + 0.2;
    this.spray.scale.set(1, 1, 1);
    this.spray.visible = false;
    this.turretG.add(this.spray);
    this.rover.add(this.turretG);
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
    this.spray.visible = !!f.pump;
    // lidar rays: 36 beams, index k at bearing -pi + 2*pi*k/36 relative to the chassis
    const n = f.scan.length, pos = new Float32Array(n * 6), col = new Float32Array(n * 6);
    const c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const a = f.th - Math.PI + (2 * Math.PI * k) / n, d = f.scan[k];
      pos.set([f.x, f.y, 0.15, f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, 0.15], k * 6);
      c.setHSL(0.02 + 0.33 * Math.min(d / 3, 1), 0.9, 0.55);
      col.set([c.r, c.g, c.b, c.r, c.g, c.b], k * 6);
    }
    this.lidar.geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.lidar.geometry.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.lidar.visible = this.showLidar;
    const pts = (f.path || []).map(([x, y]) => new THREE.Vector3(x, y, 0.05));
    this.pathLine.geometry.setFromPoints(pts);
    this.pathLine.visible = this.showPath && pts.length > 1;
    this.trail.push(new THREE.Vector3(f.x, f.y, 0.03));
    if (this.trail.length > 1500) this.trail.shift();
    this.trailLine.geometry.setFromPoints(this.trail);
  }

  setCamera(mode) {
    this.cameraMode = mode;
    if (!this.sc) return;
    const { width: W, height: H } = this.sc;
    const c = this.controls.target.set(W / 2, H / 2, 0);
    if (mode === "top") {
      this.camera.position.set(W / 2, H / 2 - 0.01, Math.max(W, H) * 1.05);
    } else if (mode === "orbit") {
      this.camera.position.set(W * 0.5, -H * 0.35, Math.max(W, H) * 0.85);
    }
    this.controls.enabled = mode !== "follow";
    c.z = 0;
    this.controls.update();
  }

  loop() {
    this._raf = requestAnimationFrame(() => this.loop());
    if (this.rover) {
      const p = this.rover.position, k = 0.25;
      const t = this.target;
      p.x += (t.x - p.x) * k; p.y += (t.y - p.y) * k;
      let dth = Math.atan2(Math.sin(t.th - this.rover.rotation.z), Math.cos(t.th - this.rover.rotation.z));
      this.rover.rotation.z += dth * k;
      this.turretG.rotation.z += (t.turret - this.turretG.rotation.z) * k;
      if (this.cameraMode === "follow") {
        const th = this.rover.rotation.z;
        this.camera.position.set(p.x - Math.cos(th) * 2.4, p.y - Math.sin(th) * 2.4, 1.7);
        this.camera.lookAt(p.x + Math.cos(th) * 1.2, p.y + Math.sin(th) * 1.2, 0.2);
      }
    }
    if (this.fire) {
      const pw = this.firePower ?? 1, tt = performance.now() / 1000;
      const fl = 1 + 0.12 * Math.sin(tt * 17) + 0.08 * Math.sin(tt * 29);
      this.fire.visible = pw > 0.01;
      this.fire.scale.set(pw * fl * 0.9 + 0.1, pw * fl * 0.9 + 0.1, pw * (0.9 + 0.1 * fl) + 0.05);
      this.fireLight.intensity = 2.2 * pw * fl;
    }
    if (this.spray?.visible) this.spray.material.opacity = 0.28 + 0.1 * Math.sin(performance.now() / 60);
    if (this.cameraMode !== "follow") this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
