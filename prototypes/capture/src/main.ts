import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type TouchRecord = { t: number; id: number; x: number; y: number; state: "down" | "move" | "up" };

const COLS = 64;
const ROWS = 40;

const canvas = document.querySelector<HTMLCanvasElement>("#pad")!;
const countEl = document.querySelector<HTMLElement>("#count")!;
const sourceEl = document.querySelector<HTMLElement>("#source")!;
const ctx = canvas.getContext("2d")!;

const heat = new Uint32Array(COLS * ROWS);
const fingers = new Map<number, { x: number; y: number }>();
let total = 0;
let maxHeat = 1;

function fit() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}

function addHeat(x: number, y: number) {
  const c = Math.min(COLS - 1, Math.floor(x * COLS));
  const r = Math.min(ROWS - 1, Math.floor(y * ROWS));
  const i = r * COLS + c;
  heat[i] += 1;
  if (heat[i] > maxHeat) maxHeat = heat[i];
  total += 1;
}

function draw() {
  const w = canvas.width;
  const h = canvas.height;
  const dpr = window.devicePixelRatio || 1;
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, w, h);
  const cw = w / COLS;
  const ch = h / ROWS;
  for (let i = 0; i < heat.length; i++) {
    if (!heat[i]) continue;
    // sqrt so light use still shows next to the busiest cell
    const a = Math.sqrt(heat[i] / maxHeat);
    ctx.fillStyle = `rgba(255, 170, 80, ${a.toFixed(3)})`;
    ctx.fillRect((i % COLS) * cw, Math.floor(i / COLS) * ch, Math.ceil(cw), Math.ceil(ch));
  }
  ctx.fillStyle = "#fff";
  for (const f of fingers.values()) {
    ctx.beginPath();
    ctx.arc(f.x * w, f.y * h, 5 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }
  countEl.textContent = total.toLocaleString();
  requestAnimationFrame(draw);
}

async function main() {
  fit();
  window.addEventListener("resize", fit);
  sourceEl.textContent = await invoke<string>("capture_source");
  const saved = await invoke<number[]>("today_heat", { cols: COLS, rows: ROWS });
  saved.forEach((v, i) => {
    heat[i] = v;
    total += v;
    if (v > maxHeat) maxHeat = v;
  });
  await listen<TouchRecord[]>("touches", (event) => {
    for (const r of event.payload) {
      if (r.state === "up") {
        fingers.delete(r.id);
      } else {
        fingers.set(r.id, { x: r.x, y: r.y });
        addHeat(r.x, r.y);
      }
    }
  });
  requestAnimationFrame(draw);
}

main();
