// THROWAWAY: browser harness for the 3D performance spike.
import { CITY } from "./config";
import { parseJsonl } from "./data";
import { Feeder } from "./drive";
import { CitySim } from "./sims/city";
import { autopilotSwipe } from "./spike-auto";
import { ThreeCityView } from "./spike3d";

const params = new URLSearchParams(location.search);
const day = params.get("day") ?? "touches-2026-10-11.jsonl";
const city = new CitySim(CITY);
const feeder = new Feeder(() => [city]);
for (const r of parseJsonl(await fetch("/" + day).then((r) => r.text()))) feeder.push(r);

const view = new ThreeCityView(city, 512, 320);
await view.load();
view.setPixelRatio(Number(params.get("pr") ?? 1));
document.getElementById("host")!.append(view.canvas);
const stats = document.getElementById("stats")!;
setInterval(() => autopilotSwipe((r) => feeder.push(r)), 3000);
let frames = 0;
let last = performance.now();
function frame() {
  city.advanceTo(Date.now());
  if (view.update(performance.now())) frames++;
  const now = performance.now();
  if (now - last > 1000) {
    const info = view.renderer.info.render;
    stats.textContent = `${frames} fps drawn · ${info.calls} draw calls · ${info.triangles.toLocaleString()} triangles · ${city.road.size} road · ${city.houses(city.time())} houses${city.parked() ? " · parked" : ""}`;
    frames = 0;
    last = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
