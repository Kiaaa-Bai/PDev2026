import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { cellKey, type CitySim } from "../sims/city";
import { COLORMAPS, colormapRedirect, kitOf, shareOne } from "./colormaps";
import { AMBIENT_DAY, sameSky, SKY_DAY, skyAt, type SkyState, SUN_COLOUR_DAY, SUN_DAY, WINDOW_LIT } from "./looks";
import { type NightUniform, patchAsphalt, patchPalette, patchWindows, readTexel, ROOF_TEXEL } from "./palette-shader";
import { FaultOnce, Traffic, trafficRadius } from "./traffic";
import {
  clampHalfHeight,
  easeBackLeft,
  easeHalfHeight,
  EASE_BACK_MS,
  ELEVATION,
  lampHead,
  layoutCells,
  layoutKey,
  LIGHT,
  MIN_HALF_HEIGHT,
  MODEL_NAMES,
  panDelta,
  ROLLER,
  VIEW_HOLD_MS,
  viewRadius,
  wheelZoomTarget,
  type Looks,
  type Placement,
} from "./pieces";

const urls = import.meta.glob("../assets/kenney/**/*.glb", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

/** One model flattened to a single geometry and material, ready to instance. */
interface Model {
  geo: THREE.BufferGeometry;
  mat: THREE.MeshLambertMaterial;
  /** The model's palette picture, which suburban roofs are read from. */
  map: THREE.Texture | null;
}

/** What a kit's models share: a loader that finds the kit's palette picture, and the one texture made from it. */
interface Kit {
  loader: GLTFLoader;
  map: THREE.Texture | null;
}

/** A kit's loader sends each GLB's reference to `colormap.png` to the picture the bundler shipped for that kit. */
function makeKit(name: string): Kit {
  const url = COLORMAPS[name];
  if (!url) throw new Error(`no palette picture for the ${name} models`);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(colormapRedirect(url));
  return { loader: new GLTFLoader(manager), map: null };
}

async function loadModel(kit: Kit, path: string): Promise<Model> {
  const url = urls[`../assets/kenney/${path}.glb`];
  if (!url) throw new Error(`missing model ${path}`);
  let gltf;
  try {
    gltf = await kit.loader.loadAsync(url);
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
  if (map) {
    (map as THREE.Texture).colorSpace = THREE.SRGBColorSpace;
    // every model of a kit reads the same picture: keep one texture for the kit, not one per model
    map = shareOne(kit, map as THREE.Texture);
  }
  return { geo, mat: new THREE.MeshLambertMaterial({ map }), map };
}

/** Tiles visible above and below the roller when close up, which is where the view rests. */
const DEFAULT_HALF_HEIGHT = MIN_HALF_HEIGHT;
const PIXEL_RATIO = 2;
/** Everything (the roller, the zoom, the sky, people and cars) draws up to this often while it moves. */
const MAX_FPS = 60;
/**
 * The shortest gap between two draws. Animation frames come at the display's rate with some jitter: three quarters of a
 * frame lets every frame of a 60 Hz display through, and every other one of a 120 Hz display.
 */
const MIN_FRAME_MS = (1000 / MAX_FPS) * 0.75;
const CAMERA_DISTANCE = 50;
/** A zoomed-out view reaches over 100 units in front of and behind the camera's depth, so the far plane is far. */
const CAMERA_FAR = 400;
/** A streetlight's glow at night: a soft warm disc this many tiles across, centred on the lamp. */
const GLOW_SIZE = 1.1;

/** A white disc that fades to nothing at its edge, to be tinted and added to the picture. */
function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas to draw the lamp glow with");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.2, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

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
  /** One glow disc per streetlight, drawn only at night; they face the camera, which never turns. */
  private glow: THREE.InstancedMesh;
  private glowMaterial: THREE.MeshBasicMaterial;
  private glowFacing = new THREE.Quaternion();
  /** The people and cars on the streets; made once the models are loaded. */
  private traffic!: Traffic;
  /** How lit the windows are, shared by every model's material. */
  private night: NightUniform = { value: 0 };
  /** The sky last put on the lights, the clock and the windows, and the minute it was looked up in. */
  private sky: SkyState | null = null;
  private skyMinute = NaN;
  /** What the instances were last built for (roller cell, city version, 5 s bucket, radius), and a hash of what that put on screen. */
  private builtFor = "";
  private builtKey: number | null = null;
  /** The radius, in cells, the instances were last built out to. */
  private builtRadius = 0;
  /** Tiles visible above and below the middle of the view now; wheel or pinch changes it, and it eases back by itself. */
  private halfHeight = DEFAULT_HALF_HEIGHT;
  /**
   * Where a drag left the camera looking, on the ground in tiles, or null while it follows the roller. A dragged view
   * stays on that spot as the roller drives on, so the city can be looked around.
   */
  private look: { x: number; y: number } | null = null;
  /** While easing back: how far the view's middle still is from the roller, at the start of the easing. */
  private offset = { x: 0, y: 0 };
  /** When the view was last dragged or zoomed (the clock `update` is given), and the easing back once it has begun. */
  private viewedAt = -Infinity;
  private easing: { from: number; offset: { x: number; y: number }; since: number } | null = null;
  /** Where the roller was when last drawn, and whether something outside it needs a draw. */
  private lastMove = "";
  private stale = true;
  private lastRender = -Infinity;
  /** Paused (the window is a sketch, or hidden): nothing is looked at or drawn until `resume`. */
  private paused = false;
  /** The traffic's faults, so that one that keeps coming is said once, not at every look, and another one is said when it comes. */
  private trafficFault = new FaultOnce();
  /** What the HUD line was last made of, and the number of houses it counted (at most once a second: counting runs through every lot). */
  private statLast = { road: -1, houses: -1, cars: -1, people: -1, parked: false, text: "" };
  private housesAt = { version: -1, second: -1, lots: -1, n: 0 };

  /**
   * `clock` tells the time of day the sky follows; it is a parameter so a test or the dev page can show another hour.
   * `trafficClock` tells the time the people and cars follow (their day is the real one: the fast-forward that
   * previews the sky does not move them); it is the sky's clock unless given.
   */
  constructor(
    private sim: CitySim,
    private width: number,
    private height: number,
    private clock: () => Date = () => new Date(),
    private trafficClock: () => Date = clock,
  ) {
    // Lambert shading, no shadows, no antialiasing: the cheapest picture that still reads as 3D.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "low-power" });
    this.renderer.setPixelRatio(PIXEL_RATIO);
    this.renderer.setSize(width, height);
    this.canvas = this.renderer.domElement;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, CAMERA_FAR);
    this.setHalfHeight(DEFAULT_HALF_HEIGHT);
    this.hemisphere = new THREE.HemisphereLight(SKY_DAY, 0x6a8a50, AMBIENT_DAY);
    this.scene.add(this.hemisphere);
    this.sunLight = new THREE.DirectionalLight(SUN_COLOUR_DAY, SUN_DAY);
    this.sunLight.position.set(4, 10, 2);
    this.scene.add(this.sunLight);
    this.glowMaterial = new THREE.MeshBasicMaterial({
      map: glowTexture(),
      color: WINDOW_LIT,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.glowFacing.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(Math.cos(ELEVATION) * Math.SQRT1_2, Math.sin(ELEVATION), Math.cos(ELEVATION) * Math.SQRT1_2),
    );
    this.glow = this.makeGlow(64);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x8ccf68 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.scene.add(this.ground);
    this.updateSky();
  }

  /** Loads every model; call once before the first update. */
  async load(): Promise<void> {
    const kits = new Map<string, Kit>();
    const kitFor = (model: string): Kit => {
      const name = kitOf(model);
      let kit = kits.get(name);
      if (!kit) kits.set(name, (kit = makeKit(name)));
      return kit;
    };
    await Promise.all(MODEL_NAMES.map(async (n) => this.models.set(n, await loadModel(kitFor(n), n))));
    this.patchMaterials();
    const r = this.models.get(ROLLER.model)!;
    this.roller = new THREE.Mesh(r.geo, r.mat);
    this.roller.scale.setScalar(ROLLER.scale);
    this.scene.add(this.roller);
    this.traffic = new Traffic(this.scene, this.models);
    this.invalidate();
  }

  /**
   * Suburban models swap their roof green for the colour of each instance (houses use it; trees and planters
   * have no roof green, so it does nothing to them) and light their windows at night; commercial buildings
   * only light their windows; roads draw their asphalt in the instance colour. Every other model is left as it is.
   */
  private patchMaterials(): void {
    const of = (prefix: string) => [...this.models].filter(([name]) => name.startsWith(prefix)).map(([, m]) => m);
    const suburban = of("suburban/");
    const image = suburban[0]?.map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
    if (!image) throw new Error("suburban models have no palette texture");
    const roofTexel = readTexel(image, ROOF_TEXEL.x, ROOF_TEXEL.y);
    for (const m of suburban) patchPalette(m.mat, roofTexel, this.night);
    for (const m of of("commercial/")) patchWindows(m.mat, this.night);
    for (const m of of("roads/")) patchAsphalt(m.mat);
  }

  /** An instanced mesh of `capacity` glow discs, none placed yet. */
  private makeGlow(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.glowMaterial, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.visible = (this.sky?.night ?? 0) > 0;
    this.scene.add(mesh);
    return mesh;
  }

  /** Put a glow disc on the lamp of every streetlight in `placed`. */
  private placeGlow(placed: readonly Placement[]): void {
    const lamps = placed.filter((p) => p.model === LIGHT);
    if (this.glow.instanceMatrix.count < lamps.length) {
      this.scene.remove(this.glow);
      this.glow.geometry.dispose();
      this.glow.dispose();
      this.glow = this.makeGlow(Math.max(64, lamps.length * 2));
    }
    const m = new THREE.Matrix4();
    const at = new THREE.Vector3();
    const size = new THREE.Vector3(GLOW_SIZE, GLOW_SIZE, GLOW_SIZE);
    lamps.forEach((p, i) => {
      const head = lampHead(p);
      this.glow.setMatrixAt(i, m.compose(at.set(head.x, head.y, head.z), this.glowFacing, size));
    });
    this.glow.count = lamps.length;
    this.glow.instanceMatrix.needsUpdate = true;
  }

  /**
   * Look up the sky for the time of day, once in each minute of the clock, and put it on the two
   * lights (their colours and strengths), the windows and the streetlight glow. Returns true when
   * that is different from what was drawn: it stays the same through the full day and the full
   * night, so a parked city is not redrawn.
   */
  private updateSky(): boolean {
    const d = this.clock();
    const minute = Math.floor(d.getTime() / 60_000);
    if (minute === this.skyMinute) return false;
    this.skyMinute = minute;
    const s = skyAt(d);
    if (this.sky && sameSky(s, this.sky)) return false;
    this.sky = s;
    this.hemisphere.color.setHex(s.sky);
    this.hemisphere.intensity = s.ambient;
    this.sunLight.color.setHex(s.sunColour);
    this.sunLight.intensity = s.sun;
    this.night.value = s.night;
    this.glowMaterial.opacity = s.night;
    this.glow.visible = s.night > 0;
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
    this.halfHeight = h;
    const aspect = this.width / this.height;
    const c = this.camera;
    c.left = -h * aspect;
    c.right = h * aspect;
    c.top = h;
    c.bottom = -h;
    c.updateProjectionMatrix();
    this.invalidate();
  }

  /** Zoom to `h` tiles (kept between 5 and 60) because of an input at `now`: it stays there for 10 s after the last drag or zoom. */
  zoomTo(h: number, now: number = performance.now()): void {
    h = clampHalfHeight(h);
    this.holdView(now);
    if (h !== this.halfHeight) this.setHalfHeight(h);
  }

  /**
   * Move the view as a drag of (dx, dy) CSS pixels at `now` does: the ground under the pointer follows it. From then on
   * the view stays on that spot, not on the roller, until it has been left alone for 10 s.
   */
  panBy(dxPx: number, dyPx: number, now: number = performance.now()): void {
    const from = this.center(this.sim.rollerAt());
    this.holdView(now);
    const d = panDelta(dxPx, dyPx, this.halfHeight, this.height);
    this.look = { x: from.x + d.x, y: from.y + d.y };
    this.invalidate();
  }

  /** A drag or zoom at `now`: the view holds where it is (stopping any easing back, from where that had got to). */
  private holdView(now: number): void {
    this.viewedAt = now;
    if (!this.easing) return;
    this.easing = null;
    const at = this.sim.rollerAt();
    if (this.offset.x !== 0 || this.offset.y !== 0) this.look = { x: at.x + this.offset.x, y: at.y + this.offset.y };
    this.offset = { x: 0, y: 0 };
  }

  /** The middle of the view: the spot a drag left it on, else the roller (plus what is left of an easing back). */
  private center(at: { x: number; y: number }): { x: number; y: number } {
    return this.look ?? { x: at.x + this.offset.x, y: at.y + this.offset.y };
  }

  /**
   * Wheel or pinch on the canvas zooms, and never scrolls or zooms the page. A trackpad pinch is a wheel
   * event with ctrlKey in Chromium; WebKit (the Tauri window) sends gesture events instead, whose scale is
   * the pinch's total so far.
   */
  attachZoom(): void {
    const c = this.canvas;
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault(); // even a sideways scroll, which only does not count as a zoom
        const h = wheelZoomTarget(this.halfHeight, e.deltaY, e.deltaMode, e.ctrlKey);
        if (h !== null) this.zoomTo(h);
      },
      { passive: false },
    );
    let from = this.halfHeight;
    c.addEventListener("gesturestart", (e) => {
      e.preventDefault();
      from = this.halfHeight;
    });
    c.addEventListener("gesturechange", (e) => {
      e.preventDefault();
      const scale = (e as Event & { scale?: number }).scale;
      if (scale && scale > 0 && Number.isFinite(scale)) this.zoomTo(from / scale);
    });
  }

  /**
   * Press and drag on the canvas moves the view, the city following the hand, while `allowed()` says so (the window
   * only allows it in its full 3D mode, where a drag does not move the window). The cursor still drives the roller
   * meanwhile: everything the cursor does counts.
   */
  attachPan(allowed: () => boolean): void {
    const c = this.canvas;
    let last: { x: number; y: number; id: number } | null = null;
    c.style.cursor = "grab";
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !allowed()) return;
      last = { x: e.clientX, y: e.clientY, id: e.pointerId };
      c.setPointerCapture(e.pointerId);
      c.style.cursor = "grabbing";
    });
    c.addEventListener("pointermove", (e) => {
      if (!last || e.pointerId !== last.id) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      if (dx === 0 && dy === 0) return;
      last.x = e.clientX;
      last.y = e.clientY;
      this.panBy(dx, dy);
    });
    const end = (e: PointerEvent) => {
      if (!last || e.pointerId !== last.id) return;
      last = null;
      c.style.cursor = "grab";
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }

  /**
   * Once the view has been left alone for 10 s, ease it back over 600 ms: the zoom to the close-up and the middle onto
   * the roller, together (onto where the roller is by then, as it may be driving). Returns true while the view changes.
   */
  private stepView(now: number): boolean {
    if (!this.easing) {
      if (this.halfHeight === DEFAULT_HALF_HEIGHT && !this.look) return false;
      if (now - this.viewedAt < VIEW_HOLD_MS) return false;
      const at = this.sim.rollerAt();
      const offset = this.look ? { x: this.look.x - at.x, y: this.look.y - at.y } : { x: 0, y: 0 };
      this.easing = { from: this.halfHeight, offset, since: now };
      this.look = null;
    }
    const elapsed = now - this.easing.since;
    const left = easeBackLeft(elapsed);
    this.offset = { x: this.easing.offset.x * left, y: this.easing.offset.y * left };
    const h = easeHalfHeight(this.easing.from, elapsed);
    if (elapsed >= EASE_BACK_MS) {
      this.easing = null;
      this.offset = { x: 0, y: 0 };
    }
    if (h !== this.halfHeight) this.setHalfHeight(h);
    this.invalidate();
    return true;
  }

  /** Draw again on the next update, e.g. after the canvas was hidden. */
  invalidate(): void {
    this.stale = true;
  }

  /** Stop looking and drawing: `update` does nothing until `resume`. */
  pause(): void {
    this.paused = true;
  }

  /** Look and draw again, starting with one draw of how things are now. */
  resume(): void {
    this.paused = false;
    this.invalidate();
  }

  /** What the traffic's last pass found, for a look from the dev page's console. */
  trafficInfo(): ReturnType<Traffic["info"]> {
    return this.traffic ? this.traffic.info() : null;
  }

  /**
   * The HUD line, which the window asks for at every frame: it is made again only when something in it differs, and the
   * houses are counted at most once a second (or when the city changes), not at every frame.
   */
  stat(): string {
    const sim = this.sim;
    const t = sim.time();
    const h = this.housesAt;
    const second = Math.floor(t / 1000);
    if (h.version !== sim.version || h.second !== second || h.lots !== sim.lots.size) {
      h.version = sim.version;
      h.second = second;
      h.lots = sim.lots.size;
      h.n = sim.houses(t);
    }
    const parked = sim.parked();
    const { cars, people } = this.traffic ? this.traffic.drawn() : { cars: 0, people: 0 };
    const s = this.statLast;
    if (s.road === sim.road.size && s.houses === h.n && s.cars === cars && s.people === people && s.parked === parked) return s.text;
    const out = cars + people > 0 ? ` · ${people} people · ${cars} cars` : "";
    Object.assign(s, {
      road: sim.road.size,
      houses: h.n,
      cars,
      people,
      parked,
      text: `${sim.road.size.toLocaleString()} road tiles · ${h.n.toLocaleString()} houses${out}${parked ? " · parked" : ""}`,
    });
    return s.text;
  }

  /**
   * Rebuild instances around the middle of the view `at` (the roller, unless the view was dragged): only cells within
   * `radius` are drawn. Returns false, touching nothing, when that is exactly what is already on screen.
   */
  private rebuild(t: number, radius: number, at: { x: number; y: number }): boolean {
    const has = (x: number, y: number) => this.sim.road.has(cellKey(x, y));
    const looks: Looks = {
      driven: (x, y) => this.sim.road.get(cellKey(x, y)) ?? 0,
      built: (x, y) => this.sim.lots.get(cellKey(x, y)) ?? 0,
      kind: (x, y) => this.sim.lotKind(x, y),
    };
    const placed = layoutCells(has, (x, y) => this.sim.houseTier(x, y, t), Math.round(at.x), Math.round(at.y), radius, looks);
    this.builtRadius = radius;
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
    this.placeGlow(placed);
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

  /**
   * Draw if something changed, at most MAX_FPS times a second. A parked city with nobody out is not drawn at all, nor is
   * a paused one. Returns true when it drew.
   */
  update(now: number): boolean {
    if (!this.roller || this.paused || now - this.lastRender < MIN_FRAME_MS) return false;
    const t = this.sim.time();
    const at = this.sim.rollerAt();
    let changed = this.stepView(now);
    // the middle of the view: the roller, or where a drag left it
    const c = this.center(at);
    const move = `${Math.round(at.x * 32)},${Math.round(at.y * 32)},${this.sim.roller.dir},${Math.round(c.x * 32)},${Math.round(c.y * 32)}`;
    if (this.stale || move !== this.lastMove) changed = true;
    if (this.updateSky()) changed = true;
    // Zoomed out, build as far as the view needs and keep that while easing back, so the way in does not
    // rebuild a big layout every frame; the radius drops once the view is back at the close-up.
    const need = viewRadius(this.halfHeight);
    const radius = this.halfHeight > DEFAULT_HALF_HEIGHT ? Math.max(need, this.builtRadius) : need;
    // Check the surroundings when the middle of the view has moved a few cells, the city changed, the view needs
    // another radius, or every 5 s (a house can age into a bigger one). It only counts as a change if
    // what is drawn differs.
    const cellSig = `${Math.round(c.x / 4)},${Math.round(c.y / 4)},${this.sim.version},${Math.floor(t / 5000)},${radius}`;
    if (cellSig !== this.builtFor) {
      this.builtFor = cellSig;
      if (this.rebuild(t, radius, c)) changed = true;
    }
    // The traffic is asked at every frame; it reports whether anybody moved or came or went. Its heavy work is in tasks
    // of its own: this only draws what they found.
    try {
      if (this.traffic.update(this.sim, this.trafficClock(), [c.x, c.y], trafficRadius(this.halfHeight))) changed = true;
      this.trafficFault.ok();
    } catch (e) {
      // a fault in the traffic must not stop the city drawing: say it once (and again if it is another one), carry on without it
      if (this.trafficFault.fail(e)) console.error("the traffic failed; the city goes on without it", e);
    }
    if (!changed) return false;
    this.stale = false;
    this.lastMove = move;
    this.roller.position.set(at.x, 0.02, at.y);
    this.roller.rotation.y = ROLLER.yaw[this.sim.roller.dir];
    // Back far enough that the near edge of a zoomed-out ground is still in front of the camera.
    const distance = Math.max(CAMERA_DISTANCE, 2 * this.halfHeight + 10);
    const flat = distance * Math.cos(ELEVATION) * Math.SQRT1_2;
    this.camera.position.set(c.x + flat, distance * Math.sin(ELEVATION), c.y + flat);
    this.camera.lookAt(c.x, 0, c.y);
    this.ground.position.set(c.x, -0.01, c.y);
    this.renderer.render(this.scene, this.camera);
    this.lastRender = now;
    return true;
  }
}
