// EnclosureViewer — FZ-E battery envelope viewer skeleton (three.js ES module).
//
// Contract: scenes/fz-e-pack/SCENE_SPEC.md v1.
// Units: millimeters. Origin: steering-head center, ground plane y = 0.
// Bike faces +X. Placeholder boxes per spec slots (no real GLBs yet).
//
// Renderer: WebGPU default, WebGL2 fallback. pixelRatio capped at 2.
// Usage (index.html):
//   <canvas id="view"></canvas>
//   <input id="explode" type="range" min="0" max="1" step="0.01" value="0">
//   <script type="importmap">{"imports":{
//     "three": "https://unpkg.com/three@0.170.0/build/three.module.js",
//     "three/addons/": "https://unpkg.com/three@0.170.0/examples/jsm/"}}</script>
//   <script type="module">
//     import { EnclosureViewer } from './app.js';
//     const v = new EnclosureViewer(document.getElementById('view'));
//     await v.init();
//     v.attachExplodeSlider(document.getElementById('explode'));
//     v.animate();
//   </script>

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------------------------------------------------------------- palette
export const PALETTE = {
  frame: 0x52525b, // zinc
  pack: 0x7c6bb3, // violet accent
  interference: 0xdc2626, // red
  ok: 0x16a34a,
  controller: 0x3f3f46,
  motor: 0x71717a,
  ground: 0x18181b,
};

export const SLOTS = [
  'frame_triangle',
  'pack_72v',
  'pack_96v',
  'controller_box',
  'motor_qs138',
  'clearance',
];

// 72V default; 96V toggle (never both visible). Mirrors scenes preset fz-e.json.
export const PRESET_DEFAULT = Object.freeze({
  name: 'fz-e',
  packVariant: '72v',
  explode: 0,
  camera: 'CAM_PERSP',
});

// Placeholder dims (mm): [w(x), h(y), d(z)], center position.
const PACK_72V = { size: [280, 180, 200], center: [-450, 520, 0], massKg: 32 };
const PACK_96V = { size: [430, 280, 200], center: [-480, 560, 0], massKg: 42 };
const CONTROLLER = { size: [200, 120, 80], center: [-950, 780, 0] };
const MOTOR = { size: [260, 260, 160], center: [-1350, 340, 0] }; // at rear axle
const TUBE_R = 20; // frame tube radius, mm
const CLEARANCE_MIN_MM = 10;

// Diamond-frame triangle points (mm): steering head at origin.
const FRAME_PTS = {
  headTop: new THREE.Vector3(0, 1000, 0),
  headBot: new THREE.Vector3(30, 850, 0),
  seatTop: new THREE.Vector3(-950, 950, 0),
  bb: new THREE.Vector3(-550, 320, 0),
};
const FRAME_TUBES = [
  ['down', FRAME_PTS.headBot, FRAME_PTS.bb],
  ['top', FRAME_PTS.headTop, FRAME_PTS.seatTop],
  ['seat', FRAME_PTS.seatTop, FRAME_PTS.bb],
];
const AXLES = {
  front: new THREE.Vector3(550, 340, 0),
  rear: new THREE.Vector3(-1350, 340, 0),
};

// ---------------------------------------------------------------- helpers
function tubeBetween(a, b, radius, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(radius, radius, len, 20, 1);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

function boxPlaceholder(size, center, material, label) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...center);
  mesh.userData.label = label;
  return mesh;
}

