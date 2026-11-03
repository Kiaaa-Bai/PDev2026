# Isometric city, steered by the cursor — design

Date: 2026-11-03 · For: Class 09 desk critique (Tue 2026-11-10), then the playtest (Class 10, Tue 2026-11-17)

## Why

Classmates picked the city over the farm and the monster at the pin-up. The
city had two problems. Over a whole day it came out as a thin trail, because
the roller kept driving straight for up to five minutes after the last touch.
That part is fixed: it now slows to a stop over 30 seconds (built and tested
on 2026-11-03). It is also a north–south band, because two-finger scrolling,
most of what the hand does, steered it up and down.

Kia wants the city to look more like a city, give people a reason to check on
it again, let someone read his habits from it, and look better.

## Decided by Kia

- **Input is the cursor only.** The direction the on-screen pointer moves
  steers the roller; pointer movement is what keeps it driving and what counts
  as distance; the heat map shows where the pointer spends its time. The
  trackpad finger capture no longer feeds the window.
- **Classic isometric view** (45°, diamond grid), **clean colour blocks** in
  the Townscaper / Mini Motorways family, from **one asset library** so the
  style stays consistent.
- **Mechanics:** roads upgrade where he drives them again; a roof's colour
  says the hour the house grew; houses take their shape from their
  neighbours; new kinds of building unlock with total distance; the sky
  follows the real time of day.
- **One city that keeps growing across days.** The roller starts each morning
  where it parked.
- **Camera follows the roller close up**, and can be zoomed out to the whole
  city.
- **Window keeps two tabs: City and Heat.** Farm and Monster leave the window;
  their code stays in the repo.
- **When untouched:** the roller slows to a stop over 30 seconds and houses
  keep growing. Nothing decays.
- **Scope:** all of the above. Build in the order below and get as far as
  possible by 11-10; the rest lands before the playtest.
- **The roller still flattens houses in its way**, as it does now. "Nothing
  lost" is about time away; driving through a district may still clear it.
- **When a build changes the rules, the city regrows from scratch** from all
  cursor records under the new rules. During development the city can look
  different overnight; the rules freeze after the playtest.
- **A building's kind is fixed when it appears** (house, corner shop, row
  house…), an honest record of what grew then. Its look may still join up
  with neighbours that arrive later (walls closing into a row).

## Goals, non-goals, anti-goals

Goals: the four above (more like a city, a reason to come back, habits
readable from the map, better looking), in a build Kia can run all day by
11-10 and classmates can install by 11-17.

Non-goals for now: sound, sharing or export, a settings screen, Windows, the
Mac App Store.

Anti-goals, from Kia's own constraints: no streaks, no notifications, no
"you were away" guilt, nothing lost while away, no random drops, no goals or
quests that expire. Honest: a quiet day must look quiet.

## Input

- Capture uses only the cursor source that already exists
  (`capture/src-tauri/src/cursor.rs`): a synthetic finger 0 that is down while
  the pointer moves and lifts after 300 ms at rest. The records keep the
  `{t, id, x, y, state}` shape, so the sims and the feeder do not change.
- *My call:* positions are recorded in global screen points across all
  displays, not as 0–1 of the main display. Otherwise moving the pointer on an
  external monitor clamps to the edge of the laptop screen, registers no
  movement and the roller parks while Kia is working; and docking or undocking
  would change what a given hand movement is worth. Distance and the steering
  threshold are measured in points. The Heat tab shows today only, scaled to
  the area the pointer covered that day.
- *My call:* days are written as `cursor-YYYY-MM-DD.jsonl` in
  `prototypes/data`, so the old trackpad days stay separate and are not mixed
  into the new city.
- Consequence of Kia's choice, stated so it is not a surprise: typing and
  scrolling no longer move the pointer, so those stretches read as quiet. The
  piece now records the pointer's wear, not the fingers'.

## Steering on a diamond grid

The grid keeps four headings. On screen they point ↗ ↘ ↙ ↖. A pointer
movement past a minimum length is compared with those four screen directions:

- The nearest screen direction wins.
- A purely horizontal or vertical movement sits exactly between two
  directions. If the current heading is one of the two (within 15°), keep it.
  Otherwise take the one of the two that is not a U-turn.

So pushing the pointer right while heading ↗ keeps ↗; pushing it down while
heading ↗ turns ↘. The minimum length starts at 3% of the screen width and is
tuned on real use.

## Persistence

- The city is the result of every recorded day, in order.
- *My call:* replaying weeks of records at every launch would get slow (one
  trackpad day was 13 MB), so the window keeps a snapshot of the city state
  plus the time of the last record it includes. At launch it loads the
  snapshot and replays only the records after that time. The snapshot is
  saved every few minutes and when the window closes.
- The seeded random generator is part of the snapshot, so a snapshot plus the
  rest of the records grows the same city as a full replay. A test checks
  that.
- The snapshot carries a rules version. A build with a different version
  ignores the old snapshot and regrows the city from every record.

## Look and rendering

