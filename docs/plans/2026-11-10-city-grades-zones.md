# City Grades, Zones and Rivers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Roads that show their grade (dirt → highway) from how often the roller drove them, Skylines-style zones whose buildings grow denser up to what their road allows, and rivers.

**Architecture:** Grades and zones are city state in `src/sims/` (pure functions plus a little stored state that the snapshot keeps), so a replay of the day files gives the same city in the window, the browser page and node. The renderer (`src/render/`) only reads grade, zone and density per cell and picks Kenney models. Each task that changes stored state bumps `CITY_RULES_VERSION` once.

**Tech Stack:** TypeScript, Vite, Vitest, Three.js 0.186, Tauri 2 (Rust only for the world seed in Task 6), Kenney City Kit models (CC0).

**Spec:** `docs/specs/2026-11-10-city-grades-zones-design.md` (read it with this plan; "Settled after the builder check" overrides the body).

## Global Constraints

- Replay must equal live: only plain arithmetic in anything that decides cells (no `Math.exp`, no wall clock), and every new rule passes the "same city whatever the frame rate" pattern in `test/city.test.ts`.
- Still exactly three `rng.next()` draws per new lot (`pave`): new decisions reuse the lot's stored roll, they never draw.
- A task that changes what the snapshot holds bumps `CITY_RULES_VERSION` (now 7) and extends `isSnapshot`; old snapshots are rejected, never migrated.
- Grades: 1 Dirt (run median 1 pass), 2 Street (2), 3 Lit (3–5), 4 Avenue (6–12), 5 Highway (13+); thresholds live in one exported constant.
- Density cap from the best adjacent grade: grades 1–2 → low, 3 → medium, 4–5 → high; waterfront +1 step (Task 6).
- Rezoning: residential beside grade 4 → commercial if the lot's roll < 0.4; beside grade 5 → commercial if roll < 0.5 else office.
- Parks stay 15% of what would be residential, once parks unlock (today's `PARK_CHANCE`).
- The spec's "a residential lot beside a highway stops growing" is moot: with the settled rezoning every residential lot beside grade 5 becomes commercial or office, so no freeze state is built.
- Commercial jobs target 1 per 8 residents; industry only in the outer 30% of lots by distance from the centroid of homes (or touching industry); no home within 3 cells of industry and vice versa; cluster chance 0.6.
- Models only from the Kenney kits already on disk (`~/Downloads/kenney_city-kit-roads.zip`, `kenney_city-kit-industrial_2.0.zip`); copy the GLBs used into `src/assets/kenney/<kit>/` and add them to `MODEL_NAMES`.
- Window cost: the edge sketch stays ≤ 7% CPU; 3D has no ceiling but is measured (Task 7).
- Restart `pnpm tauri dev` after a long run of edits: the window's web process grows with each hot reload (163 → 693 MB over 13 reloads on 11-10).

## Review Focus

- **Snapshot mid-day equals a full replay** once grades ratchet and lots keep rolls: a restored city must hold the same grades, zones and densities. Test in Task 1 and Task 3.
- **A very long straight road** (a 2,000-cell run) must not make each `pave` slow: recomputing a run is O(run length). Test in Task 1 (paving it stays under 50 ms in node).
- **A city with no homes yet** (first lots, demand all zero) must not divide by zero or make the first lot industrial. Test in Task 3.
- **Paving over a lot** removes its zone, roll and counted demand together, as it does for kinds today. Test in Task 3.
- **More model types mean more draw calls** (one InstancedMesh per model): after Task 4 the 3D window must still draw at 60 fps on the real city. Measured in Task 7.

---

### Task 1: Road grades, ratcheted (sim)

**Files:**
- Create: `src/sims/grades.ts`
- Modify: `src/sims/city.ts` (store grades, update in `pave`), `src/sims/city-snapshot.ts`, `src/config.ts` (rules 8)
- Test: `test/grades.test.ts`, `test/city.test.ts`

**Interfaces:**
- Produces: `type Grade = 1 | 2 | 3 | 4 | 5`; `GRADE_PASSES = [1, 2, 3, 6, 13] as const` (minimum run-median passes for each grade); `gradeOfPasses(passes: number): Grade`; `runThrough(has: (x, y) => boolean, x: number, y: number, axis: "x" | "y"): [number, number][]` (the maximal straight stretch of road through the cell along that axis, junctions included); `runGrade(passes: number[]): Grade` (grade of the median); `CitySim.gradeAt(x: number, y: number): Grade | 0` (0 = no road); snapshot field `grades: [string, Grade][]`.

- [ ] **Step 1: Write failing tests** in `test/grades.test.ts`: `gradeOfPasses` maps 1→1, 2→2, 3→3, 5→3, 6→4, 12→4, 13→5, 37→5; `runThrough` on a plus-shaped road returns the full horizontal line through the centre for "x" and the full vertical one for "y", and `[[x, y]]` for a cell with no neighbour on that axis; `runGrade([1, 1, 9])` is 1 and `runGrade([6, 7, 1])` is 4. In `test/city.test.ts` ("CitySim grades"): driving the same straight road 6 times makes every cell of it `gradeAt` 4; extending that road with fresh cells does not lower the old cells' grade (ratchet); a single cell crossed by a 13-pass road and a 1-pass road reads 5 (a cell takes the highest of its runs); snapshot-then-restore keeps `gradeAt` for every cell; paving one more cell of a 2,000-cell straight road takes under 50 ms.
- [ ] **Step 2: Run** `pnpm exec vitest run test/grades.test.ts test/city.test.ts` — expect the new tests to FAIL (module missing / `gradeAt` not a function).
- [ ] **Step 3: Implement** `src/sims/grades.ts` as above; in `CitySim` keep `private grades = new Map<string, Grade>()`; after `pave` updates the road count, recompute `runGrade` for the x-run and the y-run through the paved cell and raise (never lower) the stored grade of every cell of each run of length ≥ 2; a cell on no run of length ≥ 2 takes `gradeOfPasses` of its own count. `gradeAt` reads the map. Snapshot/restore carry `grades`; `isSnapshot` checks every value is 1–5 and every key is a road cell. Bump `CITY_RULES_VERSION` to 8 and the version test.
- [ ] **Step 4: Run** `pnpm exec tsc --noEmit && pnpm exec vitest run` — all PASS.
- [ ] **Step 5: Measure** the real days in the browser page (the method in the Basic Memory lab note *macOS Trackpad Capture*, "To LOOK at his real city": copy the day files to `prototypes/data/real-cursor-*.jsonl`, import the sim in the page, feed the records): share of road cells per grade. Target roughly 20 / 25 / 35 / 15 / 5%; if Highway is under 3%, lower `GRADE_PASSES[4]` and record the before/after shares in the commit body.
- [ ] **Step 6: Commit** `City: road grades from passes, along straight runs, never falling (rules 8)`.

### Task 2: Grades on screen (render)

**Files:**
- Modify: `src/render/looks.ts` (colours by grade), `src/render/pieces.ts` (`Looks.grade`, `layoutCells`), `src/render/palette-shader.ts` (kerb recolour), `src/render/city3d.ts` (pass `gradeAt`, load new models), `src/render/sketch.ts` (line shade by grade)
- Create: `src/assets/kenney/roads/` copies of `road-crossroad-line`, `road-intersection-line`, `road-straight-barrier`, `road-bend-barrier`, `road-end-barrier`, `road-intersection-barrier`, `road-crossroad-barrier`, `light-square-double`, `light-curved-double`, `traffic-light`, `sign-highway`
- Test: `test/pieces.test.ts`, `test/looks.test.ts`, `test/sketch.test.ts`

**Interfaces:**
- Consumes: `Grade`, `CitySim.gradeAt` (Task 1).
- Produces: `Looks.grade: (x: number, y: number) => Grade | 0` (replaces `Looks.driven` for roads); `roadColour(grade: Grade): number` (1 sand `LANE_COLOUR`, 2–5 asphalt `STREET_COLOUR`); `kerbColour(grade: Grade): number` (grades 1–3: the road's own colour, so no kerb shows; 4–5: the model's kerb, `WHITE`); `Placement.kerb?: number` carried into the instance colour of a second attribute, or a separate road material per kerb state — builder's choice, but `layoutKey` must hash it.

- [ ] **Step 1: Write failing tests** in `test/pieces.test.ts` ("road furniture by grade"): grade 1 and 2 straights have no light; grade 3 has `LIGHT` on every other straight cell (today's rule); grade 4 has `light-square-double` there, a crossroad cell uses `road-crossroad-line`, a T uses `road-intersection-line`, and a `traffic-light` stands at each junction; grade 5 straights use `road-straight-barrier`, carry `light-curved-double` every other cell and a `sign-highway` every 12 cells (x + y ≡ 0 mod 12), and no crosswalk pieces; every new model is in `MODEL_NAMES`. In `test/looks.test.ts`: `roadColour(1)` is `LANE_COLOUR`, `roadColour(3)` is `STREET_COLOUR`, `kerbColour(2)` equals `roadColour(2)`, `kerbColour(4)` is `WHITE`. In `test/sketch.test.ts`: lines are shaded by grade (five shades, darker with grade).
- [ ] **Step 2: Run** `pnpm exec vitest run test/pieces.test.ts test/looks.test.ts test/sketch.test.ts` — FAIL.
- [ ] **Step 3: Copy** the GLBs listed above from `~/Downloads/kenney_city-kit-roads.zip` (`Models/GLB format/`) into `src/assets/kenney/roads/` (unzip into a fresh scratch folder first, copy only these files).
- [ ] **Step 4: Implement** the furniture rules in `layoutCells`; extend `patchAsphalt` so the kerb's palette block (read its texel rectangle off `src/assets/kenney/roads/Textures/colormap.png`, as `ASPHALT_BLOCK` was) takes the kerb colour; wire `gradeAt` through `CityView3D.rebuild` and `sketchItems`.
- [ ] **Step 5: Run** `pnpm exec tsc --noEmit && pnpm exec vitest run` — PASS.
- [ ] **Step 6: Verify** on the real city in the browser page: one zoomed screenshot per grade showing its furniture, saved to `docs/process/2026-11-10/` (next free numbers), and the real window after a clean `tauri dev` restart.
- [ ] **Step 7: Commit** `City: each road grade shows its furniture, kerbs from avenues up`.

### Task 3: Zones, rolls and rezoning (sim)

**Files:**
- Create: `src/sims/zones.ts`
- Modify: `src/sims/kinds.ts` (kept for `neighboursAt`, `UNLOCKS`; `Kind` replaced), `src/sims/city.ts` (`zones`, `rolls`, demand), `src/sims/city-snapshot.ts`, `src/sims/people.ts`, `src/sims/crowd.ts`, `src/sims/testcity.ts`, `src/config.ts` (rules 9)
- Test: `test/zones.test.ts`, `test/city.test.ts`, `test/people.test.ts`, `test/crowd.test.ts`, `test/kinds.test.ts`

**Interfaces:**
- Consumes: `CitySim.gradeAt` (Task 1).
- Produces: `type Zone = "residential" | "commercial" | "office" | "industrial" | "park" | "landmark"`; `bornZone(ctx: ZoneContext, roll: number): Zone` where `ZoneContext = { demand: Demand; corner: boolean; grade: Grade | 0; outer: boolean; inner: boolean; nearHome: boolean; nearIndustry: boolean; touchesIndustry: boolean; clusterZone: Zone | null; parksUnlocked: boolean }`; `zoneNow(born: Zone, roll: number, grade: Grade | 0): Zone` (the rezoning rule in Global Constraints; any other zone is returned unchanged); `CAPACITY: Record<Exclude<Zone, "park">, readonly [number, number, number]>` = residential residents `[2, 6, 20]`, commercial jobs `[4, 8, 16]`, office jobs `[6, 12, 30]`, industrial jobs `[6, 10, 15]`, landmark jobs `[30, 30, 30]`; `CitySim.zoneAt(x, y): Zone | undefined` (= `zoneNow` of the born zone, roll and best adjacent grade); snapshot fields `zones: [string, Zone][]` and `rolls: [string, number][]` (replacing `kinds`).

- [ ] **Step 1: Write failing tests** in `test/zones.test.ts`: with no residents the first lot is residential (Review Focus); with residents 80 and no commercial jobs the roll range for commercial covers ≥ 0.5; `outer: false` never gives industrial; `nearHome: true` never gives industrial and `nearIndustry: true` never gives residential; `clusterZone: "office"` with roll in the cluster band returns office when allowed; grade 5 frontage gives only commercial or office; `zoneNow("residential", 0.3, 4)` is commercial, `zoneNow("residential", 0.5, 4)` is residential, `zoneNow("residential", 0.7, 5)` is office, `zoneNow("industrial", 0.1, 5)` is industrial. In `test/city.test.ts`: paving over a lot clears its zone, roll and demand (Review Focus); snapshot mid-day plus later records equals a full replay with zones (adapt the existing "snapshot plus later records equals full replay"); still three draws per lot (the existing rng-state test). Update `test/people.test.ts` / `test/crowd.test.ts` fixtures from kinds to zones (`residentsOf` counts `CAPACITY.residential[density − 1]`, `jobsOf` counts jobs per zone at the lot's density; errands go to commercial lots and parks).
- [ ] **Step 2: Run** `pnpm exec vitest run` — the new and changed tests FAIL.
- [ ] **Step 3: Implement** `zones.ts`; in `pave` store `rolls.set(key, roll)` and `zones.set(key, bornZone(...))` where `kinds` was set; demand counts each zone at high capacity; centroid of homes kept as running sums (exact, like `spread`); `outer` / `inner` = the lot's distance from that centroid is above the 70th / below the 30th percentile of all lots, kept by a sorted structure or approximated by the running mean + 0.6 × standard deviation (builder's choice, deterministic); `clusterZone` = the zone of the nearest lot along the lot's street within 3 cells. Keep the landmark rule. Replace `Kind` uses in `people.ts`, `crowd.ts`, `testcity.ts`. Bump rules to 9.
- [ ] **Step 4: Run** `pnpm exec tsc --noEmit && pnpm exec vitest run` — PASS.
- [ ] **Step 5: Measure** zone shares on the real days (browser page): report residential / commercial / office / industrial / park shares and confirm commercial jobs ≈ residents / 8 (±30%) in the commit body.
- [ ] **Step 6: Commit** `City: zones grow by demand, place and neighbours, and rezone as their road grows (rules 9)`.

### Task 4: Density and building forms (sim + render)

**Files:**
- Modify: `src/sims/city.ts` (`densityAt`), `src/render/pieces.ts` (`buildingPlacements`), `src/render/city3d.ts`, `src/render/sketch.ts` (`ZONE_COLOURS`)
- Create: `src/assets/kenney/industrial/` copies of `building-a` … `building-h`, `chimney-small`, `chimney-large`, `detail-tank` and the kit's `Textures/colormap.png`
- Test: `test/city.test.ts`, `test/pieces.test.ts`, `test/sketch.test.ts`

**Interfaces:**
- Consumes: `zoneAt`, `CAPACITY` (Task 3), `gradeAt` (Task 1).
- Produces: `CitySim.densityAt(x: number, y: number, t: number): 0 | 1 | 2 | 3` (0 = no building yet; else `min(cap, ageTier)`, `cap` from the best adjacent grade, `ageTier` = today's `houseTier` age rule); `houseTier` is removed and its callers use `densityAt`; `buildingPlacements(zone: Zone, density: 1 | 2 | 3, x, y, turns, built, rowNeighbours: boolean): Placement[]`.

- [ ] **Step 1: Write failing tests** in `test/city.test.ts`: a lot beside a grade-2 road never passes density 1, however old; beside grade 3 it reaches 2 at the first age tier and stays; beside grade 4 it reaches 3 at the second tier; when its road rises from 2 to 4 an old lot jumps to its age tier at once. In `test/pieces.test.ts`: residential 1 = a house from `suburban a–g` plus a garden tree; residential 2 = `suburban h–n`, drawn at `ROW_SCALE` when `rowNeighbours`; residential 3 = `commercial f–j`; commercial 1 = `commercial a–e` at 0.6 scale, 2 = full scale, 3 = `commercial k`; office 1 = `a–e`, 2 = `k`, 3 = `l–n`; industrial 1 = `industrial building-a…c`, 2 = `d…f` + `chimney-small`, 3 = `g…h` + `chimney-large` + `detail-tank`; every model is in `MODEL_NAMES`. In `test/sketch.test.ts`: lots are coloured by zone (six colours).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Copy** the industrial GLBs and their colormap (fresh scratch folder, then only these files) and load them like the other kits (`kitOf` / `COLORMAPS` in `render/colormaps.ts`).
- [ ] **Step 4: Implement** `densityAt` and the forms; `houseTurns` still faces every building to its road.
- [ ] **Step 5: Run** `pnpm exec tsc --noEmit && pnpm exec vitest run` — PASS.
- [ ] **Step 6: Verify** on the real city: screenshots of a downtown (high), a lit-street neighbourhood (medium), a dirt-road edge (low) and an industrial patch, saved to `docs/process/`; real window after a clean restart.
- [ ] **Step 7: Commit** `City: buildings grow as dense as their road allows, by zone`.

### Task 5: Hand-over check with Kia

- [ ] Show Kia the screenshots from Tasks 2 and 4 in the real window (he drags around the city); record his reactions in the PDev Design Log; adjust thresholds he asks for before rivers.

### Task 6: World seed, rivers, bridges, waterfront

**Files and interfaces:** exactly city-life plan Task 7 (`docs/plans/2026-11-03-city-life.md`), with these differences: the rules version becomes 10; `densityAt` adds one step (up to 3) for a lot touching water; `bornZone` never puts industry on a waterfront lot (*my call*, spec silent).

- [ ] Steps: failing tests ("rivers are 2–3 cells wide and recur", "no lot on water", "roller crossing water lays bridge cells", "seed survives restore; rules-9 snapshot rejected", "a waterfront lot beside grade 2 reaches density 2") → implement → screenshots to `docs/process/` → commit `City: rivers run through the world; the roller bridges them (rules 10)`.

### Task 7: Measure and close

- [ ] Real window on the real data folder after a clean restart: 60 s samples of CPU and memory in 3D (moving), the edge sketch, and hidden; 3D frame rate while dragging; record in the commit body and the city-life spec's measurement table.
- [ ] Update the PDev Design Log with each turning point and the `docs/process/` paths.
- [ ] Delete `prototypes/data/real-cursor-*.jsonl` (Kia's copied day files).
- [ ] Commit `City: grades, zones and rivers measured`.
