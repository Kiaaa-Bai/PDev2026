import { describe, expect, it } from "vitest";
import {
  canCollapse,
  click,
  collapse,
  dockRect,
  EDGE_H,
  EDGE_W,
  FULL_H,
  FULL_W,
  moved,
  nearEdge,
  nextTick,
  peekRect,
  pointerIn,
  pointerOut,
  start,
  step,
  tick,
  visibility,
  type ModeEvent,
  type ModeState,
  type Rect,
} from "../src/modes";

/** A laptop screen's visible frame in points: the menu bar above, the Dock below. */
const SCREEN: Rect = { x: 0, y: 25, w: 1440, h: 830 };
const OFF = { always3d: false };
const ON = { always3d: true };

const fullAt = (x: number, y: number): Rect => ({ x, y, w: FULL_W, h: FULL_H });
const sketchAt = (x: number, y: number): Rect => ({ x, y, w: EDGE_W, h: EDGE_H });

/** Runs events in order from a state. */
const run = (s: ModeState, evs: ModeEvent[], settings = OFF) => evs.reduce((acc, ev) => step(acc, ev, settings), s);

/** The full window in the middle of the screen. */
const open = () => start(fullAt(400, 200), SCREEN, OFF);
/** Docked at the left edge, its top at y = 300. */
const docked = () => run(open(), [moved(fullAt(10, 300), SCREEN)]);

