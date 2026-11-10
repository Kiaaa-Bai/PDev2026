// Every Kenney GLB points at an external `Textures/colormap.png`. `vite build` renames the GLBs (and
// inlines some as data URIs) and copies no such file, so the built app would have no palette at all.
// Each kit's picture is imported here, so the bundler ships it, and the kit's loader redirects the
// GLB's reference to it. Pure apart from the imports, so it can be tested in node.

import car from "../assets/kenney/car/Textures/colormap.png?url";
import commercial from "../assets/kenney/commercial/Textures/colormap.png?url";
import industrial from "../assets/kenney/industrial/Textures/colormap.png?url";
import roads from "../assets/kenney/roads/Textures/colormap.png?url";
import suburban from "../assets/kenney/suburban/Textures/colormap.png?url";

/** Each kit's palette picture, by the kit's folder under assets/kenney. The five palettes differ. */
export const COLORMAPS: Readonly<Record<string, string>> = { car, commercial, industrial, roads, suburban };

/** The kit a model belongs to: the folder in its path. */
export const kitOf = (model: string): string => model.slice(0, model.indexOf("/"));

/**
 * A URL modifier for a kit's `LoadingManager`: the GLB's reference to `colormap.png` becomes `url`.
 * The reference reaches the modifier already joined to the GLB's own address, and a GLB inlined as a
 * data URI has base64 slashes in that address, so only the end of it is looked at.
 */
export function colormapRedirect(url: string): (resolved: string) => string {
  return (resolved) => (/(^|\/)colormap\.png(\?.*)?$/.test(resolved) ? url : resolved);
}

/**
 * The one texture a kit's models all draw with: the first model to load supplies it, and every
 * other model's own decoded copy is dropped (before it was ever uploaded to the graphics card) for it.
 */
export function shareOne<T extends { dispose(): void }>(kit: { map: T | null }, own: T): T {
  if (!kit.map) kit.map = own;
  else if (own !== kit.map) own.dispose();
  return kit.map;
}
