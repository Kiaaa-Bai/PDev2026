import "./style.css";
import { hourParam, runningClock, skyTime } from "./clock";
import { CITY } from "./config";
import { parseJsonl, toStrokes } from "./data";
import { attachLive, Feeder, inputSims } from "./drive";
import { CityView3D } from "./render/city3d";
import { createPanel, PANEL_H, PANEL_W } from "./render/panel";
import { CitySim } from "./sims/city";
import type { Sim } from "./sims/types";

interface World {
  mode: "live" | "file";
  sims: Sim[];
  feeder: Feeder;
}

const statusEl = document.querySelector<HTMLElement>("#status")!;
const host = document.querySelector<HTMLElement>("#panels")!;

/** Dev only: `?hour=22` (or `?hour=19.5`) shows the city at that time of day, whatever else the clock says. */
const hour = hourParam(location.search);

/** Dev only: `?distance=3000000` starts every city with that much pointer distance, so the kinds it unlocks show at once. */
const startDistance = Math.max(0, parseFloat(new URLSearchParams(location.search).get("distance") ?? "")) || 0;

/**
 * Dev only: `?city=test` replays the generated test city's day files (prototypes/data/test-city, git ignores it; from
 * inside prototypes/form-study, `pnpm make-test-city ../data/test-city 3 2026-10-31` writes it) instead of starting
 * empty, then lets it grow up. The days are read from the first date on, `?from=2026-10-31` unless another is given, for as
 * many days in a row as there are files. Combine with `?hour=8.25` to see the morning rush: the people and cars follow
 * that hour, running on from it.
 */
const params = new URLSearchParams(location.search);
const testCity = params.get("city") === "test";
const testFrom = /^\d{4}-\d{2}-\d{2}$/.test(params.get("from") ?? "") ? params.get("from")! : "2026-10-31";
const TEST_DAYS_MAX = 14;
/** After the last record the generated city is left alone this long, so every house has grown. */
const GROW_MS = 24 * 3_600_000;

async function boot() {
  // The city's own clock while a recording is replayed, so a day recorded in the evening is shown in the evening.
  let replayed: CitySim | null = null;
  const clock = () => skyTime(hour, replayed && replayed.time() > 0 ? replayed.time() : null);
  const view = new CityView3D(new CitySim(CITY), PANEL_W, PANEL_H, clock, runningClock(hour));
  await view.load();
  view.attachZoom();
  (window as unknown as { cityView: CityView3D }).cityView = view; // for a look from the console
  const panel = createPanel(host, "City", view.canvas);

  /** A fresh city on the view: live (the mouse drives it) or file (a recording drives it). */
  function makeWorld(mode: World["mode"]): World {
    const city = new CitySim(CITY);
    city.distance = startDistance;
    replayed = mode === "file" ? city : null;
    view.setSim(city);
    const sims = [city];
    return { mode, sims, feeder: new Feeder(() => sims) };
  }

  let world = makeWorld("live");
  if (testCity) await loadTestCity();
  // The mouse is finger 0 and, in live mode, drives the city; its records are page pixels.
  const liveFeeder = new Feeder(() => inputSims(world.mode, world.sims));
  attachLive([panel.canvas], (r) => liveFeeder.push(r));

  function loadText(text: string, name: string, grow = 0) {
    const records = parseJsonl(text);
    const strokes = toStrokes(records);
    if (strokes.length === 0) {
      statusEl.textContent = `No touch records in ${name}`;
      return;
    }
    world = makeWorld("file");
    for (const r of records) world.feeder.push(r);
    if (grow > 0) for (const sim of world.sims) sim.advanceTo(records[records.length - 1].t + grow);
    statusEl.textContent = `${name}: ${strokes.length.toLocaleString()} strokes · Reset to draw`;
  }

  async function loadTestCity() {
    const days: string[] = [];
    const [y, m, d] = testFrom.split("-").map(Number);
    for (let k = 0; k < TEST_DAYS_MAX; k++) {
      const day = new Date(y, m - 1, d + k);
      const name = `cursor-${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}.jsonl`;
      const res = await fetch(`/test-city/${name}`);
      const text = res.ok ? await res.text() : "";
      if (parseJsonl(text).length === 0) break; // no such day (the dev server may answer a missing file with its page)
      days.push(text);
    }
    if (days.length === 0) {
      statusEl.textContent = `No test city from ${testFrom}: run  pnpm make-test-city ../data/test-city 3 ${testFrom}  in prototypes/form-study`;
      return;
    }
    loadText(days.join("\n"), `test city (${days.length} days)`, GROW_MS);
  }

  document.querySelector("#reset")!.addEventListener("click", () => {
    world = makeWorld("live");
    statusEl.textContent = "Live: drag on the panel";
  });

  document.querySelector("#sample")!.addEventListener("click", async () => {
    const res = await fetch("/sample.jsonl");
    loadText(res.ok ? await res.text() : "", "sample.jsonl");
  });

  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (file) loadText(await file.text(), file.name);
  });

  function frame() {
    const now = Date.now();
    if (world.mode === "live") for (const sim of world.sims) sim.advanceTo(now);
    view.update(performance.now());
    panel.stat.textContent = view.stat();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot().catch((e: unknown) => {
  console.error(e);
  statusEl.textContent = `Could not start: ${e instanceof Error ? e.message : String(e)}`;
});
