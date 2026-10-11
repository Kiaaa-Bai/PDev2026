import "./style.css";
import type { Container } from "pixi.js";
import { CITY, FARM, MONSTER, MONSTER_LIVE_SPAWN_MS } from "./config";
import { parseJsonl, toStrokes } from "./data";
import { attachLive, Feeder, inputSims } from "./drive";
import type { Finger } from "./pointers";
import { CityView } from "./render/city";
import { FarmView } from "./render/farm";
import { MonsterView } from "./render/monster";
import { createPanel, type Panel } from "./render/panel";
import { CitySim } from "./sims/city";
import { FarmSim } from "./sims/farm";
import { MonsterSim } from "./sims/monster";
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
  monster: MonsterSim;
  feeder: Feeder;
}

const statusEl = document.querySelector<HTMLElement>("#status")!;
const host = document.querySelector<HTMLElement>("#panels")!;
/** The mouse while it is pressed, drawn as each form's tool. */
const fingers = new Map<number, Finger>();

function makeWorld(mode: World["mode"], panels: Panel[]): World {
  const city = new CitySim(CITY);
  const farm = new FarmSim(FARM);
  const monster = new MonsterSim(mode === "live" ? { ...MONSTER, spawnIntervalMs: MONSTER_LIVE_SPAWN_MS } : MONSTER);
  const views: View[] = [new CityView(city), new FarmView(farm, fingers), new MonsterView(monster, fingers)];
  views.forEach((v, i) => panels[i].app.stage.addChild(v.root));
  const sims = [city, farm, monster];
  return { mode, sims, views, monster, feeder: new Feeder(() => sims) };
}

async function boot() {
  await loadTiles();
  const panels: Panel[] = [];
  for (const title of ["City", "Farm", "Monster"]) panels.push(await createPanel(host, title));

  let world = makeWorld("live", panels);
  // The mouse is finger 0: it shows as each form's tool and, in live mode, drives the forms.
  const liveFeeder = new Feeder(() => inputSims(world.mode, world.sims));
  attachLive(
    panels.map((p) => p.canvas),
    (r) => {
      if (r.state === "up") fingers.delete(r.id);
      else fingers.set(r.id, { x: r.x, y: r.y });
      liveFeeder.push(r);
    },
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
    world.monster.poofs.length = 0;
    statusEl.textContent = `${name}: ${strokes.length.toLocaleString()} strokes · Reset to draw`;
  }

  document.querySelector("#reset")!.addEventListener("click", () => {
    swap(makeWorld("live", panels));
    statusEl.textContent = "Live: drag on any panel";
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
