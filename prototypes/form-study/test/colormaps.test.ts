import { describe, expect, it } from "vitest";
import { COLORMAPS, colormapRedirect, kitOf, shareOne } from "../src/render/colormaps";
import { MODEL_NAMES } from "../src/render/pieces";

describe("kitOf", () => {
  it("is the folder a model lives in", () => {
    expect(kitOf("suburban/building-type-a")).toBe("suburban");
    expect(kitOf("roads/road-straight")).toBe("roads");
  });
});

describe("COLORMAPS", () => {
  it("has a picture for the kit of every model the city draws", () => {
    for (const name of MODEL_NAMES) expect(COLORMAPS, name).toHaveProperty([kitOf(name)]);
  });

  it("gives each kit its own picture, since the four palettes differ", () => {
    const urls = Object.values(COLORMAPS);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) expect(url).toMatch(/colormap.*\.png/);
  });
});

describe("colormapRedirect", () => {
  const redirect = colormapRedirect("/assets/colormap-abc123.png");

  it("sends the GLB's reference to colormap.png to the bundled picture", () => {
    expect(redirect("/assets/Textures/colormap.png")).toBe("/assets/colormap-abc123.png");
    expect(redirect("Textures/colormap.png")).toBe("/assets/colormap-abc123.png");
    expect(redirect("http://localhost:5174/src/assets/kenney/suburban/Textures/colormap.png?t=1")).toBe("/assets/colormap-abc123.png");
  });

  it("does so when the GLB was inlined as a data URI, whose base64 text contains slashes", () => {
    expect(redirect("data:model/gltf-binary;base64,AB/CD/EF/Textures/colormap.png")).toBe("/assets/colormap-abc123.png");
  });

  it("leaves every other URL alone", () => {
    for (const url of ["/assets/building-a-Cyk3Lb54.glb", "data:model/gltf-binary;base64,AB/CD", "/assets/notcolormap.png", "/assets/colormap.png.glb"]) {
      expect(redirect(url)).toBe(url);
    }
  });
});

describe("shareOne", () => {
  const texture = () => ({ disposed: false, dispose() { this.disposed = true; } });

  it("makes the first texture the kit's and hands every later model that one, dropping its own copy", () => {
    const kit = { map: null as ReturnType<typeof texture> | null };
    const a = texture();
    const b = texture();
    const c = texture();
    expect(shareOne(kit, a)).toBe(a);
    expect(shareOne(kit, b)).toBe(a);
    expect(shareOne(kit, c)).toBe(a);
    expect(kit.map).toBe(a);
    expect([a.disposed, b.disposed, c.disposed]).toEqual([false, true, true]);
  });

  it("does not dispose the kit's texture when a model hands it back", () => {
    const kit = { map: null as ReturnType<typeof texture> | null };
    const a = texture();
    shareOne(kit, a);
    expect(shareOne(kit, a)).toBe(a);
    expect(a.disposed).toBe(false);
  });
});