function makeLabelSprite(text, cssColor = '#fafafa', scale = 1) {
  const pad = 12;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = '600 28px system-ui, sans-serif';
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  c.width = w;
  c.height = 52;
  const ctx2 = c.getContext('2d');
  ctx2.fillStyle = 'rgba(24,24,27,0.85)';
  ctx2.fillRect(0, 0, c.width, c.height);
  ctx2.font = '600 28px system-ui, sans-serif';
  ctx2.fillStyle = cssColor;
  ctx2.textBaseline = 'middle';
  ctx2.fillText(text, pad, c.height / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  // World scale: ~1.2mm per canvas px keeps dims text clear of overlap at 400px wide.
  sprite.scale.set(c.width * 1.2 * scale, c.height * 1.2 * scale, 1);
  sprite.renderOrder = 10;
  return sprite;
}

// ======================================================================
export class EnclosureViewer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas, opts = {}) {
    if (!canvas) throw new Error('[EnclosureViewer] canvas element required');
    this.canvas = canvas;
    this.opts = opts;
    this.slots = new Map(); // name -> THREE.Object3D (loud fail if missing)
    this.explodeT = 0;
    this.packVariant = PRESET_DEFAULT.packVariant;
    this.activeCamera = PRESET_DEFAULT.camera;
    this.gltf = new GLTFLoader();
    this._frames = 0;
    this._lastHud = performance.now();
    this._fps = 0;
    this._raf = 0;
    this._onResize = () => this.resize();
  }

  // ---- init: WebGPU default, WebGL2 fallback ---------------------------
  async init() {
    const canvas = this.canvas;
    let renderer = null;
    let backend = 'webgl2';
    try {
      const { WebGPURenderer } = await import(
        'three/addons/renderers/webgpu/WebGPURenderer.js'
      );
      renderer = new WebGPURenderer({ canvas, antialias: true });
      await renderer.init();
      backend = 'webgpu';
    } catch {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      backend = 'webgl2';
    }
    this.backend = backend;
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(canvas.clientWidth || 800, canvas.clientHeight || 600, false);
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x09090b);

    // Studio HDRI-ish: RoomEnvironment via PMREM (works on both backends).
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x27272a, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(1200, 2000, 1500);
    this.scene.add(key);

    this._buildGround();
    this._buildSlots(); // placeholder boxes per spec (no real GLBs yet)
    this._buildCameras();
    this._buildHud();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.target.set(-450, 550, 0);

    window.addEventListener('resize', this._onResize);
    this.loadPreset(this.opts.preset ?? PRESET_DEFAULT);
    return this;
  }

  // ---- slots ------------------------------------------------------------
  /** Loud fail: every spec slot must be bound. */
  getSlot(name) {
    const s = this.slots.get(name);
    if (!s) throw new Error(`[EnclosureViewer] slot not bound: ${name}`);
    return s;
  }

  _register(name, obj, explodeY = 0) {
    obj.userData.slot = name;
    obj.userData.baseY = obj.position.y;
    obj.userData.explodeY = explodeY;
    obj.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.transparent = true;
      }
    });
    this.slots.set(name, obj);
    this.scene.add(obj);
  }

  _buildSlots() {
    const frameMat = new THREE.MeshStandardMaterial({ color: PALETTE.frame, roughness: 0.5, metalness: 0.7 });
    const packMat = new THREE.MeshStandardMaterial({ color: PALETTE.pack, roughness: 0.35, metalness: 0.2 });
    const ctrlMat = new THREE.MeshStandardMaterial({ color: PALETTE.controller, roughness: 0.6, metalness: 0.4 });
    const motorMat = new THREE.MeshStandardMaterial({ color: PALETTE.motor, roughness: 0.45, metalness: 0.8 });

    // frame_triangle: diamond-frame polyline, 3 tubes as cylinders + dims.
    const frame = new THREE.Group();
    for (const [, a, b] of FRAME_TUBES) frame.add(tubeBetween(a, b, TUBE_R, frameMat));
    const dims = makeLabelSprite('triangle 980 x 630', '#e4e4e7', 0.9);
    dims.position.set(-500, 1080, 0);
    frame.add(dims);
    this._register('frame_triangle', frame, 0);

    // pack_72v / pack_96v: toggle vs 72V, never both.
    const p72 = new THREE.Group();
    p72.add(boxPlaceholder(PACK_72V.size, [0, 0, 0], packMat, 'pack_72v'));
    const l72 = makeLabelSprite(`72V 280x180x200 · ${PACK_72V.massKg}kg`, '#c4b5fd');
    l72.position.set(0, PACK_72V.size[1] / 2 + 70, 0);
    p72.add(l72);
    p72.position.set(...PACK_72V.center);
    // Rebase: children built around origin, group carries center as baseY.
    p72.userData.baseY = PACK_72V.center[1];
    this._register('pack_72v', p72, 260);

    const p96 = new THREE.Group();
    p96.add(boxPlaceholder(PACK_96V.size, [0, 0, 0], packMat.clone(), 'pack_96v'));
    const l96 = makeLabelSprite(`96V 430x280x200 · ${PACK_96V.massKg}kg`, '#c4b5fd');
    l96.position.set(0, PACK_96V.size[1] / 2 + 70, 0);
    p96.add(l96);
    p96.position.set(...PACK_96V.center);
    p96.userData.baseY = PACK_96V.center[1];
    this._register('pack_96v', p96, 420);

    // controller_box + motor_qs138 placeholders with mounts.
    const ctrl = new THREE.Group();
    ctrl.add(boxPlaceholder(CONTROLLER.size, [0, 0, 0], ctrlMat, 'controller_box'));
    ctrl.position.set(...CONTROLLER.center);
    ctrl.userData.baseY = CONTROLLER.center[1];
    this._register('controller_box', ctrl, 560);

    const motor = new THREE.Group();
    motor.add(boxPlaceholder(MOTOR.size, [0, 0, 0], motorMat, 'motor_qs138'));
    const mount = new THREE.Mesh(
      new THREE.BoxGeometry(320, 24, 200),
      new THREE.MeshStandardMaterial({ color: PALETTE.frame, metalness: 0.7, roughness: 0.5 }),
    );
    mount.position.y = -MOTOR.size[1] / 2 - 12;
    motor.add(mount);
    motor.position.set(...MOTOR.center);
    motor.userData.baseY = MOTOR.center[1];
    this._register('motor_qs138', motor, 120);

    // clearance: min gap readout (pack-to-tube), red if <10mm.
    const clearance = new THREE.Group();
    this.clearanceLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: PALETTE.ok }),
    );
    this.clearanceLabel = makeLabelSprite('', '#fafafa');
    clearance.add(this.clearanceLine, this.clearanceLabel);
    // Clearance group must exist before updateClearance() touches it.
    this.slots.set('clearance', clearance);
    this.scene.add(clearance);

    // CG marker: battery centroid vs wheelbase (CAM_TOP).
    const cg = new THREE.Group();
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(22, 24, 16),
      new THREE.MeshBasicMaterial({ color: PALETTE.pack }),
    );
    const wbLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([AXLES.rear, AXLES.front]),
      new THREE.LineDashedMaterial({ color: 0xa1a1aa, dashSize: 40, gapSize: 25 }),
    );
    wbLine.computeLineDistances();
    const cgLabel = makeLabelSprite('CG', '#c4b5fd', 0.8);
    cgLabel.position.set(0, 90, 0);
    cg.add(dot, wbLine, cgLabel);
    cg.position.set(...PACK_72V.center);
    cg.userData.baseY = PACK_72V.center[1];
    this.slots.set('cg_marker', cg);
    this.scene.add(cg);
    this.cgMarker = cg;

    this.setPackVariant(this.packVariant);
    this.updateClearance();
  }

  _buildGround() {
    const grid = new THREE.GridHelper(4000, 40, 0x3f3f46, 0x27272a);
    grid.position.y = 0;
    this.scene.add(grid);
  }

  // ---- cameras: CAM_SIDE / CAM_TOP / CAM_PERSP ---------------------------
  _buildCameras() {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    const aspect = w / h;
    const cx = -450; // scene center x (pack area)

    this.cameras = {
      // Orthographic-ish side elevation with dims (look along -Z).
      CAM_SIDE: new THREE.OrthographicCamera(-1100 * aspect, 1100 * aspect, 800, -200, 1, 8000),
      // Top-down CG marker.
      CAM_TOP: new THREE.OrthographicCamera(-1100 * aspect, 1100 * aspect, 700, -700, 1, 8000),
      // 3/4 hero, studio HDRI.
      CAM_PERSP: new THREE.PerspectiveCamera(42, aspect, 10, 20000),
    };
    this.cameras.CAM_SIDE.position.set(cx, 550, 2600);
    this.cameras.CAM_SIDE.lookAt(cx, 550, 0);
    this.cameras.CAM_TOP.position.set(cx, 3000, 0.01);
    this.cameras.CAM_TOP.lookAt(cx, 0, 0);
    this.cameras.CAM_PERSP.position.set(cx + 1500, 1400, 1900);
    this.cameras.CAM_PERSP.lookAt(cx, 500, 0);
    this.camera = this.cameras.CAM_PERSP;
  }

  /** @param {'CAM_SIDE'|'CAM_TOP'|'CAM_PERSP'} name */
  setCamera(name) {
    if (!this.cameras[name]) throw new Error(`[EnclosureViewer] unknown camera: ${name}`);
    this.activeCamera = name;
    this.camera = this.cameras[name];
    if (this.controls) {
      this.controls.object = this.camera;
      this.controls.update();
    }
  }

  // ---- preset / pack variant ----------------------------------------------
  loadPreset(preset = {}) {
    const p = { ...PRESET_DEFAULT, ...preset };
    this.setPackVariant(p.packVariant);
    this.setExplode(p.explode ?? 0);
    if (p.camera) this.setCamera(p.camera);
  }

  /** Toggle vs 72V — never both visible. */
  setPackVariant(v) {
    if (v !== '72v' && v !== '96v') throw new Error(`[EnclosureViewer] unknown pack variant: ${v}`);
    this.packVariant = v;
    this.getSlot('pack_72v').visible = v === '72v';
    this.getSlot('pack_96v').visible = v === '96v';
    // CG follows the active pack centroid.
    const c = v === '72v' ? PACK_72V.center : PACK_96V.center;
    if (this.cgMarker) {
      this.cgMarker.position.set(c[0], c[1], c[2]);
      this.cgMarker.userData.baseY = c[1];
      this.setExplode(this.explodeT);
    }
    this.updateClearance();
  }

  // ---- clearance: min pack-to-tube gap --------------------------------------
  /** Distance from active pack Box3 surface to nearest tube segment, minus tube radius. */
  computeClearanceMm() {
    const spec = this.packVariant === '72v' ? PACK_72V : PACK_96V;
    const g = this.getSlot(this.packVariant === '72v' ? 'pack_72v' : 'pack_96v');
    // World-space box from meshes only — label sprites must not inflate it.
    const box = new THREE.Box3();
    g.traverse((o) => {
      if (o.isMesh) box.expandByObject(o);
    });
    let min = Infinity;
    let closest = null;
    const pt = new THREE.Vector3();
    const clamped = new THREE.Vector3();
    for (const [, a, b] of FRAME_TUBES) {
      for (let i = 0; i <= 24; i++) {
        pt.lerpVectors(a, b, i / 24);
        clamped.copy(pt).clamp(box.min, box.max);
        const d = pt.distanceTo(clamped);
        if (d < min) {
          min = d;
          closest = { tubePt: pt.clone(), boxPt: clamped.clone() };
        }
      }
    }
    void spec;
    return { gap: min - TUBE_R, closest };
  }

  updateClearance() {
    if (!this.clearanceLine) return { gap: Infinity };
    const { gap, closest } = this.computeClearanceMm();
    const bad = gap < CLEARANCE_MIN_MM;
    const color = bad ? PALETTE.interference : PALETTE.ok;
    this.clearanceLine.material.color.setHex(color);
    if (closest) {
      this.clearanceLine.geometry.setFromPoints([closest.tubePt, closest.boxPt]);
      this.clearanceLabel.position.copy(closest.boxPt).add(new THREE.Vector3(0, 80, 0));
    }
    // Rebuild label texture text.
    const label = `gap ${Number.isFinite(gap) ? gap.toFixed(0) : '—'}mm${bad ? ' · INTERFERENCE' : ''}`;
    const fresh = makeLabelSprite(label, bad ? '#fca5a5' : '#bbf7d0', 0.85);
    this.clearanceLabel.material.map.dispose();
    this.clearanceLabel.material.map = fresh.material.map;
    this.clearanceLabel.scale.copy(fresh.scale);
    return { gap, bad };
  }

  // ---- explode slider: lerp Y + opacity ---------------------------------------
  /** @param {number} t 0..1 */
  setExplode(t) {
    this.explodeT = THREE.MathUtils.clamp(t, 0, 1);
    for (const [, obj] of this.slots) {
      const dy = obj.userData.explodeY ?? 0;
      if (dy) obj.position.y = (obj.userData.baseY ?? obj.position.y) + this.explodeT * dy;
      obj.traverse((o) => {
        if (o.isMesh) o.material.opacity = 1 - this.explodeT * 0.55;
        if (o.isSprite) o.material.opacity = 1 - this.explodeT * 0.3;
      });
    }
    this.updateClearance();
  }

  attachExplodeSlider(el) {
    if (!el) throw new Error('[EnclosureViewer] explode slider element required');
    el.addEventListener('input', () => this.setExplode(parseFloat(el.value)));
  }

  // ---- optional GLB hook (no real GLBs yet — placeholders stay until then) ----
  /** Load a real GLB into a slot later; placeholder hidden on success. */
  async loadGLB(slotName, url) {
    const slot = this.getSlot(slotName);
    const glb = await this.gltf.loadAsync(url);
    slot.clear();
    slot.add(glb.scene);
    return glb.scene;
  }

  // ---- perf HUD: renderer.info draw calls / tris -------------------------------
  _buildHud() {
    const hud = document.createElement('div');
    hud.style.cssText = [
      'position:absolute;top:8px;left:8px;padding:6px 10px',
      'font:12px/1.5 ui-monospace,monospace;color:#e4e4e7',
      'background:rgba(24,24,27,.8);border-radius:6px;pointer-events:none',
      'white-space:pre;z-index:10',
    ].join(';');
    this.canvas.parentElement?.appendChild(hud);
    this.hud = hud;
  }

  _tickHud() {
    if (!this.hud) return;
    const info = this.renderer.info;
    this.hud.textContent =
      `${this.backend} · ${this._fps}fps\n` +
      `calls ${info.render.calls} · tris ${info.render.triangles.toLocaleString()}\n` +
      `${this.packVariant} · gap ${this._lastGap ?? '—'} · ${this.activeCamera}`;
  }

  // ---- loop ----------------------------------------------------------------------
  animate() {
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      this.controls?.update();
      this.renderer.render(this.scene, this.camera);
      this._frames++;
      const now = performance.now();
      if (now - this._lastHud > 500) {
        this._fps = Math.round((this._frames * 1000) / (now - this._lastHud));
        this._frames = 0;
        this._lastHud = now;
        this._lastGap = this.updateClearance().gap?.toFixed?.(0) ?? '—';
        this._tickHud();
      }
    };
    loop();
  }

  resize() {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    for (const [name, cam] of Object.entries(this.cameras)) {
      if (cam.isPerspectiveCamera) {
        cam.aspect = w / h;
      } else {
        const aspect = w / h;
        cam.left = -1100 * aspect;
        cam.right = 1100 * aspect;
      }
      cam.updateProjectionMatrix();
      void name;
    }
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this.controls?.dispose();
    this.hud?.remove();
    this.renderer?.dispose();
  }
}
