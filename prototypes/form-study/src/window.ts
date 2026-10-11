import "./window.css";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Application } from "pixi.js";
import { CITY, FARM, MONSTER } from "./config";
import { parseJsonl, type TouchRecord } from "./data";
import { Feeder } from "./drive";
import { Heat } from "./heat";
import { CityView } from "./render/city";
import { FarmView } from "./render/farm";
import { HeatView } from "./render/heat";
import { MonsterView } from "./render/monster";
import { PANEL_H, PANEL_W } from "./render/panel";
import { CitySim } from "./sims/city";
import { FarmSim } from "./sims/farm";
import { MonsterSim } from "./sims/monster";
import type { Sim } from "./sims/types";
import { loadTiles } from "./tiles";

const TABS = ["Heat", "City", "Farm", "Monster"];
const TAB_KEY = "trackpad.tab";
const CITY_TAB = 1;
/** Keep repainting this long after a change, so the defeat flash can play out. */
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

  const heat = new Heat(64, 40);
  const fingers = new Map<number, { x: number; y: number }>();
  const city = new CitySim(CITY);
  const farm = new FarmSim(FARM);
  const monster = new MonsterSim(MONSTER);
  const sims: Sim[] = [city, farm, monster];
  const views = [new HeatView(heat, fingers), new CityView(city), new FarmView(farm, fingers), new MonsterView(monster, fingers)];
  views.forEach((v) => app.stage.addChild(v.root));
  const feeder = new Feeder(() => sims);
  let touched = 0;

  function take(r: TouchRecord) {
    touched++;
    if (r.state === "up") {
      fingers.delete(r.id);
    } else {
      fingers.set(r.id, { x: r.x, y: r.y });
      heat.add(r.x, r.y);
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
    if (r.state !== "up") heat.add(r.x, r.y);
    feeder.push(r);
  }
  monster.poofs.length = 0;
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
    // The roller moves on its own, so the City tab repaints as it crosses each pixel.
    const at = city.rollerAt();
    const cityMotion = active === CITY_TAB ? `${Math.round(at.x * 16)},${Math.round(at.y * 16)},${Math.floor(city.time() / 5000)}` : "";
    const sig = [heat.version, city.version, farm.version, monster.version, touched, active, cityMotion].join(",");
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
