import "./window.css";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Application } from "pixi.js";
import { CITY } from "./config";
import { parseJsonl, type TouchRecord } from "./data";
import { Feeder, liveTime } from "./drive";
import { Heat } from "./heat";
import { CityView3D } from "./render/city3d";
import { HeatView } from "./render/heat";
import { PANEL_H, PANEL_W } from "./render/panel";
import { CitySim } from "./sims/city";
import type { Sim } from "./sims/types";

const TABS = ["City", "Heat"];
const TAB_KEY = "trackpad.tab";
const CITY_TAB = 0;
const HEAT_TAB = 1;
/** The city is saved this often, and when the window closes. */
const SAVE_EVERY_MS = 5 * 60_000;

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

/** The saved city, or null when there is none, it can't be read, or its rules have changed. */
async function loadCity(): Promise<CitySim | null> {
  try {
    const text = await invoke<string>("load_snapshot");
    return text ? CitySim.restore(CITY, JSON.parse(text)) : null;
  } catch {
    return null; // broken snapshot text counts as no snapshot
  }
}

/** Saves queue behind each other: the Rust side writes one temp file, so two must never overlap. */
let saving: Promise<void> = Promise.resolve();
function saveCity(city: CitySim): void {
  const json = JSON.stringify(city.snapshot());
  saving = saving.then(() => invoke<void>("save_snapshot", { json })).catch(() => undefined);
}

async function boot() {
  if (!isTauri()) {
    hudEl.textContent = "Open this page from the Capture app";
    return;
  }
  // The window stays open all day, so render only when something changed.
  // The City tab is its own 3D canvas; the Heat tab is Pixi.
  const app = new Application();
  await app.init({ width: PANEL_W, height: PANEL_H, background: "#111111", antialias: false, roundPixels: true, autoStart: false });
  const heatCanvas = app.canvas as HTMLCanvasElement;

  // Records are screen points. The heat map keeps today's points and scales itself to the area they cover,
  // so it needs no display sizes (and follows a display docked later); the fingers are drawn in the same points.
  const heat = new Heat(64, 40);
  const fingers = new Map<number, { x: number; y: number }>();
  // The city is the saved snapshot plus every record after it; with no snapshot, every day on disk.
  const saved = await loadCity();
  const city = saved ?? new CitySim(CITY);
  const sims: Sim[] = [city];
  const cityView = new CityView3D(city, PANEL_W, PANEL_H);
  await cityView.load();
  cityView.attachZoom();
  const heatView = new HeatView(heat, fingers);
  app.stage.addChild(heatView.root);
  stageEl.append(cityView.canvas, heatCanvas);
  const feeder = new Feeder(() => sims);

  function take(r: TouchRecord) {
    if (r.state === "up") {
      fingers.delete(r.id);
    } else {
      fingers.set(r.id, { x: r.x, y: r.y });
      heat.add(r.x, r.y, r.t);
    }
    feeder.push(r);
  }

  // Listen before reading the day files so touches made meanwhile are kept.
  const queued: TouchRecord[] = [];
  let ready = false;
  await listen<TouchRecord[]>("touches", (event) => {
    for (const r of event.payload) {
      if (ready) take(r);
      else queued.push(r);
    }
  });

  const source = await invoke<string>("capture_source");
  // The City tab replays every day after the snapshot. The Heat tab shows today only.
  const after = saved ? saved.time() : -Infinity;
  const days = parseJsonl(await invoke<string>("days_text", { fromMs: Math.max(0, Math.floor(after)) }));
  for (const r of days) if (r.t > after) feeder.push(r);
  const today = parseJsonl(await invoke<string>("today_text"));
  for (const r of today) if (r.state !== "up") heat.add(r.x, r.y, r.t);
  // Queued touches that already made it into the files were counted above.
  const lastT = (rs: TouchRecord[]) => (rs.length ? rs[rs.length - 1].t : -Infinity);
  const lastInFile = Math.max(lastT(days), lastT(today));
  for (const r of queued.splice(0)) if (r.t > lastInFile) take(r);
  ready = true;

  let active = savedTab();
  let heatSig = "";
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
    // only the active tab's canvas is visible, and it repaints once it is shown again
    cityView.canvas.style.display = i === CITY_TAB ? "block" : "none";
    heatCanvas.style.display = i === HEAT_TAB ? "block" : "none";
    cityView.invalidate();
    heatSig = "";
    buttons.forEach((b, j) => b.classList.toggle("on", j === i));
    saveTab(i);
  }

  window.addEventListener("keydown", (e) => {
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= TABS.length) show(n - 1);
  });
  show(active);

  let hud = "";
  function frame() {
    const now = performance.now();
    for (const sim of sims) sim.advanceTo(liveTime(Date.now()));
    // Each tab repaints only for changes it shows. The 3D city decides for itself
    // (the roller moves on its own); the heat map repaints on each point and when the pointer lifts.
    if (active === CITY_TAB) {
      cityView.update(now);
    } else {
      heat.rollTo(Date.now()); // a window left open past midnight shows the new day, empty, before its first touch
      const sig = `${heat.version},${fingers.size}`;
      if (sig !== heatSig) {
        heatSig = sig;
        heatView.update(now);
        app.render();
      }
    }
    const text = `${(active === CITY_TAB ? cityView : heatView).stat()} · ${source}`;
    if (text !== hud) hudEl.textContent = hud = text;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  setInterval(() => saveCity(city), SAVE_EVERY_MS);
  // Closing the window waits for the save to land; the window is then destroyed (which the capability allows).
  await getCurrentWindow().onCloseRequested(async () => {
    try {
      saveCity(city);
      await saving;
    } catch (e) {
      console.error("could not save the city on close", e); // never block closing
    }
  });
  window.addEventListener("beforeunload", () => saveCity(city)); // best effort, for a reload
}

// A model that fails to load (or anything else in boot) would leave a blank window: say why.
boot().catch((e: unknown) => {
  console.error(e);
  hudEl.textContent = `Could not start: ${e instanceof Error ? e.message : String(e)}`;
});
