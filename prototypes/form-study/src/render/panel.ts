/** Every panel is 512×320, the pad's 1.6 aspect ratio. */
export const PANEL_W = 512;
export const PANEL_H = 320;

export interface Panel {
  canvas: HTMLCanvasElement;
  stat: HTMLElement;
}

/** A titled section around a canvas, with a line of stats under it. */
export function createPanel(host: HTMLElement, title: string, canvas: HTMLCanvasElement): Panel {
  const section = document.createElement("section");
  section.className = "panel";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const stat = document.createElement("p");
  stat.className = "stat";
  section.append(heading, canvas, stat);
  host.append(section);
  return { canvas, stat };
}
