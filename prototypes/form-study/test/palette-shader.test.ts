import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { STREET_COLOUR, WINDOW_LIT } from "../src/render/looks";
import {
  ASPHALT_BLOCK,
  patchAsphalt,
  KERB_BLOCK,
  patchPalette,
  patchWindows,
  PALETTE_SIZE,
  ROOF_BLOCK,
  ROOF_TEXEL,
  WINDOW_BLOCK,
} from "../src/render/palette-shader";

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

/** The pixels of an 8-bit, non-interlaced RGB or RGBA PNG, as [width, bytes per pixel, rows of bytes]. */
function readPng(path: string): { width: number; bpp: number; data: Uint8Array } {
  const file = readFileSync(path);
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let width = 0;
  let bpp = 0;
  const idat: Uint8Array[] = [];
  for (let at = 8; at < file.length; ) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...file.subarray(at + 4, at + 8));
    const body = file.subarray(at + 8, at + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      bpp = body[9] === 6 ? 4 : 3;
    }
    if (type === "IDAT") idat.push(body);
    at += 12 + len;
  }
  const joined = new Uint8Array(idat.reduce((n, part) => n + part.length, 0));
  idat.reduce((at, part) => (joined.set(part, at), at + part.length), 0);
  const raw = inflateSync(joined);
  const stride = width * bpp;
  const data = new Uint8Array(raw.length - raw.length / (stride + 1));
  for (let y = 0; y < data.length / stride; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const left = x >= bpp ? data[y * stride + x - bpp] : 0;
      const up = y ? data[(y - 1) * stride + x] : 0;
      const upLeft = x >= bpp && y ? data[(y - 1) * stride + x - bpp] : 0;
      const paeth = () => {
        const p = left + up - upLeft;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      };
      data[y * stride + x] = (v + [0, left, up, (left + up) >> 1, paeth()][filter]) & 255;
    }
  }
  return { width, bpp, data };
}

describe("road asphalt", () => {
  it("is the flat colour a paved street is drawn in, in every texel of its block of the roads palette", () => {
    const { width, bpp, data } = readPng("src/assets/kenney/roads/Textures/colormap.png");
    expect(width).toBe(PALETTE_SIZE);
    for (let y = ASPHALT_BLOCK.y; y < ASPHALT_BLOCK.y + ASPHALT_BLOCK.h; y++) {
      for (let x = ASPHALT_BLOCK.x; x < ASPHALT_BLOCK.x + ASPHALT_BLOCK.w; x++) {
        const i = (y * width + x) * bpp;
        expect((data[i] << 16) | (data[i + 1] << 8) | data[i + 2], `texel ${x},${y}`).toBe(STREET_COLOUR);
      }
    }
  });

  it("swaps the asphalt block for the instance colour and leaves the kerb and markings as drawn", () => {
    const material = new THREE.MeshLambertMaterial();
    patchAsphalt(material);
    const { fragmentShader, uniforms } = compile(material);
    expect(fragmentShader).toContain("uniform vec4 asphaltBlock;");
    expect(fragmentShader).toContain("sampledDiffuseColor.rgb = vColor.rgb;");
    // the stock sampling is still there, with the swap in front of its last line, and the instance colour is not also multiplied in
    expect(fragmentShader).toContain("texture2D( map, vMapUv )");
    expect(fragmentShader.indexOf("sampledDiffuseColor.rgb = vColor.rgb;")).toBeLessThan(fragmentShader.indexOf("diffuseColor *= sampledDiffuseColor;"));
    expect(fragmentShader).not.toContain("#include <color_fragment>");
    expect((uniforms.asphaltBlock.value as THREE.Vector4).toArray()).toEqual([
      ASPHALT_BLOCK.x / PALETTE_SIZE,
      ASPHALT_BLOCK.y / PALETTE_SIZE,
      (ASPHALT_BLOCK.x + ASPHALT_BLOCK.w) / PALETTE_SIZE,
      (ASPHALT_BLOCK.y + ASPHALT_BLOCK.h) / PALETTE_SIZE,
    ]);
  });

  it("with a flat kerb, swaps the kerb block for the instance colour too, under another program key", () => {
    const flat = new THREE.MeshLambertMaterial();
    const kerbed = new THREE.MeshLambertMaterial();
    patchAsphalt(flat, true);
    patchAsphalt(kerbed);
    const { fragmentShader, uniforms } = compile(flat);
    expect(fragmentShader).toContain("uniform vec4 kerbBlock;");
    expect((uniforms.kerbBlock.value as THREE.Vector4).toArray()).toEqual([
      KERB_BLOCK.x / PALETTE_SIZE,
      KERB_BLOCK.y / PALETTE_SIZE,
      (KERB_BLOCK.x + KERB_BLOCK.w) / PALETTE_SIZE,
      (KERB_BLOCK.y + KERB_BLOCK.h) / PALETTE_SIZE,
    ]);
    expect(compile(kerbed).fragmentShader).not.toContain("kerbBlock");
    expect(flat.customProgramCacheKey()).not.toBe(kerbed.customProgramCacheKey());
  });

  it("finds the kerb where the road models sample it: a block of its own, clear of the asphalt", () => {
    // texels read off road-straight.glb's UVs (2026-11-10): kerb top, side and gutter
    for (const [x, y] of [[240, 268], [240, 320], [240, 371]]) {
      expect(x >= KERB_BLOCK.x && x < KERB_BLOCK.x + KERB_BLOCK.w && y >= KERB_BLOCK.y && y < KERB_BLOCK.y + KERB_BLOCK.h, `${x},${y}`).toBe(true);
    }
    expect(KERB_BLOCK.x + KERB_BLOCK.w <= ASPHALT_BLOCK.x || KERB_BLOCK.x >= ASPHALT_BLOCK.x + ASPHALT_BLOCK.w).toBe(true);
  });

  it("compiles under a program key of its own", () => {
    const road = new THREE.MeshLambertMaterial();
    const windows = new THREE.MeshLambertMaterial();
    patchAsphalt(road);
    patchWindows(windows, { value: 0 });
    expect(road.customProgramCacheKey()).not.toBe(windows.customProgramCacheKey());
  });
});
