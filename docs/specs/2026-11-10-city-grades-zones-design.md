# City grades and zones: roads that grow with use, Skylines-style districts, rivers — design

Date: 2026-11-10 · Builds on `2026-11-03-iso-city-design.md` and `2026-11-03-city-life-design.md` · Branch `city-life` (rules 7 as of this writing)

## Why

On 2026-11-10 Kia looked at a few days of his own city and said it "looks like a line, from right to left", that repeated driving "spreads the road into a big pancake, cell by cell", and that it is "not like a city". He wants roads that start one-way and grow ("one-way, then two-way after a few passes, then four lanes, wider and wider"), no new road right beside an existing one, buildings and road grades that follow "how many passes the roller made on that road", Cities: Skylines-style low / medium / high density, residential / commercial / industrial districts "like Skylines, or however other city builders do it", and rivers. The city must stay driven by the mouse alone: he rejected any rule that breaks "the mouse's sense of continuity".

Measured on his real days (2026-11-03 → 11-10, `prototypes/data/real-cursor-*.jsonl`, rules 5): 6,965 road cells over a band 1,394 × 86 tiles of screen; 2,764 solid 2×2 road blocks; 64% of road cells touch 3–4 other road cells.

## Decided by Kia

- **Speed follows the cursor** (built, rules 5): a tile per 100 points of cursor travel, up to 20 tiles/s, stopped 0.3 s after the cursor.
- **No second road beside a road running the same way: merge onto it** (built, rules 6, `mergeBeside`). Real days: 2×2 blocks 2,764 → 0; road cells touching 3–4 others 64% → 22%; houses 4,178 → 5,040.
- **The coast shapes the city** (built, rules 7, `shapeCoast`): when the cursor stops, the roller coasts on, slowing evenly (one stage, Kia: "no need for two stages, just a normal coast"). A coast further out along the city's long screen axis is shortened, one back along it lengthened, by (width / height / 1.5) ^ 1.5, within ×0.25–×4; base coast 2 s. Real days 11-03 → 11-10: width / height on screen (by standard deviation) 18.9 → 1.9, extent 1,244 × 88 → 480 × 277, road cells 5,215 → 13,246, houses 5,040 → 13,276.
- **Rejected:** starting each trip from the city centre (it breaks the cursor's continuity); a two-stage brake.
- **Road grade and building density both come from passes** — how many times the roller drove that road.
- **The road's grade sets a density cap; buildings grow up to it over time** (not at once).
- **Road ladder:** dirt → paved → streetlights → sidewalks → highway, each grade with its own furniture.
- **Beside a highway only commercial and office buildings grow** (Kia's pick; differs from Skylines 1, see the ledger).
- **Residential, commercial and industrial districts**, borrowed from Skylines and other city builders.
- **Rivers**, as already decided on 11-03 (city-life spec, Task 7): seeded, 2–3 cells wide, roughly every 60–120 cells, the roller bridges them, nothing is built on water.

## What other games do (the ledger)

From a distill study on 2026-11-10 (notes and the cross-review in the session scratchpad, `distill-city/`; 6 subjects: Cities: Skylines 1, Skylines 2, SimCity 4, SimCity 2013, Mini Motorways, Parish & Müller 2001). `(n/6)` = how many subjects do it. Only rows that passed the cross-review are used.

| Rule | n/6 | Source detail |
|---|---|---|
| The game, not the player, picks which building appears and when it grows | 6/6 | every subject |
| Buildings only stand on lots whose front touches a road | 4/6 | CS1, SC4, SC2013, P&M |
| Three use families: residential, commercial, industrial (office split out in CS1/CS2) | 5/6 | CS1, CS2, SC4, SC2013, P&M (R/C/mixed) |
| Demand balances the families (an RCI meter) | 3/6 | CS1 (commercial demand is 0 at 1 commercial worker per 8 citizens), SC4, SC2013 |
| Three densities (low / medium / high) | 3/6 | SC4, SC2013, CS2 (CS1 has two) |
| **The road's type caps the density beside it** | 1/6 | SC2013: dirt and low street → low; medium street and medium avenue → medium; high street, high avenue, streetcar avenue → high. The cap enables growth; happiness and room trigger it |
| A building levels up over time while conditions hold | 2/6 | CS2 since 1.1.5 (condition rises at a constant rate while renters can pay); CS1 (land value + education / wealth + services) |
| **Nothing is zoned beside a highway** | 1/6 confirmed (CS1), likely CS2 | highways and ramps take no zoning; Parish & Müller: highways link population peaks, streets fill between |
| Road tiers add width and lanes; the lowest has no sidewalks | 3/6 | CS1: gravel (no sidewalks) → 2-lane (sidewalks) → 4-lane (median) → 6-lane → highway (no sidewalks, barrier variant); CS2: small / medium / large / highway, highway lighting; SC2013: stop signs below high street, traffic lights from high street and avenues |
| Same-use buildings cluster | 2/6 | Mini Motorways (houses serve their own colour, weighted spawn areas), P&M (zone maps); CS by painting |
| Industry keeps away from housing | 6/6 qualitative, **0/6 give a distance** | the buffer width is ours to pick |
| Nothing is built on water; roads bridge it | 5/6 | every subject with water |
| Waterfront raises desirability | 2/6 | CS1 (shoreline land value slightly up), SC4 (marina) |

## The design

### 1. Road grades (render only, no rules change)

A road's **grade** comes from passes. Per cell it would flicker along a road, so a straight **run** (cells between two junctions or ends) takes the median passes of its cells, and every cell of the run shows that grade. A junction cell takes the highest grade of the runs meeting it.

| Grade | Passes (run median) | Looks (Kenney roads kit) | Share on real days, rules 6 |
|---|---|---|---|
| 1 Dirt | 1 | sandy, no streetlights (today's lane look) | 17% |
| 2 Street | 2 | asphalt | 26% |
| 3 Lit street | 3–5 | asphalt + a streetlight every other straight cell (today's tier 3) | 40% |
| 4 Avenue | 6–12 | + sidewalks (kerbs shown from here up), crosswalks at junctions (`road-crossroad-line`, `road-intersection-line`), traffic lights at junctions, double streetlights (`light-square-double`) | 16% |
| 5 Highway | 13+ | barrier pieces (`road-*-barrier`), curved double lights, a highway sign every ~12 cells, no crosswalks | 1% |

The thresholds are the builder's to tune; the target is a visible ladder (roughly 20 / 25 / 35 / 15 / 5%). Highway at 1% is too few to read as a road, so the builder may lower its threshold or ask for a minimum run length. Grades only ever rise: each cell keeps the highest grade it has shown (see *Settled after the builder check*).

### 2. Zones (born when a lot is made; they rezone as the road grows, see *Settled after the builder check*)

A lot gets a **zone** once, when it is made: residential, commercial, office, industrial, park, or the landmark. Its building form is not fixed any more; it follows density (below). This replaces today's kinds (`house`, `row`, `detached`, `apartment` become residential forms; `shop` becomes commercial; `office` stays).

Which zone (in this order):
1. **Highway frontage:** a lot touching a grade-5 road can only be commercial or office.
2. **Demand (RCI):** targets counted at full capacity, as today. Commercial jobs target **1 per 8 residents** (CS1's zero-demand point); offices and industry share the remaining jobs; total jobs target ≈ residents. The family furthest below its target leads; the lot's existing random roll picks within that weighting, so the three draws per lot stay as they are.
3. **Position:** industry only in the outer 30% of lots by distance from the centroid of homes, or touching existing industry (the 11-03 decision); offices lean to the inner 30%; commercial leans to corners and to roads of grade ≥ 3.
4. **Clustering:** with chance 0.6 a new lot copies the zone of the nearest lot on the same run, if that zone is allowed there, so districts come out in blocks, not salt and pepper.
5. **Buffer (our number, no game gives one):** no industrial lot within 3 cells of a home, and no home within 3 cells of industry; the roll falls to commercial, office or park instead.
6. Parks: as today, 15% of what is left residential once parks unlock.

### 3. Density (grows over time, capped by the road)

Every lot has a density, **low, medium or high**:

- **Cap from the road:** the highest grade of the roads its lot touches: grades 1–2 → low, grade 3 → medium, grades 4–5 → high. A waterfront lot (touching water) gets one step more, up to high.
- **Growth over time:** the existing age tiers (5 and 20 minutes after the house appears; three times faster beside a busy road), up to the cap. A road that is upgraded later lets the building grow on from its age.
- **Form by zone and density:**
  - residential: low = detached houses (suburban a–g, one garden tree); medium = bigger suburban and row houses (h–n, rows where lots touch along the street); high = apartment blocks (commercial f–j).
  - commercial: low = small shops (commercial a–e drawn small); medium = full-size shops; high = commercial blocks.
  - office: low = low offices (a–e); medium = slab (k); high = towers (l–n).
  - industrial: Kenney City Kit Industrial (already downloaded, `~/Downloads/kenney_city-kit-industrial_2.0.zip`): low = small sheds, medium = factories, high = big plants with chimneys. Same palette shader as the other kits.
- **Beside a highway:** an existing residential lot stays, but does not grow past the density it had when its road became a highway.
- **People and cars:** capacities scale with density (the builder sets them in the spirit of the 11-03 numbers; industry jobs ≈ 15 at high).

### 4. Rivers

Exactly as Task 7 of the city-life plan: a world seed per install, seeded `isWater(x, y)` bands, bridges where the roller crosses, no lots on water, the ripple shader. Waterfront lots get the +1 density step above.

### 5. Rules versions and the city

Grades are render-only: no rules bump. Zones and density change what a lot holds: rules 7. Rivers change where roads and lots can be: rules 8 (or both in one bump if built together). Each bump regrows the city from the day files; copy the old snapshot aside first.

## Goals, non-goals, anti-goals

Goals: from a few days of real use the city reads as a city — a ladder of road grades you can see, districts of one use, density that rises toward the busiest roads, rivers.

Non-goals: land value, services, pollution simulation, economy, traffic capacity. Grades are looks and caps, not traffic models.

Anti-goals: anything that makes the roller go where the cursor did not (Kia's rejection of trip starts); roads whose grade flickers cell by cell; salt-and-pepper zones; the window losing frames in 3D or the edge sketch costing more than today.

## Settled after the builder check (2026-11-10)

- **A run is a straight line through junctions** (the longest straight stretch of road along x or y), not "between two junctions": on the real city the literal version gives runs of median length 1 and barely smooths (35% of neighbouring cells still differ). *(my call)*
- **Grades ratchet.** Each road cell stores the highest grade it has ever shown; medians can fall when a run is extended or split, the stored grade cannot. This makes the grade stored state, saved in the snapshot. *(my call)*
- **Sidewalks at grade 4, as Kia laid out the ladder.** The Kenney road pieces carry a kerb at every grade today; below grade 4 the kerb is recoloured to the road's own colour (dirt: sand, street: asphalt), so sidewalks appear at grade 4 together with crosswalks and traffic lights. *(my call, following Kia's ladder; the earlier table had dropped it)*
- **Lots rezone when their road grows.** Lots are made beside roads driven once or twice (7,153 and 1,261 lots in the replay; only 288 beside roads driven 3+), so a zone fixed at birth would leave highways lined with whatever was zoned on dirt and Kia's "only commercial and office beside highways" would never show. The zone is therefore a pure function of the zone the lot was born with, its own stored roll and the grade of its road: a residential lot whose road reaches grade 4 becomes commercial if its roll is under 0.4; at grade 5 every residential lot becomes commercial or office. No extra random draw, no new state beyond the ratcheted grade. *(my recommendation; Kia did not answer the question, so it stands until he says otherwise)*
- **Order of work:** the shaped coast (done, rules 7) → road grades → zones and density → rivers, before the city-life plan's shadows (Task 5) and weather (Task 6); rivers and industry here take over city-life Tasks 7 and 8. *(my recommendation, unanswered)*
- **Commit first:** the uncommitted rules 5–7 work (cursor speed, merge, shaped coast, drag-to-pan) is committed on its own before any task of this design touches the same files.

## Left to the builder

Grade thresholds and the highway's minimum run, how often lights and signs repeat, capacities per density, exact model picks within each pool, colours, and the cluster chance.
