// THROWAWAY performance spike (2026-11-03): Kenney 3D models drawn live with
// Three.js, to measure the cost against the 2D window. Not part of the design.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { cellKey, type CitySim } from "./sims/city";

const urls = import.meta.glob("./assets/kenney/**/*.glb", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

interface Model {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
}

async function loadModel(loader: GLTFLoader, path: string): Promise<Model> {
  const url = urls[`./assets/kenney/${path}.glb`];
  if (!url) throw new Error(`missing model ${path}`);
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  let map: THREE.Texture | null = null;
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
    parts.push(g.index ? g.toNonIndexed() : g);
    map ??= (mesh.material as THREE.MeshStandardMaterial).map;
  });
  const geo = mergeGeometries(parts)!;
  if (map) (map as THREE.Texture).colorSpace = THREE.SRGBColorSpace;
  return { geo, mat: new THREE.MeshLambertMaterial({ map }) };
}

/** Road neighbour bits: N=1 E=2 S=4 W=8. Rotating +90° about Y turns S→E→N→W→S. */
const rotMask = (m: number) => ((m & 1) << 3) | ((m & 2) >> 1) | ((m & 4) >> 1) | ((m & 8) >> 1);

/** Each road piece with the neighbours it joins at rotation 0. */
const ROAD_BASE: [string, number][] = [
  ["roads/road-square", 0],
  ["roads/road-end", 4],
  ["roads/road-straight", 5],
  ["roads/road-bend", 6],
  ["roads/road-intersection", 7],
  ["roads/road-crossroad", 15],
];

function roadPiece(mask: number): { name: string; turns: number } {
  for (const [name, base] of ROAD_BASE) {
    let m = base;
    for (let k = 0; k < 4; k++) {
      if (m === mask) return { name, turns: k };
      m = rotMask(m);
    }
  }
  return { name: "roads/road-square", turns: 0 };
}

const HOUSES = [
  "abcdefg".split("").map((c) => `suburban/building-type-${c}`),
  "hijklmn".split("").map((c) => `suburban/building-type-${c}`),
  "abcdefghijklmn".split("").map((c) => `commercial/building-${c}`),
];

const VIEW_RADIUS = 30;
const HALF_HEIGHT = 5; // tiles visible above and below the roller

export class ThreeCityView {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private models = new Map<string, Model>();
  private meshes = new Map<string, THREE.InstancedMesh>();
  private roller!: THREE.Mesh;
  private builtFor = "";
  private lastSig = "";
  private lastRender = 0;
  frames = 0;

  constructor(private sim: CitySim, readonly width: number, readonly height: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "low-power" });
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0x9fd3e8);
    this.canvas = this.renderer.domElement;
    const aspect = width / height;
    this.camera = new THREE.OrthographicCamera(-HALF_HEIGHT * aspect, HALF_HEIGHT * aspect, HALF_HEIGHT, -HALF_HEIGHT, 0.1, 200);
    this.scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x6a8a50, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(4, 10, 2);
    this.scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x8ccf68 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.name = "ground";
    this.scene.add(ground);
  }

  async load(): Promise<void> {
    const loader = new GLTFLoader();
    const names = [...ROAD_BASE.map(([n]) => n), ...HOUSES.flat(), "car/tractor-shovel"];
    await Promise.all(names.map(async (n) => this.models.set(n, await loadModel(loader, n))));
    const r = this.models.get("car/tractor-shovel")!;
    this.roller = new THREE.Mesh(r.geo, r.mat);
    this.roller.scale.setScalar(0.4);
    this.scene.add(this.roller);
  }

  setPixelRatio(r: number): void {
    this.renderer.setPixelRatio(r);
    this.renderer.setSize(this.width, this.height);
    this.lastSig = "";
  }

  /** Rebuild instances around the roller: only cells within VIEW_RADIUS are drawn. */
  private rebuild(t: number): void {
    const at = this.sim.rollerAt();
    const cx = Math.round(at.x);
    const cy = Math.round(at.y);
    const buckets = new Map<string, THREE.Matrix4[]>();
    const put = (name: string, x: number, y: number, turns: number, scale: number) => {
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, 0, y),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (turns * Math.PI) / 2),
        new THREE.Vector3(scale, scale, scale),
      );
      let list = buckets.get(name);
      if (!list) buckets.set(name, (list = []));
      list.push(m);
    };
    const has = (x: number, y: number) => this.sim.road.has(cellKey(x, y));
    for (let y = cy - VIEW_RADIUS; y <= cy + VIEW_RADIUS; y++) {
      for (let x = cx - VIEW_RADIUS; x <= cx + VIEW_RADIUS; x++) {
        if (has(x, y)) {
          const mask = (has(x, y - 1) ? 1 : 0) | (has(x + 1, y) ? 2 : 0) | (has(x, y + 1) ? 4 : 0) | (has(x - 1, y) ? 8 : 0);
          const p = roadPiece(mask);
          put(p.name, x, y, p.turns, 1);
          continue;
        }
        const tier = this.sim.houseTier(x, y, t);
        if (!tier) continue;
        // face the first road neighbour: model fronts look south (+z) at rotation 0
        const turns = has(x, y + 1) ? 0 : has(x + 1, y) ? 1 : has(x, y - 1) ? 2 : 3;
        const pool = HOUSES[tier - 1];
        const pick = pool[Math.abs((x * 73856093) ^ (y * 19349663)) % pool.length];
        put(pick, x, y, turns, tier === 3 ? 0.8 : 0.7);
      }
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
      list.forEach((m, i) => mesh!.setMatrixAt(i, m));
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Draw if something changed, at most `fps` times a second. Returns true when it drew. */
  update(now: number, fps = 30): boolean {
    if (now - this.lastRender < 1000 / fps) return false;
    const t = this.sim.time();
    const at = this.sim.rollerAt();
    const cellSig = `${Math.round(at.x / 4)},${Math.round(at.y / 4)},${this.sim.version},${Math.floor(t / 5000)}`;
    const sig = `${Math.round(at.x * 32)},${Math.round(at.y * 32)},${cellSig}`;
    if (sig === this.lastSig) return false;
    this.lastSig = sig;
    if (cellSig !== this.builtFor) {
      this.builtFor = cellSig;
      this.rebuild(t);
    }
    this.roller.position.set(at.x, 0.02, at.y);
    // roller model drives toward -z at rotation 0; headings: 0 E, 1 S, 2 W, 3 N
    this.roller.rotation.y = [-Math.PI / 2, Math.PI, Math.PI / 2, 0][this.sim.roller.dir];
    const d = 50;
    const elev = Math.PI / 6;
    this.camera.position.set(at.x + d * Math.cos(elev) * Math.SQRT1_2, d * Math.sin(elev), at.y + d * Math.cos(elev) * Math.SQRT1_2);
    this.camera.lookAt(at.x, 0, at.y);
    this.scene.getObjectByName("ground")!.position.set(at.x, -0.01, at.y);
    this.renderer.render(this.scene, this.camera);
    this.lastRender = now;
    this.frames++;
    return true;
  }
}