describe("window modes", () => {
  it("hover 0.5 s peeks; out 2 s returns to edge", () => {
    const edge = docked();
    expect(edge.mode).toBe("edge");
    const hovering = run(edge, [pointerIn(1000), tick(1499)]);
    expect(hovering.mode).toBe("edge");
    expect(nextTick(hovering)).toBe(1500);
    const peek = step(hovering, tick(1500), OFF);
    expect(peek.mode).toBe("peek");
    expect(peek.rect).toEqual(peekRect("left", edge.rect, SCREEN));
    const leaving = run(peek, [pointerOut(2000), tick(3999)]);
    expect(leaving.mode).toBe("peek");
    expect(nextTick(leaving)).toBe(4000);
    const back = step(leaving, tick(4000), OFF);
    expect(back.mode).toBe("edge");
    expect(back.rect).toEqual(edge.rect);
  });

  it("hover under 0.5 s does nothing", () => {
    const s = run(docked(), [pointerIn(1000), tick(1400), pointerOut(1450), tick(1600), tick(9000)]);
    expect(s.mode).toBe("edge");
    expect(nextTick(s)).toBeNull();
    // back over the sketch, the half second starts again
    const again = run(s, [pointerIn(10_000), tick(10_400)]);
    expect(again.mode).toBe("edge");
  });

  it("a pointer back over the peek within 2 s keeps it open", () => {
    const peek = run(docked(), [pointerIn(0), tick(500)]);
    const s = run(peek, [pointerOut(1000), tick(2500), pointerIn(2600), tick(9000)]);
    expect(s.mode).toBe("peek");
  });

  it("click from edge opens full and stays after the pointer leaves", () => {
    const edge = docked();
    const full = step(edge, click, OFF);
    expect(full.mode).toBe("full");
    // in place, as the peek would be: grown inward from the docked edge
    expect(full.rect).toEqual(peekRect("left", edge.rect, SCREEN));
    const later = run(full, [pointerOut(1000), tick(5000), tick(60_000)]);
    expect(later.mode).toBe("full");
    // and a peek clicked stays open too
    const peek = run(edge, [pointerIn(0), tick(500)]);
    const kept = run(peek, [click, pointerOut(1000), tick(60_000)]);
    expect(kept.mode).toBe("full");
    expect(kept.rect).toEqual(peek.rect);
  });

  it("moving within 24 pt of the left or right edge docks; moving a docked window away restores full", () => {
    const left = step(open(), moved(fullAt(24, 300), SCREEN), OFF);
    expect(left.mode).toBe("edge");
    expect(left.rect).toEqual(dockRect("left", 300, SCREEN));
    expect(left.rect).toEqual({ x: 0, y: 300, w: 160, h: 120 });

    const right = step(open(), moved(fullAt(1440 - 512 - 24, 300), SCREEN), OFF);
    expect(right.mode).toBe("edge");
    expect(right.rect).toEqual({ x: 1440 - 160, y: 300, w: 160, h: 120 });

    // 25 pt away is not near
    expect(step(open(), moved(fullAt(25, 300), SCREEN), OFF).mode).toBe("full");
    expect(step(open(), moved(fullAt(1440 - 512 - 25, 300), SCREEN), OFF).mode).toBe("full");

    // dragged along the edge it stays docked, flush to it
    const along = step(left, moved(sketchAt(12, 500), SCREEN), OFF);
    expect(along.mode).toBe("edge");
    expect(along.rect).toEqual({ x: 0, y: 500, w: 160, h: 120 });

    // dragged away, the full window opens where the sketch was dropped
    const away = step(left, moved(sketchAt(600, 400), SCREEN), OFF);
    expect(away.mode).toBe("full");
    expect(away.rect).toEqual(fullAt(600, 400));

    // a peek moved away opens full where it is
    const peek = run(left, [pointerIn(0), tick(500)]);
    const peekAway = step(peek, moved(fullAt(300, 200), SCREEN), OFF);
    expect(peekAway.mode).toBe("full");
    expect(peekAway.rect).toEqual(fullAt(300, 200));
  });

  it("the window being put where the mode wants it is not a move", () => {
    // clicked open, the full window sits flush at the edge; the move that put it there must not dock it again
    const full = step(docked(), click, OFF);
    const settled = step(full, moved({ ...full.rect, h: FULL_H + 28 }, SCREEN), OFF);
    expect(settled.mode).toBe("full");
    // but the person moving it, still near the edge, docks it
    expect(step(settled, moved(fullAt(8, 250), SCREEN), OFF).mode).toBe("edge");
  });

  it("collapse docks to the nearer side", () => {
    const left = step(start(fullAt(100, 200), SCREEN, OFF), collapse, OFF);
    expect(left.mode).toBe("edge");
    expect(left.rect).toEqual({ x: 0, y: 200, w: 160, h: 120 });
    const right = step(start(fullAt(1000, 200), SCREEN, OFF), collapse, OFF);
    expect(right.mode).toBe("edge");
    expect(right.rect).toEqual({ x: 1280, y: 200, w: 160, h: 120 });
  });

  it("Always 3D never enters edge or peek and hides the collapse button", () => {
    expect(canCollapse(ON)).toBe(false);
    expect(canCollapse(OFF)).toBe(true);
    const s = start(fullAt(400, 200), SCREEN, ON);
    expect(step(s, moved(fullAt(0, 200), SCREEN), ON).mode).toBe("full");
    expect(step(s, moved(fullAt(1440 - 512, 200), SCREEN), ON).mode).toBe("full");
    expect(step(s, collapse, ON).mode).toBe("full");
    expect(run(s, [pointerIn(0), tick(10_000)], ON).mode).toBe("full");
    // a sketch on screen when it is turned on opens to full at its next event
    const edge = docked();
    const opened = step(edge, tick(0), ON);
    expect(opened.mode).toBe("full");
    expect(opened.rect).toEqual(peekRect("left", edge.rect, SCREEN));
    const peek = run(edge, [pointerIn(0), tick(500)]);
    expect(step(peek, tick(600), ON).mode).toBe("full");
    // and a window that starts as a sketch starts full
    expect(start(dockRect("left", 300, SCREEN), SCREEN, ON).mode).toBe("full");
  });

  it("hidden from any mode, shown again, returns to that mode", () => {
    const edge = docked();
    const peek = run(edge, [pointerIn(0), tick(500)]);
    for (const s of [open(), edge, peek]) {
      const hidden = step(s, visibility(true), OFF);
      expect(hidden.mode).toBe("hidden");
      // nothing moves it while hidden
      const still = run(hidden, [pointerIn(0), tick(60_000), click, collapse, moved(fullAt(0, 0), SCREEN)]);
      expect(still.mode).toBe("hidden");
      const shown = step(still, visibility(false), OFF);
      expect(shown.mode).toBe(s.mode);
      expect(shown.rect).toEqual(s.rect);
    }
  });

  it("starts as a sketch when the window already is one, at an edge", () => {
    expect(start(dockRect("right", 300, SCREEN), SCREEN, OFF).mode).toBe("edge");
    expect(start(sketchAt(600, 300), SCREEN, OFF).mode).toBe("full");
    expect(start(fullAt(0, 300), SCREEN, OFF).mode).toBe("full");
  });

  it("dock rects on a second monitor with a negative x origin", () => {
    const second: Rect = { x: -1920, y: -200, w: 1920, h: 1050 };
    expect(dockRect("left", 100, second)).toEqual({ x: -1920, y: 100, w: 160, h: 120 });
    expect(dockRect("right", 100, second)).toEqual({ x: -160, y: 100, w: 160, h: 120 });
    // held inside the frame from above and below
    expect(dockRect("left", -500, second).y).toBe(-200);
    expect(dockRect("left", 5000, second).y).toBe(-200 + 1050 - 120);
    expect(nearEdge(sketchAt(-1900, 0), second, 24)).toBe("left");
    expect(nearEdge(sketchAt(-1895, 0), second, 24)).toBeNull();
    expect(nearEdge(sketchAt(-180, 0), second, 24)).toBe("right");
    expect(nearEdge(fullAt(-700, 0), second, 24)).toBeNull();
    // a peek there grows inward from the right edge, keeping the sketch's vertical centre
    expect(peekRect("right", dockRect("right", 300, second), second)).toEqual({ x: -512, y: 300 + 60 - 190, w: 512, h: 380 });
    // collapsing a window on it docks there, not on the main screen
    const s = step(start(fullAt(-1800, 100), second, OFF), collapse, OFF);
    expect(s.rect).toEqual({ x: -1920, y: 100, w: 160, h: 120 });
  });

  it("a peek near the top or bottom is held inside the visible frame", () => {
    expect(peekRect("left", dockRect("left", 25, SCREEN), SCREEN).y).toBe(25);
    expect(peekRect("left", dockRect("left", 9999, SCREEN), SCREEN).y).toBe(25 + 830 - 380);
  });
});
