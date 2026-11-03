import "./style.css";
import type { Container } from "pixi.js";
import { CITY } from "./config";
import { parseJsonl, toStrokes } from "./data";
import { attachLive, Feeder, inputSims } from "./drive";
import { CityView } from "./render/city";
import { createPanel, type Panel } from "./render/panel";
import { CitySim } from "./sims/city";
import type { Sim } from "./sims/types";
import { loadTiles } from "./tiles";

interface View {
  root: Container;
  update(now: number): void;
  stat(): string;
  destroy(): void;
}

interface World {
  mode: "live" | "file";
  sims: Sim[];
  views: View[];
  feeder: Feeder;
}

const statusEl = document.querySelector<HTMLElement>("#status")!;
const host = document.querySelector<HTMLElement>("#panels")!;

function makeWorld(mode: World["mode"], panels: Panel[]): World {
  const city = new CitySim(CITY);
  const views: View[] = [new CityView(city)];
  views.forEach((v, i) => panels[i].app.stage.addChild(v.root));
  const sims = [city];
  return { mode, sims, views, feeder: new Feeder(() => sims) };
}

async function boot() {
  await loadTiles();
  const panels: Panel[] = [];
  panels.push(await createPanel(host, "City"));

  let world = makeWorld("live", panels);
  // The mouse is finger 0 and, in live mode, drives the city; its records are page pixels.
  const liveFeeder = new Feeder(() => inputSims(world.mode, world.sims));
  attachLive(
    panels.map((p) => p.canvas),
    (r) => liveFeeder.push(r),
  );

  function swap(next: World) {
    world.views.forEach((v) => v.destroy());
    world = next;
  }

  function loadText(text: string, name: string) {
    const records = parseJsonl(text);
    const strokes = toStrokes(records);
    if (strokes.length === 0) {
      statusEl.textContent = `No touch records in ${name}`;
      return;
    }
    swap(makeWorld("file", panels));
    for (const r of records) world.feeder.push(r);
    statusEl.textContent = `${name}: ${strokes.length.toLocaleString()} strokes · Reset to draw`;
  }

  document.querySelector("#reset")!.addEventListener("click", () => {
    swap(makeWorld("live", panels));
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
    world.views.forEach((v, i) => {
      v.update(performance.now());
      panels[i].stat.textContent = v.stat();
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot();
