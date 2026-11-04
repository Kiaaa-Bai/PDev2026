// The window's modes: the full 3D window, a sketch docked at the left or right edge of the screen, a peek (the docked
// window opened by hovering over it), and hidden. Pure, so it can be tested in node: window.ts listens to the window
// and the pointer, sends the events here, and puts the window where the state says.

/** A rectangle in screen points, top-left and size; y grows down, as in the pointer's records. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Mode = "full" | "edge" | "peek" | "hidden";
export type Side = "left" | "right";
export interface ModeSettings {
  /** The window never docks or turns into the sketch. */
  always3d: boolean;
}

/** The docked sketch. */
export const EDGE_W = 160;
export const EDGE_H = 120;
/** The full window and the peek (the window's content, under its title bar). */
export const FULL_W = 512;
export const FULL_H = 380;
/** A window moved this close to the left or right edge docks. */
export const SNAP_PT = 24;
/** The pointer resting over the sketch this long opens a peek... */
export const PEEK_AFTER_MS = 500;
/** ... and away from the peek this long closes it. */
export const UNPEEK_AFTER_MS = 2000;

export interface ModeState {
  mode: Mode;
  /** Where the window is, or is to be put; window.ts moves the window when the mode or this place changes. */
  rect: Rect;
  /** The visible frame of the monitor the window is on: without the menu bar and the Dock. */
  monitor: Rect;
  /** Docked (edge and peek): the side, and the sketch's place there, which a peek grows from and shrinks back to. */
  side: Side | null;
  dock: Rect | null;
  /** Whether the pointer is over the window, and since when it came in (edge) or went out (peek). */
  over: boolean;
  since: number | null;
  /** While hidden, the mode it comes back to. */
  back: Exclude<Mode, "hidden"> | null;
}

export type ModeEvent =
  | { type: "moved"; rect: Rect; monitor: Rect }
  | { type: "collapse" }
  | { type: "pointerIn"; t: number }
  | { type: "pointerOut"; t: number }
  | { type: "click" }
  | { type: "tick"; t: number }
  | { type: "visibility"; hidden: boolean };

/** The window came to rest at `rect` on `monitor` (moved by the person, or put there by window.ts). */
export const moved = (rect: Rect, monitor: Rect): ModeEvent => ({ type: "moved", rect, monitor });
/** The collapse button in the tab bar. */
export const collapse: ModeEvent = { type: "collapse" };
export const pointerIn = (t: number): ModeEvent => ({ type: "pointerIn", t });
export const pointerOut = (t: number): ModeEvent => ({ type: "pointerOut", t });
/** A press and release on the window without moving it. */
export const click: ModeEvent = { type: "click" };
export const tick = (t: number): ModeEvent => ({ type: "tick", t });
export const visibility = (hidden: boolean): ModeEvent => ({ type: "visibility", hidden });

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The sketch's place: 160 × 120 flush to `side` of the monitor's visible frame, its top at `y` but held inside the frame. */
export function dockRect(side: Side, y: number, monitor: Rect): Rect {
  const x = side === "left" ? monitor.x : monitor.x + monitor.w - EDGE_W;
  return { x, y: clamp(y, monitor.y, monitor.y + monitor.h - EDGE_H), w: EDGE_W, h: EDGE_H };
}

/** The edge `rect` is within `snap` points of (or past), the nearer one if both; null when neither. */
export function nearEdge(rect: Rect, monitor: Rect, snap: number = SNAP_PT): Side | null {
  const left = rect.x - monitor.x;
  const right = monitor.x + monitor.w - (rect.x + rect.w);
  if (left > snap && right > snap) return null;
  return left <= right ? "left" : "right";
}

/** A peek: the full window grown inward from the docked side, keeping the sketch's vertical centre, held inside the frame. */
export function peekRect(side: Side, dock: Rect, monitor: Rect): Rect {
  const x = side === "left" ? monitor.x : monitor.x + monitor.w - FULL_W;
  const y = dock.y + dock.h / 2 - FULL_H / 2;
  return { x, y: clamp(y, monitor.y, monitor.y + monitor.h - FULL_H), w: FULL_W, h: FULL_H };
}

/** The full window opened where a sketch was dropped: from its top-left, held inside the frame. */
function fullFrom(rect: Rect, monitor: Rect): Rect {
  return {
    x: clamp(rect.x, monitor.x, monitor.x + monitor.w - FULL_W),
    y: clamp(rect.y, monitor.y, monitor.y + monitor.h - FULL_H),
    w: FULL_W,
    h: FULL_H,
  };
}

/**
 * Whether a window that came to rest at `a` is where `b` put it: the move that window.ts makes when it puts the window
 * where a mode wants it comes back as a moved event, and must not count as the person moving it. A point of slack for
 * rounding between pixels and points.
 */
export const samePlace = (a: Rect, b: Rect) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;

/** The collapse button is only there while the window may dock. */
export const canCollapse = (settings: ModeSettings): boolean => !settings.always3d;

/** The state for a window found at `rect`: already a sketch at an edge (the page was reloaded while docked), or full. */
export function start(rect: Rect, monitor: Rect, settings: ModeSettings): ModeState {
  const s: ModeState = { mode: "full", rect, monitor, side: null, dock: null, over: false, since: null, back: null };
  const side = nearEdge(rect, monitor);
  const sketch = Math.abs(rect.w - EDGE_W) <= 1 && Math.abs(rect.h - EDGE_H) <= 1;
  if (settings.always3d || !sketch || !side) return s;
  const dock = dockRect(side, rect.y, monitor);
  return { ...s, mode: "edge", side, dock, rect: dock };
}

