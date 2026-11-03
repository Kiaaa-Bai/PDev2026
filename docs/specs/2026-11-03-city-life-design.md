# City life: people, cars, rivers, light and weather — design

Date: 2026-11-03 · Builds on `2026-11-03-iso-city-design.md` (the 3D pointer city, merged as `e61b688`) · For: Class 09 desk critique (Tue 2026-11-10), then the playtest (Tue 2026-11-17)

## Why

After the first demo Kia said the city looks lifeless: "no people or cars on the streets, no flowing river, no light and shadow, no cloud shadows, no weather", and the night could not be seen at all. Everything except the roller stands still.

## Decided by Kia

- **Night preview:** hold a key to fast-forward the sky through a day. Built: hold T, one day in 12 s, release to return to now (`473256a`).
- **People and cars follow game mechanics.** Every building has a fixed capacity; people live in homes and go to work.
- **Commuting follows the real clock only** (morning out, evening home), but the streets are never empty in working hours, "like the real world".
- **Workplaces:** shops, commercial buildings, and a new industrial zone (Kenney City Kit Industrial, already downloaded). They grow **by supply and demand first, then position**: when residents outnumber jobs, new lots lean towards workplaces; shops prefer junctions and avenues, industry prefers the city edge away from houses.
- **Rivers exist in the world from the start.** The roller bridges them; nothing is built on water.
- **Weather and clouds follow the real weather** of a city the player types on first launch.
- **Stay in 3D.** Motion costs redraws whether 2D or 3D; only moving shadows are a 3D-only cost.

## Goals, non-goals, anti-goals

Goals: the city visibly lives — traffic, pedestrians, water, sun and cloud shadows, real weather — at a cost that still suits an always-on window.

Non-goals: traffic jams, accidents, money, needs, happiness, services, sound.

Anti-goals (unchanged): no streaks, notifications or guilt; nothing lost while away; the city still only grows from the pointer.

## World

- **A world seed per install.** *My call:* created on first launch and kept in the app data folder beside the records, so each Mac gets its own rivers. The city remains a pure result of (records, rules version, world seed); the snapshot stores the seed.
- **Rivers:** a pure, seeded `isWater(x, y)`: meandering bands 2–3 cells wide, roughly one every 60–120 cells, crossing the endless map. *My call* on the exact noise.
- When the roller enters water it lays a **bridge** (a road cell flagged as bridge, drawn with the Roads kit's `road-bridge` and `bridge-pillar`); lots are never made on water. Bumps `CITY_RULES_VERSION` (the city regrows once, as agreed).
- **Water surface:** a flat plane per water cell with a scrolling ripple shader in the Kenney palette blue, flowing along the river.

## Light

- **Real-time shadows** from the sun: one directional light with a small shadow map that follows the camera, sun direction from the local time (low in the morning and evening, absent at night). *My call:* PCF soft shadows at 1024², measured; switched off when zoomed far out if too costly.
- **Cloud shadows:** a scrolling noise term in the ground and building shaders darkens patches that drift with the real wind; their amount follows the real cloud cover.

## Weather

- **First launch:** a small overlay in the window asks for a city; it is looked up with the Open-Meteo geocoding API (free, no key) and stored locally as name + latitude/longitude. *My call:* a small "weather: <city>" chip in the tab bar reopens it.
- **Current weather** from the Open-Meteo forecast API every 15 minutes: weather code, cloud cover, precipitation, wind speed and direction, temperature. Offline or failing: clear weather, no error shown.
- **Effects:** rain (falling streaks), snow (drifting flakes, a lighter ground), fog (scene fog), overcast (dimmer sun, greyer sky); clouds drift with the wind direction and speed.
- The T fast-forward previews the sky only; weather stays as now.

## People and cars

- **Capacity** (*my call*, tunable): houses 2 / 4 / 6 residents by tier, rows 3, apartments 20 at tier 3; jobs: shops 4, offices 12, industry 15, landmark 30.
- **Workplace growth:** when a lot is made, compare residents with jobs in the whole city. If residents exceed jobs by more than 20%, the lot becomes a workplace with a raised chance; the workplace kind comes from position — shop at a corner or on an avenue, industry where no house is within 3 cells or at the city's edge, otherwise an office (commercial block). Kinds stay fixed at birth. Shops leave the distance unlocks (they are workplaces now); parks, apartments and the landmark keep their unlocks.
- **Residents and jobs** are paired deterministically (seeded): each resident gets the nearest workplace with a free job by road distance; unemployed residents still go out for errands.
- **Daily schedule on the real clock:** departures spread over 07:00–09:30, returns over 16:30–19:00; during the day a share of people run errands to shops and parks, so streets are never empty; few at night.
- **Movement:** along the road grid (shortest path). Trips up to 8 cells are walked on the pavement edge; longer ones drive on the right-hand lane. A trip's position is a pure function of (path, departure time, speed, now), so nothing has to be simulated frame by frame; only trips near the camera are drawn.
- **Looks:** cars from the Kenney Car Kit (sedan, taxi, van, SUV, hatchback, delivery, truck); people as tiny procedural figures in Kenney palette colours (*my call*: they are a few pixels tall at this zoom).
- **Budget:** at most ~400 cars and ~600 people drawn; path finding spread over frames (≤ 5 ms a frame); paths cached until the road network changes.

## Redraw and cost

The window now animates continuously while anything moves: **at most 15 frames a second** for traffic, water, clouds and weather (the roller keeps up to 30). With no traffic, calm water and clear sky at night it may still stop drawing. After each part is built, CPU, energy and memory are measured in the real window the way the 2D/3D spike was, and reported.

## Order of work

Kia's priority for the 11-10 desk critique: **people and cars first**.

1. Workplaces by demand and position, using shops and commercial blocks (no industry yet); capacities; commuting people and cars. Measure.
2. Light: sun shadows and cloud shadows. Measure.
3. Weather: city input, lookup, current weather, rain/snow/fog/clouds. Measure.
4. Rivers and bridges.
5. The industrial zone.
6. Final cost pass.

## Settled after the builder check

- **Clock:** sky, shadows, commuting and the T preview follow this Mac's clock (as today). The typed city gives the weather and its real sunrise and sunset times, used to shape the day curve. A city in another time zone is accepted as a mismatch. *(my call)*
- **Cost ceiling:** with traffic running, the whole app (capture + both WebKit processes) stays at or under 15% CPU in the real window, measured as in the spike; parked with nothing moving, still no frames. If over, cut in this order: shadow map size, then shadows off when zoomed out, weather particle counts, frame rate 15 → 10, agent counts. *(my call)*
- **Measuring and data safety:** dev and measurement runs use a separate data folder (an environment variable overrides the app data folder) holding a generated test city; they never touch the folder Kia's own window uses. *(my call)*
- **Industry placement:** a new workplace lot becomes industry when it lies in the outer 30% of lots by distance from the centroid of homes, or touches an existing industrial lot (so industry clusters). *(my call)*
- **Bridges:** the roller steers freely over water; any road piece on water is drawn raised on a deck with pillars (`bridge-pillar`), the straight case may use `road-bridge`. Steering is unchanged. *(my call)*
- **Streets never empty:** a proportional share — in working hours roughly a quarter of residents are out on errands at any moment; a tiny new city shows a few people, as a real village would. *(my call)*

## Left to the builder

Noise functions, colours, particle counts, capacities and probabilities, lane offsets, walking/driving speeds, and how far the shadow map reaches — tuned by eye and by the measurements.
