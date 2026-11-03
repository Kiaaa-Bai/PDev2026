import "./style.css";
import { hourParam, skyTime } from "./clock";
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

async function boot() {
  // The city's own clock while a recording is replayed, so a day recorded in the evening is shown in the evening.
  let replayed: CitySim | null = null;
  const clock = () => skyTime(hour, replayed && replayed.time() > 0 ? replayed.time() : null);
  const view = new CityView3D(new CitySim(CITY), PANEL_W, PANEL_H, clock);
  await view.load();
  const panel = createPanel(host, "City", view.canvas);

  /** A fresh city on the view: live (the mouse drives it) or file (a recording drives it). */
  function makeWorld(mode: World["mode"]): World {
    const city = new CitySim(CITY);
    replayed = mode === "file" ? city : null;
    view.setSim(city);
    const sims = [city];
    return { mode, sims, feeder: new Feeder(() => sims) };
  }

  let world = makeWorld("live");
  // The mouse is finger 0 and, in live mode, drives the city; its records are page pixels.
  const liveFeeder = new Feeder(() => inputSims(world.mode, world.sims));
  attachLive([panel.canvas], (r) => liveFeeder.push(r));

  function loadText(text: string, name: string) {
    const records = parseJsonl(text);
    const strokes = toStrokes(records);
    if (strokes.length === 0) {
      statusEl.textContent = `No touch records in ${name}`;
      return;
    }
    world = makeWorld("file");
    for (const r of records) world.feeder.push(r);
    statusEl.textContent = `${name}: ${strokes.length.toLocaleString()} strokes · Reset to draw`;
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
