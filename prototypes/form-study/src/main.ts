import "./style.css";
import type { Container } from "pixi.js";
import { CITY, FARM, MONSTER, MONSTER_LIVE_SPAWN_MS } from "./config";
import { parseJsonl, toStrokes } from "./data";
import { attachLive, inputSims, replay } from "./drive";
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
}

const statusEl = document.querySelector<HTMLElement>("#status")!;
const host = document.querySelector<HTMLElement>("#panels")!;

function makeWorld(mode: World["mode"], panels: Panel[]): World {
  const city = new CitySim(CITY);
  const farm = new FarmSim(FARM);
  const monster = new MonsterSim(mode === "live" ? { ...MONSTER, spawnIntervalMs: MONSTER_LIVE_SPAWN_MS } : MONSTER);
  const views: View[] = [new CityView(city), new FarmView(farm), new MonsterView(monster)];
  views.forEach((v, i) => panels[i].app.stage.addChild(v.root));
  return { mode, sims: [city, farm, monster], views, monster };
}

async function boot() {
  await loadTiles();
  const panels: Panel[] = [];
  for (const title of ["City", "Farm", "Monster"]) panels.push(await createPanel(host, title));

  let world = makeWorld("live", panels);
  attachLive(
    panels.map((p) => p.canvas),
    () => inputSims(world.mode, world.sims),
  );

  function swap(next: World) {
    world.views.forEach((v) => v.destroy());
    world = next;
  }

  function loadText(text: string, name: string) {
    const strokes = toStrokes(parseJsonl(text));
    if (strokes.length === 0) {
      statusEl.textContent = `No touch records in ${name}`;
      return;
    }
    swap(makeWorld("file", panels));
    replay(strokes, world.sims);
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
