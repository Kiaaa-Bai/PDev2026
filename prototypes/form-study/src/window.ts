import "./window.css";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Application } from "pixi.js";
import { CITY } from "./config";
import { parseJsonl, type TouchRecord } from "./data";
import { Feeder } from "./drive";
import { Heat, type Bounds } from "./heat";
import { CityView } from "./render/city";
import { HeatView } from "./render/heat";
import { PANEL_H, PANEL_W } from "./render/panel";
import { CitySim } from "./sims/city";
import type { Sim } from "./sims/types";
import { loadTiles } from "./tiles";

const TABS = ["City", "Heat"];
const TAB_KEY = "trackpad.tab";
const CITY_TAB = 0;
const HEAT_TAB = 1;
/** Keep repainting this long after a change, so a short animation can play out. */
const SETTLE_MS = 400;

const tabsEl = document.querySelector<HTMLElement>("#tabs")!;
const stageEl = document.querySelector<HTMLElement>("#stage")!;
const hudEl = document.querySelector<HTMLElement>("#hud")!;

function savedTab(): number {
  try {
    const n = Number(localStorage.getItem(TAB_KEY));
    return Number.isInteger(n) && n >= 0 && n < TABS.length ? n : 0;
  } catch {
    return 0;
  }
}

function saveTab(i: number): void {
  try {
    localStorage.setItem(TAB_KEY, String(i));
  } catch {
    // storage blocked: the tab just isn't remembered
  }
}

async function boot() {
  if (!isTauri()) {
    hudEl.textContent = "Open this page from the Capture app";
    return;
  }
  await loadTiles();
  // The window stays open all day, so render only when something changed.
  const app = new Application();
  await app.init({ width: PANEL_W, height: PANEL_H, background: "#111111", antialias: false, roundPixels: true, autoStart: false });
  stageEl.append(app.canvas as HTMLCanvasElement);

  // Records are screen points; the heat map wants them in 0–1 over the displays.
  const [bx, by, bw, bh] = await invoke<number[]>("display_bounds");
  const bounds: Bounds = [bx, by, bw, bh];
  const unit = (v: number, from: number, size: number) => Math.min(1, Math.max(0, (v - from) / size));

  const heat = new Heat(64, 40);
  const fingers = new Map<number, { x: number; y: number }>();
  const city = new CitySim(CITY);
  const sims: Sim[] = [city];
  const views = [new CityView(city), new HeatView(heat, fingers)];
  views.forEach((v) => app.stage.addChild(v.root));
  const feeder = new Feeder(() => sims);

  function take(r: TouchRecord) {
    if (r.state === "up") {
      fingers.delete(r.id);
    } else {
      fingers.set(r.id, { x: unit(r.x, bx, bw), y: unit(r.y, by, bh) });
      heat.addPoint(r.x, r.y, bounds);
    }
    feeder.push(r);
  }

  // Listen before reading today's file so touches made meanwhile are kept.
  const queued: TouchRecord[] = [];
  let ready = false;
  await listen<TouchRecord[]>("touches", (event) => {
    for (const r of event.payload) {
      if (ready) take(r);
      else queued.push(r);
    }
  });

  const source = await invoke<string>("capture_source");
  const today = parseJsonl(await invoke<string>("today_text"));
  for (const r of today) {
    if (r.state !== "up") heat.addPoint(r.x, r.y, bounds);
    feeder.push(r);
  }
  // Queued touches that already made it into the file were counted above.
  const lastInFile = today.length ? today[today.length - 1].t : -Infinity;
  for (const r of queued.splice(0)) if (r.t > lastInFile) take(r);
  ready = true;

  let active = savedTab();
  let shown = -1;
  const buttons = TABS.map((name, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `${name}`;
    b.title = `${name} (${i + 1})`;
    b.addEventListener("click", () => show(i));
    tabsEl.append(b);
    return b;
  });

  function show(i: number) {
    active = i;
    views.forEach((v, j) => (v.root.visible = j === i));
    buttons.forEach((b, j) => b.classList.toggle("on", j === i));
    saveTab(i);
  }

  window.addEventListener("keydown", (e) => {
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= TABS.length) show(n - 1);
  });
  show(active);

  let lastSig = "";
  let changedAt = 0;
  let hud = "";
  function frame() {
    const now = performance.now();
    for (const sim of sims) sim.advanceTo(Date.now());
    // Each tab repaints only for changes it shows. The roller moves on its own,
    // so the City tab repaints as it crosses each pixel.
    const at = city.rollerAt();
    const cityState =
      active === CITY_TAB ? `${city.version},${Math.round(at.x * 16)},${Math.round(at.y * 16)},${Math.floor(city.time() / 5000)}` : "";
    // The heat map repaints on each point and when the pointer lifts.
    const heatState = active === HEAT_TAB ? `${heat.version},${fingers.size}` : "";
    const sig = [active, cityState, heatState].join(",");
    if (sig !== lastSig || shown !== active) {
      lastSig = sig;
      shown = active;
      changedAt = now;
    }
    if (now - changedAt < SETTLE_MS) {
      views.forEach((v) => v.update(now));
      app.render();
    }
    const text = `${views[active].stat()} · ${source}`;
    if (text !== hud) hudEl.textContent = hud = text;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot();
