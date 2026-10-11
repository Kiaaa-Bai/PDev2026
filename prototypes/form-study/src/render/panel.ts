import { Application } from "pixi.js";

/** Every panel is 512×320, the pad's 1.6 aspect ratio. */
export const PANEL_W = 512;
export const PANEL_H = 320;

export interface Panel {
  app: Application;
  /** app.canvas typed as a DOM canvas (Pixi types it as its own ICanvas). */
  canvas: HTMLCanvasElement;
  stat: HTMLElement;
}

export async function createPanel(host: HTMLElement, title: string): Promise<Panel> {
  const section = document.createElement("section");
  section.className = "panel";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const stat = document.createElement("p");
  stat.className = "stat";
  const app = new Application();
  await app.init({ width: PANEL_W, height: PANEL_H, background: "#1d1d1b", antialias: false, roundPixels: true });
  const canvas = app.canvas as HTMLCanvasElement;
  section.append(heading, canvas, stat);
  host.append(section);
  return { app, canvas, stat };
}