- **Live 3D with Three.js, at 2× pixels.** Kia first asked for 2D so an idle
  toy would not eat the laptop. A measured spike changed that (2026-11-03, the
  Oct 11 city of about 4,900 road tiles and 5,300 houses, in the real Capture
  window, app plus both WebKit processes):

  | state | CPU | peak memory |
  |---|---|---|
  | current 2D window, moving | 22% | 325 MB |
  | 3D 1×, moving | 11% | 332 MB |
  | 3D 2×, moving | 12% | 434 MB |
  | 3D 2×, parked | 14% | 433 MB |
  | heat tab (baseline) | 14% | 316 MB |

  3D cost no more than the baseline. The current 2D window is the expensive
  one because it redraws on every touch and draws the whole city. Kia picked
  3D at 2× (sharper, about 100 MB more than 1×, same CPU).
- Orthographic camera at the 2:1 diamond angle (30° above the ground, 45°
  around). One `InstancedMesh` per model, so the view takes about 20 draw
  calls; only the cells within 30 of the roller are placed; Lambert
  materials; no real-time shadows.
- Draw only when something changed (the roller moved a fraction of a tile,
  the city's version, the camera, the time of day), at most 30 times a second.
  Parked and unchanged means no frames at all.
- The window's frame loop stops redrawing on every touch; that was most of
  the 2D cost.
- Close-up camera centred on the roller. Scroll or pinch inside the window
  zooms out toward the whole city; about five seconds after the last zoom it
  eases back to the roller.
- Window stays 512×348 and always on top.
- The Heat tab stays a flat 2D map, now of where the pointer has been across
  the screens.

### Assets: Kenney City Kit, used as 3D models

Kia's constraints were free, clean colour blocks, one library. Kenney's City
Kit meets them: CC0, GLB, one author, white walls with single-colour roofs.
He declined paying for Flashy City and downloaded the kits himself
(Suburban 2.0, Commercial 2.1, Roads, Industrial 2.0, Car Kit).

- The models the city uses are copied into `form-study/src/assets/kenney/`,
  one folder per kit with its own `Textures/colormap.png`, and committed (CC0
  allows it).
- Every Kenney model colours itself from one small palette texture. Roof
  colour by hour and lit windows at night are done by a small shader change
  that swaps or brightens the roof and window cells of that palette per
  instance.
- Day and night use real light: sun and sky colour follow the local clock,
  window cells glow after dusk, avenue lights get a point of light or a glow
  sprite.
- *My call:* the roller is the Car Kit's `tractor-shovel` for now. Kenney has
  no road roller; a roller built from a box and a drum in Kenney's palette
  can replace it later.

The rules below name building roles (house, corner shop, row house,
apartment, park, landmark, streetlight, roller); each maps to a Kenney model.

## City mechanics

1. **Roads upgrade where driven again** (desire paths). The count of times a
   cell was driven already exists. 1 = a lane, 2 = a paved street,
   3 or more = an avenue with trees and streetlights. Houses beside roads
   driven twice already grow three times faster; that stays.
2. **Lots and houses** work as now: a free cell beside new road becomes a lot
   with a 60% chance, its house appears 3–15 s later and grows to tier 2 at
   5 minutes and tier 3 at 20 minutes. Tier = more storeys.
3. **Roof colour by the hour the house appeared,** in four bands of the local
   clock. *My call:* 06–12 morning, 12–18 afternoon, 18–24 evening, 00–06
   night, with colours taken from the chosen library's palette. A busy morning
   then shows as a district of one colour.
4. **Houses shaped by their neighbours** (Townscaper's idea): a lot touching
   road on two sides becomes a corner shop; a lot with houses on both sides
   along the same road becomes an attached row house; a lot with no
   neighbours becomes a detached house with a garden. The exact set depends
   on what the library has.
5. **Distance unlocks new kinds of building.** Total pointer distance, summed
   across all days, unlocks kinds in a fixed order (for example trees and
   parks, then corner shops, then apartment blocks, then one landmark at the
   densest knot of road). New kinds simply start appearing; there is no toast
   or notification. *My call:* thresholds are set so an ordinary week of work
   unlocks about three kinds, and tuned on Kia's data.
6. **Day and night** follow the wall clock: sky and light colour change
   through dawn, day, dusk and night; at night windows and avenue
   streetlights light up. When a recorded day is replayed in the dev page, the
   recording's own time is used.
7. **Away:** the roller parks; houses keep growing; nothing decays.

## Order of work

1. Cursor-only capture (all displays, `cursor-*.jsonl`); Farm and Monster out
   of the window.
2. Persistence (snapshot plus replay), with the same-city test.
3. (merged into 4)
4. 3D city view in the window, replacing the 2D City tab: ground, roads by
   neighbour mask, houses by tier, the roller, camera follow; diamond-grid
   steering. The throwaway spike (`spike3d.ts`, `spike.html`) is the starting
   point and is removed once this lands.
5. Road tiers and roof colour by hour.
6. Day and night.
7. Neighbour-shaped houses and distance unlocks.
8. Zoom out and back.

## Verification

- Unit tests for the sim: steering on the diamond grid, road tiers, roof
  bands, neighbour rules, unlock thresholds, snapshot equals full replay.
- The browser dev page (`pnpm dev` in `form-study`) shows the same City and
  Heat views driven by mouse drags or a loaded day, for screenshots.
- The Capture window run on Kia's Mac for a few hours before 11-10.

## Left to the builder

Exact colours, the unlock thresholds, the zoom range, the minimum steering
length, and how the 4 neighbour rules map onto the library's pieces.
