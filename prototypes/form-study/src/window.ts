import "./window.css";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, LogicalPosition, LogicalSize, type Window } from "@tauri-apps/api/window";
import { Application } from "pixi.js";
import { fastForward, hourParam, runningClock } from "./clock";
import { CITY } from "./config";
import { parseJsonl, type TouchRecord } from "./data";
import { Feeder, liveTime } from "./drive";
import { Heat } from "./heat";
import {
  canCollapse,
  click,
  collapse,
  EDGE_H,
  EDGE_W,
  FULL_H,
  FULL_W,
  moved,
  nextTick,
  PEEK_AFTER_MS,
  pointerIn,
  pointerOut,
  samePlace,
  SETTLE_MS,
  settled,
  start,
  step,
  tick,
  UNPEEK_AFTER_MS,
  visibility,
  type Mode,
  type ModeEvent,
  type ModeSettings,
  type ModeState,
  type Rect,
} from "./modes";
import { CityView3D } from "./render/city3d";
import { HeatView } from "./render/heat";
import { skyAt } from "./render/looks";
import { PANEL_H, PANEL_W } from "./render/panel";
import { drawSketch, SKETCH_RADIUS, sketchItems } from "./render/sketch";
import { FaultOnce } from "./render/traffic";
import { CitySim } from "./sims/city";
import type { Sim } from "./sims/types";

const TABS = ["City", "Heat"];
const TAB_KEY = "trackpad.tab";
const ALWAYS_3D_KEY = "trackpad.always3d";
const CITY_TAB = 0;
const HEAT_TAB = 1;
/** The city is saved this often, and when the window closes. */
const SAVE_EVERY_MS = 5 * 60_000;
/** While the mouse button is held after the window stopped moving (a drag paused), it is asked again this often. */
const SETTLE_POLL_MS = 100;
/** The sketch looks for a change this often, so it redraws at most 4 times a second. */
const SKETCH_MS = 250;
/** A press on the sketch that moves this far (CSS pixels) drags the window; one that does not is a click. */
const DRAG_PX = 4;
/** If a drag never moves the window, hovering counts again after this long. */
const DRAG_GIVE_UP_MS = 1000;
const SKETCH_PIXEL_RATIO = 2;

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

function savedAlways3d(): boolean {
  try {
    return localStorage.getItem(ALWAYS_3D_KEY) === "1";
  } catch {
    return false;
  }
}

function saveAlways3d(on: boolean): void {
  try {
    localStorage.setItem(ALWAYS_3D_KEY, on ? "1" : "0");
  } catch {
    // storage blocked: the setting lasts until the window reloads
  }
}

/**
 * Where the window is and the visible frame of its monitor (without the menu bar and the Dock), in screen points: the
 * pointer's records are in points, top-left of the main display, and so is this. Each is read in its own scale.
 */
async function placeOf(win: Window): Promise<{ rect: Rect; monitor: Rect } | null> {
  const [pos, size, scale, mon] = await Promise.all([win.outerPosition(), win.outerSize(), win.scaleFactor(), currentMonitor()]);
  if (!mon) return null;
  const { position, size: area } = mon.workArea;
  const ms = mon.scaleFactor;
  return {
    rect: { x: pos.x / scale, y: pos.y / scale, w: size.width / scale, h: size.height / scale },
    monitor: { x: position.x / ms, y: position.y / ms, w: area.width / ms, h: area.height / ms },
  };
}

const SVG = 'viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" aria-hidden="true"';
/** A small window in the corner of a big one: shrink to the sketch. */
const COLLAPSE_ICON = `<svg ${SVG} stroke-width="1.3"><rect x="1.75" y="3" width="12.5" height="10" rx="1.5"/><rect x="8.25" y="8" width="4.5" height="3.5" rx="0.6" fill="currentColor" stroke="none"/></svg>`;
const GEAR_ICON = `<svg ${SVG}><circle cx="8" cy="8" r="4.1" stroke-width="1.4"/><circle cx="8" cy="8" r="5.6" stroke-width="2.2" stroke-dasharray="2.2 2.2"/><circle cx="8" cy="8" r="1.5" stroke-width="1.3"/></svg>`;

