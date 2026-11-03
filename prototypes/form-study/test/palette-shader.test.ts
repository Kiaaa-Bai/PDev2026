import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { patchPalette, PALETTE_SIZE, ROOF_BLOCK, ROOF_TEXEL } from "../src/render/palette-shader";

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
    patchPalette(material, roofTexel);
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
    patchPalette(material, roofTexel);
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
