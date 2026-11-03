import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { WINDOW_LIT } from "../src/render/looks";
import { patchPalette, patchWindows, PALETTE_SIZE, ROOF_BLOCK, ROOF_TEXEL, WINDOW_BLOCK } from "../src/render/palette-shader";

/** What Three hands onBeforeCompile for a Lambert material: the unexpanded includes. */
function compile(material: THREE.MeshLambertMaterial) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    fragmentShader: "#include <common>\nvoid main() {\n#include <map_fragment>\n#include <color_fragment>\n}",
  };
  (material.onBeforeCompile as (s: typeof shader, r: unknown) => void)(shader, null);
  return shader;
}

describe("patchPalette", () => {
  const roofTexel = new THREE.Color().setRGB(79 / 255, 186 / 255, 130 / 255, THREE.SRGBColorSpace);

  it("recolours the roof block and stops the instance colour from tinting the whole texel", () => {
    const material = new THREE.MeshLambertMaterial();
    patchPalette(material, roofTexel, { value: 0 });
    const { fragmentShader } = compile(material);
    expect(fragmentShader).toContain("uniform vec4 roofBlock;");
    expect(fragmentShader).toContain("vColor.rgb * clamp( shade");
    // the stock sampling is still there, with the recolour in front of its last line
    expect(fragmentShader).toContain("texture2D( map, vMapUv )");
    expect(fragmentShader.indexOf("vColor.rgb * clamp")).toBeLessThan(fragmentShader.indexOf("diffuseColor *= sampledDiffuseColor;"));
    expect(fragmentShader).not.toContain("#include <color_fragment>");
  });

  it("hands the shader the roof's block of the palette as UVs and the roof texel's brightness", () => {
    const material = new THREE.MeshLambertMaterial();
    patchPalette(material, roofTexel, { value: 0 });
    const { uniforms } = compile(material);
    const block = uniforms.roofBlock.value as THREE.Vector4;
    expect(block.toArray()).toEqual([
      ROOF_BLOCK.x / PALETTE_SIZE,
      ROOF_BLOCK.y / PALETTE_SIZE,
      (ROOF_BLOCK.x + ROOF_BLOCK.w) / PALETTE_SIZE,
      (ROOF_BLOCK.y + ROOF_BLOCK.h) / PALETTE_SIZE,
    ]);
    expect(uniforms.roofLuma.value).toBeCloseTo(0.2126 * roofTexel.r + 0.7152 * roofTexel.g + 0.0722 * roofTexel.b);
  });

  it("reads its reference texel from inside the roof block", () => {
    expect(ROOF_TEXEL.x).toBeGreaterThanOrEqual(ROOF_BLOCK.x);
    expect(ROOF_TEXEL.x).toBeLessThan(ROOF_BLOCK.x + ROOF_BLOCK.w);
    expect(ROOF_TEXEL.y).toBeGreaterThanOrEqual(ROOF_BLOCK.y);
    expect(ROOF_TEXEL.y).toBeLessThan(ROOF_BLOCK.y + ROOF_BLOCK.h);
  });
});

describe("lit windows", () => {
  const roofTexel = new THREE.Color().setRGB(79 / 255, 186 / 255, 130 / 255, THREE.SRGBColorSpace);

  it("reads the window block as UVs, and not from the roof's or outside the picture", () => {
    expect(WINDOW_BLOCK.x + WINDOW_BLOCK.w).toBeLessThanOrEqual(PALETTE_SIZE);
    expect(WINDOW_BLOCK.y + WINDOW_BLOCK.h).toBeLessThanOrEqual(PALETTE_SIZE);
    const apart = WINDOW_BLOCK.x >= ROOF_BLOCK.x + ROOF_BLOCK.w || ROOF_BLOCK.x >= WINDOW_BLOCK.x + WINDOW_BLOCK.w;
    expect(apart || WINDOW_BLOCK.y >= ROOF_BLOCK.y + ROOF_BLOCK.h || ROOF_BLOCK.y >= WINDOW_BLOCK.y + WINDOW_BLOCK.h).toBe(true);
  });

  it("brightens the roof material's window texels by the night uniform it is given, by reference", () => {
    const night = { value: 0 };
    const material = new THREE.MeshLambertMaterial();
    patchPalette(material, roofTexel, night);
    const { fragmentShader, uniforms } = compile(material);
    expect(uniforms.night).toBe(night);
    expect(fragmentShader).toContain("uniform float night;");
    expect(fragmentShader).toContain("totalEmissiveRadiance += windowLit * night;");
    const block = uniforms.windowBlock.value as THREE.Vector4;
    expect(block.toArray()).toEqual([
      WINDOW_BLOCK.x / PALETTE_SIZE,
      WINDOW_BLOCK.y / PALETTE_SIZE,
      (WINDOW_BLOCK.x + WINDOW_BLOCK.w) / PALETTE_SIZE,
      (WINDOW_BLOCK.y + WINDOW_BLOCK.h) / PALETTE_SIZE,
    ]);
    expect((uniforms.windowLit.value as THREE.Color).getHex()).toBe(WINDOW_LIT);
  });

  it("lights the windows of a model that keeps its own colours, leaving its colour handling alone, under its own program key", () => {
    const night = { value: 0.5 };
    const commercial = new THREE.MeshLambertMaterial();
    const suburban = new THREE.MeshLambertMaterial();
    patchWindows(commercial, night);
    patchPalette(suburban, roofTexel, night);
    const { fragmentShader, uniforms } = compile(commercial);
    expect(uniforms.night).toBe(night);
    expect(fragmentShader).toContain("totalEmissiveRadiance += windowLit * night;");
    expect(fragmentShader).toContain("#include <color_fragment>");
    expect(fragmentShader).not.toContain("roofBlock");
    expect(commercial.customProgramCacheKey()).not.toBe(suburban.customProgramCacheKey());
  });
});
