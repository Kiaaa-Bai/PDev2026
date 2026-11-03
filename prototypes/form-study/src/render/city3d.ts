import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { cellKey, type CitySim } from "../sims/city";
import { AMBIENT_DAY, skyAt, type SkyState, SUN_DAY } from "./looks";
import { type NightUniform, patchPalette, patchWindows, readTexel, ROOF_TEXEL } from "./palette-shader";
import { layoutCells, layoutKey, MODEL_NAMES, ROLLER, type Looks } from "./pieces";

const urls = import.meta.glob("../assets/kenney/**/*.glb", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

/** One model flattened to a single geometry and material, ready to instance. */
interface Model {
  geo: THREE.BufferGeometry;
  mat: THREE.MeshLambertMaterial;
  /** The model's palette picture, which suburban roofs are read from. */
  map: THREE.Texture | null;
}

async function loadModel(loader: GLTFLoader, path: string): Promise<Model> {
  const url = urls[`../assets/kenney/${path}.glb`];
  if (!url) throw new Error(`missing model ${path}`);
  let gltf;
  try {
    gltf = await loader.loadAsync(url);
  } catch (e) {
    throw new Error(`could not load model ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  gltf.scene.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  let map: THREE.Texture | null = null;
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // bake each node's transform in, and keep only what a Lambert material reads, so the parts merge
    const g = mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
    parts.push(g.index ? g.toNonIndexed() : g);
    map ??= (mesh.material as THREE.MeshStandardMaterial).map;
  });
  if (parts.length === 0) throw new Error(`model ${path} has no meshes`);
  const geo = mergeGeometries(parts);
  if (!geo) throw new Error(`model ${path} could not be merged into one geometry`);
  if (map) (map as THREE.Texture).colorSpace = THREE.SRGBColorSpace;
  return { geo, mat: new THREE.MeshLambertMaterial({ map }), map };
}

/** Cells this far from the roller (in each axis) are built; the camera sees far fewer. */
const VIEW_RADIUS = 30;
/** Tiles visible above and below the roller. */
const DEFAULT_HALF_HEIGHT = 5;
const PIXEL_RATIO = 2;
const MAX_FPS = 30;
/** Camera: 30° above the ground, turned 45° around, so a tile is a diamond. */
const ELEVATION = Math.PI / 6;
const CAMERA_DISTANCE = 50;

/**
 * The city as live 3D models seen from above at an angle, the camera following the roller.
 * One instanced mesh per model keeps it to a couple of dozen draw calls.
 */
export class CityView3D {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private ground: THREE.Mesh;
  private models = new Map<string, Model>();
  private meshes = new Map<string, THREE.InstancedMesh>();
  private roller!: THREE.Mesh;
  private hemisphere: THREE.HemisphereLight;
  private sunLight: THREE.DirectionalLight;
  /** How lit the windows are, shared by every model's material. */
  private night: NightUniform = { value: 0 };
  /** The sky last put on the lights, the clock and the windows, and the minute it was looked up in. */
  private sky: SkyState | null = null;
  private skyMinute = NaN;
  /** What the instances were last built for (roller cell, city version, 5 s bucket), and a hash of what that put on screen. */
  private builtFor = "";
  private builtKey: number | null = null;
  /** Where the roller was when last drawn, and whether something outside it needs a draw. */
  private lastMove = "";
  private stale = true;
  private lastRender = -Infinity;

  /** `clock` tells the time of day the sky follows; it is a parameter so a test or the dev page can show another hour. */
  constructor(
    private sim: CitySim,
    private width: number,
    private height: number,
    private clock: () => Date = () => new Date(),
  ) {
    // Lambert shading, no shadows, no antialiasing: the cheapest picture that still reads as 3D.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "low-power" });
    this.renderer.setPixelRatio(PIXEL_RATIO);
    this.renderer.setSize(width, height);
    this.canvas = this.renderer.domElement;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.setHalfHeight(DEFAULT_HALF_HEIGHT);
    this.hemisphere = new THREE.HemisphereLight(0xe8f4ff, 0x6a8a50, AMBIENT_DAY);
    this.scene.add(this.hemisphere);
    this.sunLight = new THREE.DirectionalLight(0xffffff, SUN_DAY);
    this.sunLight.position.set(4, 10, 2);
    this.scene.add(this.sunLight);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x8ccf68 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.scene.add(this.ground);
    this.updateSky();
  }

  /** Loads every model; call once before the first update. */
  async load(): Promise<void> {
    const loader = new GLTFLoader();
    await Promise.all(MODEL_NAMES.map(async (n) => this.models.set(n, await loadModel(loader, n))));
    this.patchMaterials();
    const r = this.models.get(ROLLER.model)!;
    this.roller = new THREE.Mesh(r.geo, r.mat);
    this.roller.scale.setScalar(ROLLER.scale);
    this.scene.add(this.roller);
    this.invalidate();
  }

  /**
   * Suburban houses swap their roof green for the colour of each instance, and light their windows at
   * night; commercial buildings only light their windows. Every other model is left as it is.
   */
  private patchMaterials(): void {
    const of = (prefix: string) => [...this.models].filter(([name]) => name.startsWith(prefix)).map(([, m]) => m);
    const suburban = of("suburban/");
    const image = suburban[0]?.map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
    if (!image) throw new Error("suburban models have no palette texture");
    const roofTexel = readTexel(image, ROOF_TEXEL.x, ROOF_TEXEL.y);
    for (const m of suburban) patchPalette(m.mat, roofTexel, this.night);
    for (const m of of("commercial/")) patchWindows(m.mat, this.night);
  }

  /**
   * Look up the sky for the time of day, once in each minute of the clock, and put it on the clear
   * colour, the two lights and the windows. Returns true when that is different from what was drawn:
   * it stays the same through the full day and the full night, so a parked city is not redrawn.
   */
  private updateSky(): boolean {
    const d = this.clock();
    const minute = Math.floor(d.getTime() / 60_000);
    if (minute === this.skyMinute) return false;
    this.skyMinute = minute;
    const s = skyAt(d);
    const was = this.sky;
    if (was && s.sky === was.sky && s.sun === was.sun && s.ambient === was.ambient && s.night === was.night) return false;
    this.sky = s;
    this.renderer.setClearColor(s.sky);
    this.sunLight.intensity = s.sun;
    this.hemisphere.intensity = s.ambient;
    this.night.value = s.night;
    return true;
  }

  /** Show a different city (the dev page starts over or loads a recording). */
  setSim(sim: CitySim): void {
    this.sim = sim;
    this.builtFor = "";
    this.builtKey = null;
    this.invalidate();
  }

  /** Tiles visible above and below the roller: smaller zooms in. */
  setHalfHeight(h: number): void {
    const aspect = this.width / this.height;
    const c = this.camera;
    c.left = -h * aspect;
    c.right = h * aspect;
    c.top = h;
    c.bottom = -h;
    c.updateProjectionMatrix();
    this.invalidate();
  }

  /** Draw again on the next update, e.g. after the canvas was hidden. */
  invalidate(): void {
    this.stale = true;
  }

  stat(): string {
    const parked = this.sim.parked() ? " · parked" : "";
    return `${this.sim.road.size.toLocaleString()} road tiles · ${this.sim.houses(this.sim.time()).toLocaleString()} houses${parked}`;
  }

  /**
   * Rebuild instances around the roller: only cells within VIEW_RADIUS are drawn.
   * Returns false, touching nothing, when that is exactly what is already on screen.
   */
  private rebuild(t: number): boolean {
    const at = this.sim.rollerAt();
    const has = (x: number, y: number) => this.sim.road.has(cellKey(x, y));
    const looks: Looks = {
      driven: (x, y) => this.sim.road.get(cellKey(x, y)) ?? 0,
      built: (x, y) => this.sim.lots.get(cellKey(x, y)) ?? 0,
    };
    const placed = layoutCells(has, (x, y) => this.sim.houseTier(x, y, t), Math.round(at.x), Math.round(at.y), VIEW_RADIUS, looks);
    const key = layoutKey(placed);
    if (key === this.builtKey) return false;
    this.builtKey = key;

    const buckets = new Map<string, { m: THREE.Matrix4; colour: number }[]>();
    const up = new THREE.Vector3(0, 1, 0);
    const spin = [0, 1, 2, 3].map((k) => new THREE.Quaternion().setFromAxisAngle(up, (k * Math.PI) / 2));
    for (const p of placed) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0, p.y), spin[p.turns], new THREE.Vector3(p.scale, p.scale, p.scale));
      let list = buckets.get(p.model);
      if (!list) buckets.set(p.model, (list = []));
      list.push({ m, colour: p.colour });
    }
    for (const [name, mesh] of this.meshes) {
      if (!buckets.has(name)) mesh.count = 0;
    }
    for (const [name, list] of buckets) {
      let mesh = this.meshes.get(name);
      if (!mesh || mesh.instanceMatrix.count < list.length) {
        if (mesh) {
          this.scene.remove(mesh);
          mesh.dispose();
        }
        const model = this.models.get(name)!;
        mesh = new THREE.InstancedMesh(model.geo, model.mat, Math.max(64, list.length * 2));
        mesh.frustumCulled = false;
        this.meshes.set(name, mesh);
        this.scene.add(mesh);
      }
      const colour = new THREE.Color();
      list.forEach((item, i) => {
        mesh!.setMatrixAt(i, item.m);
        mesh!.setColorAt(i, colour.setHex(item.colour));
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    }
    return true;
  }

  /** Draw if something changed, at most MAX_FPS times a second. Returns true when it drew. */
  update(now: number): boolean {
    if (!this.roller || now - this.lastRender < 1000 / MAX_FPS) return false;
    const t = this.sim.time();
    const at = this.sim.rollerAt();
    const move = `${Math.round(at.x * 32)},${Math.round(at.y * 32)},${this.sim.roller.dir}`;
    let changed = this.stale || move !== this.lastMove;
    if (this.updateSky()) changed = true;
    // Check the surroundings when the roller has moved a few cells, the city changed, or every 5 s
    // (a house can age into a bigger one). It only counts as a change if what is drawn differs.
    const cellSig = `${Math.round(at.x / 4)},${Math.round(at.y / 4)},${this.sim.version},${Math.floor(t / 5000)}`;
    if (cellSig !== this.builtFor) {
      this.builtFor = cellSig;
      if (this.rebuild(t)) changed = true;
    }
    if (!changed) return false;
    this.stale = false;
    this.lastMove = move;
    this.roller.position.set(at.x, 0.02, at.y);
    this.roller.rotation.y = ROLLER.yaw[this.sim.roller.dir];
    const flat = CAMERA_DISTANCE * Math.cos(ELEVATION) * Math.SQRT1_2;
    this.camera.position.set(at.x + flat, CAMERA_DISTANCE * Math.sin(ELEVATION), at.y + flat);
    this.camera.lookAt(at.x, 0, at.y);
    this.ground.position.set(at.x, -0.01, at.y);
    this.renderer.render(this.scene, this.camera);
    this.lastRender = now;
    return true;
  }
}