/** Docked as a sketch at `side`, its top at `y`. */
function docked(s: ModeState, side: Side, y: number, monitor: Rect): ModeState {
  const dock = dockRect(side, y, monitor);
  return { ...s, mode: "edge", rect: dock, monitor, side, dock, over: false, since: null };
}

/** The full window at `rect`, no longer docked. */
const full = (s: ModeState, rect: Rect, monitor: Rect = s.monitor): ModeState => ({
  ...s,
  mode: "full",
  rect,
  monitor,
  side: null,
  dock: null,
  over: false,
  since: null,
});

/** A docked window opened for good, in place: a sketch where its peek would be, a peek where it is. */
function opened(s: ModeState): ModeState {
  if (s.mode === "edge" && s.side && s.dock) return full(s, peekRect(s.side, s.dock, s.monitor));
  return full(s, s.rect);
}

/**
 * The next state of the window after `ev`. `tick` is the clock going on (the hover times are measured with it, in the
 * same clock as the pointer events). With Always 3D on, a docked window opens at its next event and never docks again.
 */
export function step(s: ModeState, ev: ModeEvent, settings: ModeSettings): ModeState {
  if (ev.type === "visibility") {
    if (ev.hidden) return s.mode === "hidden" ? s : { ...s, mode: "hidden", back: s.mode };
    if (s.mode !== "hidden") return s;
    const shown: ModeState = { ...s, mode: s.back ?? "full", back: null };
    return settings.always3d && shown.mode !== "full" ? opened(shown) : shown;
  }
  if (s.mode === "hidden") return s;
  if (settings.always3d && s.mode !== "full") s = opened(s);
  if (s.mode === "full") return stepFull(s, ev, settings);
  if (s.mode === "edge") return stepEdge(s, ev);
  return stepPeek(s, ev);
}

function stepFull(s: ModeState, ev: ModeEvent, settings: ModeSettings): ModeState {
  if (ev.type === "moved") {
    if (samePlace(ev.rect, s.rect)) return { ...s, rect: ev.rect, monitor: ev.monitor };
    const side = settings.always3d ? null : nearEdge(ev.rect, ev.monitor);
    return side ? docked(s, side, ev.rect.y, ev.monitor) : { ...s, rect: ev.rect, monitor: ev.monitor };
  }
  if (ev.type === "collapse" && canCollapse(settings)) {
    const side: Side = s.rect.x + s.rect.w / 2 < s.monitor.x + s.monitor.w / 2 ? "left" : "right";
    return docked(s, side, s.rect.y, s.monitor);
  }
  return s;
}

function stepEdge(s: ModeState, ev: ModeEvent): ModeState {
  switch (ev.type) {
    case "moved": {
      if (samePlace(ev.rect, s.rect)) return { ...s, rect: ev.rect, monitor: ev.monitor };
      const side = nearEdge(ev.rect, ev.monitor);
      return side ? docked(s, side, ev.rect.y, ev.monitor) : full(s, fullFrom(ev.rect, ev.monitor), ev.monitor);
    }
    case "pointerIn":
      return s.over ? s : { ...s, over: true, since: ev.t };
    case "pointerOut":
      return s.over ? { ...s, over: false, since: null } : s;
    case "tick":
      if (!s.over || s.since === null || ev.t - s.since < PEEK_AFTER_MS || !s.side || !s.dock) return s;
      return { ...s, mode: "peek", rect: peekRect(s.side, s.dock, s.monitor), over: true, since: null };
    case "click":
      return opened(s);
    default:
      return s;
  }
}

function stepPeek(s: ModeState, ev: ModeEvent): ModeState {
  switch (ev.type) {
    case "moved": {
      if (samePlace(ev.rect, s.rect)) return { ...s, rect: ev.rect, monitor: ev.monitor };
      const side = nearEdge(ev.rect, ev.monitor);
      if (!side) return full(s, ev.rect, ev.monitor);
      // moved along the edge: still a peek, and the sketch it shrinks back to is beside it
      const dock = dockRect(side, ev.rect.y + ev.rect.h / 2 - EDGE_H / 2, ev.monitor);
      return { ...s, rect: ev.rect, monitor: ev.monitor, side, dock };
    }
    case "pointerIn":
      return s.over ? s : { ...s, over: true, since: null };
    case "pointerOut":
      return s.over ? { ...s, over: false, since: ev.t } : s;
    case "tick":
      if (s.over || s.since === null || ev.t - s.since < UNPEEK_AFTER_MS || !s.dock) return s;
      return { ...s, mode: "edge", rect: s.dock, over: false, since: null };
    case "click":
      return opened(s);
    default:
      return s;
  }
}

/** When a tick next matters: the moment a hover opens a peek, or the pointer's absence closes it; null when none is due. */
export function nextTick(s: ModeState): number | null {
  if (s.since === null) return null;
  if (s.mode === "edge" && s.over) return s.since + PEEK_AFTER_MS;
  if (s.mode === "peek" && !s.over) return s.since + UNPEEK_AFTER_MS;
  return null;
}