function iconButton(className: string, title: string, icon: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `icon ${className}`;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.innerHTML = icon;
  b.addEventListener("click", onClick);
  return b;
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
  // Holding T fast-forwards the sky through a day (a preview; the city itself keeps the real time).
  let heldSince: number | null = null;
  const params = new URLSearchParams(location.search);
  // Dev only: a window opened as `window.html?hour=8.25` (a `--config` override of the window's url in `tauri dev`) starts
  // the day at that hour and runs on from it, for measuring the morning rush at midday. The app's own url has no query.
  const live = runningClock(hourParam(location.search));
  const skyClock = () => new Date(live().getTime() + (heldSince === null ? 0 : fastForward(performance.now() - heldSince)));
  const cityView = new CityView3D(city, PANEL_W, PANEL_H, skyClock, live);
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

  // ---- Window modes (modes.ts): the full 3D window, the sketch docked at an edge, a peek, and hidden. ----
  const win = getCurrentWindow();
  // Dev only: `window.html?mode=tour` walks the window through its modes with the events the pointer, the buttons and the
  // window would send (the real pointer is not touched), and the HUD counts the frames drawn in each (see `tour`).
  const dev = params.get("mode") === "tour";
  document.body.classList.toggle("dev", dev);
  const settings: ModeSettings = { always3d: savedAlways3d() };
  const place = await placeOf(win).catch((e: unknown) => {
    console.error("could not read where the window is; it stays full", e);
    return null;
  });
  // Without knowing where it is the window cannot dock: it acts as if Always 3D were on (but still draws nothing hidden).
  const docks = place !== null;
  const rules = (): ModeSettings => ({ always3d: settings.always3d || !docks });
  const fallback: Rect = { x: 0, y: 0, w: FULL_W, h: FULL_H };
  let modes: ModeState = start(place?.rect ?? fallback, place?.monitor ?? fallback, rules());
  /** A drag of the sketch is under way: the pointer over the window is the hand moving it, not a hover. */
  let dragging = false;

  const sketch = document.createElement("canvas");
  sketch.id = "sketch";
  sketch.width = EDGE_W * SKETCH_PIXEL_RATIO;
  sketch.height = EDGE_H * SKETCH_PIXEL_RATIO;
  document.body.append(sketch);
  const sketchCtx = sketch.getContext("2d");
  if (!sketchCtx) throw new Error("no 2d canvas to draw the sketch with");

  // Listen before reading the day files so touches made meanwhile are kept.
  const queued: TouchRecord[] = [];
  let ready = false;
  // Dev only: `window.html?quiet=1` leaves out the touches of the real pointer, so the roller stays parked whoever is at the Mac.
  const quiet = params.has("quiet");
  await listen<TouchRecord[]>("touches", (event) => {
    if (quiet) return;
    for (const r of event.payload) {
      if (ready) take(r);
      else queued.push(r);
    }
    // Hovering is read from these records, not from the page's mouse events: they are the global pointer, which the
    // capture sees whichever app is in front, while an always-on-top window that is not focused may get no mouse moves.
    const last = event.payload[event.payload.length - 1];
    if (ready && last) hover(last.x, last.y);
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
  // (No await from here to the end of the set-up below: the touches listener can call `hover` from now on, and
  // everything it reaches must be declared by then.)

  // Dev only: `window.html?drive=1` has the roller driven round a small square (six cells a side) by touches made up here
  // (the real pointer is not touched, nothing is recorded), for measuring a window in use without a hand on the mouse.
  if (params.has("drive")) {
    const legs = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
    const began = Date.now();
    let [x, y] = [400, 300];
    feeder.push({ t: liveTime(began), id: 0, x, y, state: "down" });
    setInterval(() => {
      const [dx, dy] = legs[Math.floor((Date.now() - began) / 6000) % legs.length];
      x += dx * 15;
      y += dy * 15;
      feeder.push({ t: liveTime(Date.now()), id: 0, x, y, state: "move" });
    }, 50);
  }

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

  // The collapse button docks the window at the nearer edge; the gear opens the one setting.
  const grow = document.createElement("span");
  grow.className = "grow";
  const collapseButton = iconButton("collapse", "Dock as a sketch at the edge", COLLAPSE_ICON, () => dispatch(collapse));
  const gearButton = iconButton("gear", "Settings", GEAR_ICON, () => openSettings(settingsEl.hidden));
  gearButton.setAttribute("aria-haspopup", "true");
  tabsEl.append(grow, collapseButton, gearButton);
  const settingsEl = document.createElement("div");
  settingsEl.id = "settings";
  settingsEl.hidden = true;
  const always3dBox = document.createElement("input");
  always3dBox.type = "checkbox";
  always3dBox.role = "switch";
  always3dBox.checked = settings.always3d;
  const always3dLabel = document.createElement("label");
  always3dLabel.append("Always 3D", always3dBox);
  settingsEl.append(always3dLabel);
  document.body.append(settingsEl);
  const showCollapse = () => (collapseButton.hidden = !canCollapse(rules()));
  showCollapse();
  always3dBox.addEventListener("change", () => {
    settings.always3d = always3dBox.checked;
    saveAlways3d(settings.always3d);
    showCollapse();
    dispatch(tick(Date.now())); // a peek on screen opens for good at once
  });
  function openSettings(open: boolean) {
    settingsEl.hidden = !open;
    gearButton.setAttribute("aria-expanded", String(open));
  }
  // a press anywhere else, or Escape, closes it
  window.addEventListener("pointerdown", (e) => {
    if (!settingsEl.hidden && !settingsEl.contains(e.target as Node) && !gearButton.contains(e.target as Node)) openSettings(false);
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
    if (e.key === "Escape") openSettings(false);
    if (e.key === "t" || e.key === "T") {
      heldSince ??= performance.now();
      return;
    }
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= TABS.length) show(n - 1);
  });
  // Letting go of T, or leaving the window, puts the sky back on the real time.
  window.addEventListener("keyup", (e) => {
    if (e.key === "t" || e.key === "T") heldSince = null;
  });
  window.addEventListener("blur", () => (heldSince = null));
  show(active);

  // Dev only: frames drawn per second now, and per mode over the whole run, for the tour's HUD.
  const tally: Record<Mode, { frames: number; ms: number }> = {
    full: { frames: 0, ms: 0 },
    edge: { frames: 0, ms: 0 },
    peek: { frames: 0, ms: 0 },
    hidden: { frames: 0, ms: 0 },
  };
  let tallySince = performance.now();
  const rate = { at: performance.now(), frames: 0, perSecond: 0 };
  let tourSummary = "";
  function counted(drew: boolean, now: number): string {
    if (drew) {
      tally[modes.mode].frames++;
      rate.frames++;
    }
    if (now - rate.at >= 1000) {
      rate.perSecond = Math.round((rate.frames * 1000) / (now - rate.at));
      rate.at = now;
      rate.frames = 0;
    }
    return tourSummary || `${modes.mode} · ${rate.perSecond} drawn/s`;
  }

  function setHud(stat: string) {
    if (stat !== hud) hudEl.textContent = hud = stat;
  }

  // The 3D window draws on animation frames, at most 60 a second and only when something moved.
  let hud = "";
  let raf = 0;
  function frame() {
    const now = performance.now();
    for (const sim of sims) sim.advanceTo(liveTime(Date.now()));
    // Each tab repaints only for changes it shows. The 3D city decides for itself
    // (the roller moves on its own); the heat map repaints on each point and when the pointer lifts.
    let drew = false;
    if (active === CITY_TAB) {
      drew = cityView.update(now);
    } else {
      heat.rollTo(Date.now()); // a window left open past midnight shows the new day, empty, before its first touch
      const sig = `${heat.version},${fingers.size}`;
      if (sig !== heatSig) {
        heatSig = sig;
        heatView.update(now);
        app.render();
        drew = true;
      }
    }
    const stat = `${(active === CITY_TAB ? cityView : heatView).stat()} · ${source}`;
    setHud(dev ? `${counted(drew, now)} · ${stat}` : stat);
    raf = requestAnimationFrame(frame);
  }

  // The sketch looks four times a second and draws when the city changed (a cell paved, a lot made, a turn) or the roller
  // reached another cell, or night came or went; the 3D canvas is paused meanwhile.
  let sketchKey = "";
  let sketchTimer: ReturnType<typeof setTimeout> | undefined;
  const sketchFault = new FaultOnce();
  function sketchFrame() {
    // the next look is booked first, so a fault in this one cannot end the loop
    sketchTimer = setTimeout(sketchFrame, SKETCH_MS);
    try {
      for (const sim of sims) sim.advanceTo(liveTime(Date.now()));
      const at = city.rollerAt();
      const night = skyAt(skyClock()).night >= 0.5;
      const key = `${city.version},${Math.round(at.x)},${Math.round(at.y)},${night}`;
      const drew = key !== sketchKey;
      if (drew) {
        sketchKey = key;
        drawSketch(sketchCtx!, sketchItems(city, at, SKETCH_RADIUS), { night });
      }
      if (dev) setHud(counted(drew, performance.now()));
      sketchFault.ok();
    } catch (e) {
      // said once (and again if it is another fault), then it tries again at the next look
      if (sketchFault.fail(e)) console.error("the sketch could not be drawn; it tries again", e);
    }
  }

  /** Into a mode: what is shown, what is paused, and which loop draws. Hidden runs no loop at all; records still feed the city. */
  function enter(mode: Mode) {
    document.body.dataset.mode = mode;
    cancelAnimationFrame(raf);
    clearTimeout(sketchTimer);
    if (mode === "full" || mode === "peek") {
      cityView.resume(); // one draw of how things are now, caught up
      heatSig = "";
      raf = requestAnimationFrame(frame);
    } else {
      cityView.pause();
      openSettings(false);
    }
    if (mode === "edge") {
      sketchKey = "";
      sketchFrame();
    }
  }

  /**
   * Puts the window where a mode wants it: the sketch borderless (the whole window is the sketch), the others with their
   * title bar. A mode's size is the whole window, as tauri.conf.json's 512 × 380 is; the size set is the content's, so
   * the title bar (whatever this macOS makes it) is taken off.
   */
  let putting: Promise<void> = Promise.resolve();
  function put(s: ModeState) {
    const edge = s.mode === "edge";
    const { x, y } = s.rect;
    putting = putting
      .then(async () => {
        await win.setDecorations(!edge);
        if (edge) {
          await win.setSize(new LogicalSize(EDGE_W, EDGE_H));
        } else {
          const [outer, inner, scale] = await Promise.all([win.outerSize(), win.innerSize(), win.scaleFactor()]);
          await win.setSize(new LogicalSize(FULL_W, FULL_H - (outer.height - inner.height) / scale));
        }
        await win.setPosition(new LogicalPosition(x, y));
      })
      .catch((e: unknown) => console.error("could not put the window in place", e));
  }

  let tickTimer: ReturnType<typeof setTimeout> | undefined;
  function dispatch(ev: ModeEvent) {
    const prev = modes;
    const next = step(prev, ev, rules());
    if (next !== prev) {
      modes = next;
      if (next.mode !== prev.mode) {
        const now = performance.now();
        tally[prev.mode].ms += now - tallySince;
        tallySince = now;
        enter(next.mode);
      }
      // coming back from hidden, or moved by the person, the window is already where it should be
      const shown = next.mode !== "hidden" && prev.mode !== "hidden";
      if (shown && (next.mode !== prev.mode || (next.mode === "edge" && !samePlace(next.rect, prev.rect)))) put(next);
    }
    // A hover or a leave is timed by a timer of its own, so the sketch's slow loop does not round it. It is booked again
    // even when nothing changed: a tick that came early (the wall clock stepped back) must not leave none waiting.
    clearTimeout(tickTimer);
    const due = nextTick(modes);
    if (due !== null) tickTimer = setTimeout(() => dispatch(tick(Date.now())), Math.max(0, due - Date.now()));
  }

  function hover(x: number, y: number) {
    if (dragging || (modes.mode !== "edge" && modes.mode !== "peek")) return;
    const r = modes.rect;
    const inside = x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
    dispatch(inside ? pointerIn(Date.now()) : pointerOut(Date.now()));
  }

  // On the sketch, a press that moves drags the window away (or along the edge); one that does not is a click, which
  // opens it for good. A click on a peek keeps it open too. (The window accepts the first click while another app is
  // in front: `acceptFirstMouse` in tauri.conf.json.)
  let press: { x: number; y: number } | null = null;
  let dragGiveUp: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("pointerdown", (e) => {
    const docked = modes.mode === "edge" || modes.mode === "peek";
    press = docked && e.button === 0 ? { x: e.screenX, y: e.screenY } : null;
  });
  window.addEventListener("pointermove", (e) => {
    if (!press || !(e.buttons & 1) || Math.hypot(e.screenX - press.x, e.screenY - press.y) < DRAG_PX) return;
    press = null;
    if (modes.mode !== "edge") return; // a peek is moved by its title bar
    dragging = true;
    dispatch(pointerOut(Date.now()));
    clearTimeout(dragGiveUp);
    dragGiveUp = setTimeout(() => (dragging = false), DRAG_GIVE_UP_MS);
    win.startDragging().catch((err: unknown) => {
      dragging = false;
      console.error("could not drag the window", err);
    });
  });
  window.addEventListener("pointerup", () => {
    if (!press) return;
    press = null;
    dispatch(click);
  });

  // Minimised (or covered), the page is hidden: nothing is drawn until it is shown again.
  document.addEventListener("visibilitychange", () => dispatch(visibility(document.visibilityState === "hidden")));
  enter(modes.mode);
  // A window found at another size than its mode's (a sketch-sized window away from an edge, or one with Always 3D on,
  // starts full) is put right at once, so the layout and the window agree.
  if (place) {
    const [w, h] = modes.mode === "edge" ? [EDGE_W, EDGE_H] : [FULL_W, FULL_H];
    if (Math.abs(place.rect.w - w) > 1 || Math.abs(place.rect.h - h) > 1) put(modes);
  }

  setInterval(() => saveCity(city), SAVE_EVERY_MS);
  // A window moved by the person or put in place by `put` counts once it has settled: no move for SETTLE_MS and the mouse
  // button up. A native drag (the title bar, or `startDragging` on the sketch) never shows the page its mouse-up, so the
  // button is asked of the capture side; a hand holding the window still mid-drag keeps it from counting.
  let lastMoveAt = -Infinity;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  /** Each move starts a new wait; a look still out for an older one is dropped. */
  let settleRound = 0;
  const buttonFault = new FaultOnce();
  const buttonDown = () =>
    invoke<boolean>("mouse_button_down").catch((e: unknown) => {
      // without the answer (an older capture build), the window settles as it did before: on the pause alone
      if (buttonFault.fail(e)) console.error("could not ask whether the mouse button is down", e);
      return false;
    });
  function lookSettled(round: number) {
    buttonDown()
      .then(async (down) => {
        if (round !== settleRound) return;
        const now = Date.now();
        if (!settled(lastMoveAt, now, down)) {
          settleTimer = setTimeout(() => lookSettled(round), down ? SETTLE_POLL_MS : Math.max(0, lastMoveAt + SETTLE_MS - now));
          return;
        }
        const p = await placeOf(win);
        if (round !== settleRound) return;
        dragging = false;
        if (p) dispatch(moved(p.rect, p.monitor));
      })
      .catch((e: unknown) => console.error("could not read where the window is", e));
  }
  await win.onMoved(() => {
    lastMoveAt = Date.now();
    const round = ++settleRound;
    clearTimeout(settleTimer);
    clearTimeout(dragGiveUp); // a drag that moves the window ends when the window settles
    settleTimer = setTimeout(() => lookSettled(round), SETTLE_MS);
  });
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

  if (dev) void tour();
  /** Dev only: each mode for a few seconds, driven by the same events as the real thing, then the frames each drew. */
  async function tour() {
    const DWELL_MS = 6000;
    const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
    await wait(DWELL_MS); // full
    dispatch(collapse);
    await wait(DWELL_MS); // edge
    // the pointer leaves the sketch it docked under, and comes back over it
    dispatch(pointerOut(Date.now()));
    dispatch(pointerIn(Date.now()));
    await wait(PEEK_AFTER_MS + DWELL_MS); // the hover opens a peek
    dispatch(pointerOut(Date.now()));
    await wait(UNPEEK_AFTER_MS + 2000); // which closes, back to the edge
    dispatch(click);
    await wait(DWELL_MS); // full, in place
    await win.minimize();
    await wait(DWELL_MS); // hidden
    await win.unminimize();
    await wait(1500);
    tally[modes.mode].ms += performance.now() - tallySince;
    tallySince = performance.now();
    const per = (m: Mode) => `${m} ${((tally[m].frames * 1000) / Math.max(1, tally[m].ms)).toFixed(1)}/s (${(tally[m].ms / 1000).toFixed(1)} s)`;
    const button = await invoke<boolean>("mouse_button_down").then(String, (e: unknown) => `error ${String(e)}`);
    tourSummary = `tour: ${(["full", "edge", "peek", "hidden"] as const).map(per).join(" · ")} · button down: ${button}`;
    openSettings(true);
  }
}

// A model that fails to load (or anything else in boot) would leave a blank window: say why.
boot().catch((e: unknown) => {
  console.error(e);
  hudEl.textContent = `Could not start: ${e instanceof Error ? e.message : String(e)}`;
});
