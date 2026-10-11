# Trackpad prototypes — design

Date: 2026-10-10 · For: PDev Class 5 assignment, due Class 6 (Tue 2026-10-13)

## Goal

The assignment asks for 2 new prototypes, at least 1 of them functional. Kia
missed the in-class prototype on 10-06, so these two cover it.

1. **Capture** (works-like, the functional one): prove that a background app on
   macOS 27 can read every finger on the trackpad, and record a real day of it.
2. **Form study** (looks-like): draw the same touch data as three candidate
   forms side by side, so the forms can be compared on real input.

Done means: Capture runs in a small window, shows live finger dots, and writes a
`.jsonl` file that grows while Kia works in other apps; Form study opens in a
browser, accepts that file or live mouse input, and shows city, farm and
monster panels in pixel art.

## Constraints carried from the pitch (locked after Class 4)

Topic `Wear as a record` · Attribute `Involuntary` · Device `Metaphor` · Mood
`Quiet`. Every form must grow from input Kia produced while doing something
else. Nothing asks for attention, nothing has a button that rewards grinding.

## Decisions

- **Stack**: Tauri v2 (Rust backend, web frontend) for Capture; Vite +
  TypeScript + PixiJS v8 for Form study. Chosen on fit, not familiarity:
  web iterates fastest on visuals, Tauri is light enough to stay open all day,
  and Rust can call the private framework directly, so no Swift.
- **Art**: pixel style, Kenney CC0 packs (exact packs picked during
  implementation; downloading them needs Kia's OK). Textures scale with
  nearest-neighbour so pixels stay sharp.
- **Forms**: city, farm, monster. Farm harvests automatically. Monster is the
  passive version: monsters appear on their own and ordinary work swipes defeat
  them; there is no aiming.
- **Dropped**: Day replay (a sped-up playback of a day) — not built this round.

## Repo layout

```
prototypes/
  capture/        Tauri app
  form-study/     Vite + PixiJS page
  data/           recorded .jsonl files (gitignored except sample.jsonl)
docs/specs/       this file
```

## Data format (shared by both prototypes)

One JSON object per line:

```json
{"t": 1760112000123, "id": 3, "x": 0.412, "y": 0.287, "state": "move"}
```

- `t`: milliseconds since Unix epoch.
- `id`: finger id from the framework; unique only while that finger is down.
- `x`, `y`: position on the pad, 0–1, origin at the **top-left** (the framework
  reports bottom-left, so Capture writes `y = 1 - y`).
- `state`: `down` | `move` | `up`. Hover and other framework states are
  dropped.

A **stroke** is the run of records for one `id` from `down` to `up`. All three
forms consume strokes.

## Prototype 1 — Capture

**Input.** Rust links `/System/Library/PrivateFrameworks/MultitouchSupport.framework`
through FFI and calls `MTDeviceCreateDefault`, `MTRegisterContactFrameCallback`
and `MTDeviceStart`. The callback receives every contact on every frame.

**Sampling.** `down` and `up` are always written. `move` is written at most 30
times per second per finger.

**Storage.** Records are appended to `prototypes/data/touches-YYYY-MM-DD.jsonl`
(local date; path resolved from the source tree, which is fine for a
prototype). Rough size: 30 records/s × ~2 h of contact a day × ~1.5 fingers ×
~70 bytes ≈ 23 MB/day. The 2 h is an assumption.

**Window.** Small (about 320×200, roughly the pad's aspect ratio), always on top
by default. It draws live finger dots and today's cumulative heat map on a 2D
canvas, plus a running record count. It is a proof that data arrives, not a
look.

**Permissions.** The private framework is expected to need none. The app is not
sandboxed.

**Fallback.** If the framework fails on macOS 27 (no device, no callbacks), switch
the input to global cursor position plus scroll events (public API, needs Input
Monitoring). The file format stays the same, so Form study is unaffected.

## Prototype 2 — Form study

**Page.** One browser page, three panels side by side (city · farm · monster),
each with the pad's aspect ratio.

**Data sources.**
- Drop a `.jsonl` file: all strokes are processed in time order and each panel
  shows its end-of-day state.
- No file: mouse drags anywhere on the page become live strokes and feed all
  three panels at once, so the forms grow in real time.
- `prototypes/data/sample.jsonl` (a short real recording) loads from a button.
  The repo is public, so the sample is committed only after Kia OKs it.

**Shared rule.** Each panel lays a grid over the pad. A stroke "crosses" every
cell its line segments pass through.

**City.**
- Fine grid (about 40×25 cells of 16 px tiles).
- Each crossing adds 1 traffic to the cell. A cell becomes road once its
  traffic passes a threshold; the road tile is picked from its road neighbours
  (straight, corner, T, cross).
- Empty cells next to roads get buildings. The chance and the building size
  grow with the traffic of the adjacent road.
- Randomness uses a fixed seed, so the same file always builds the same city.

**Farm.**
- Coarse grid of plots (about 12×8).
- A stroke waters each plot it crosses once.
- Every N waterings the crop grows one stage. There are 4 stages; at the last
  one the plot harvests itself, the harvest count goes up, and the plot
  replants.

**Monster.**
- Same coarse grid as the farm.
- Monsters spawn one at a time in random empty cells on a timer: data time when
  replaying a file, wall-clock time in live mode. There is a cap on how many
  can be alive at once.
- A stroke crossing a monster's cell defeats it; a loot counter goes up.
- Corners Kia never touches fill up with monsters, which is the point.

**Tuning.** Thresholds (road traffic, N waterings, spawn interval, cap) live in
one config object per panel so they can be tuned against real data.

## Verification

- Capture: run it, swipe and scroll in other apps, screenshot the window
  showing dots, and confirm the `.jsonl` keeps growing with sane values (x, y
  within 0–1, matched down/up).
- Form study: open in the browser pane, load the sample, screenshot all three
  panels; then draw with the mouse and screenshot again.

## Risks

- MultitouchSupport is private and unverified on macOS 27. The first
  implementation step is a short spike that only prints contacts; if it fails,
  use the fallback above.
- Rust is not installed yet; installing it needs Kia's OK.
- The app is unsigned, so other Macs must allow it in System Settings. This
  doesn't affect Kia's own machine.

## Out of scope

Blog post, updated timeline, Windows port, final art, keeping state across days,
signing and notarisation, Day replay.
