import * as THREE from "three";
import { WINDOW_LIT } from "./looks";

// Kenney's suburban models take every colour from one 512 px palette picture. Roofs use one
// block of it: a green that fades from light at the top to dark at the bottom, 32 px wide
// (x 32-63) and 128 px tall (y 128-255), found by reading each model's UVs against the PNG.
// The same greens sit in another block (x 96-127, y 384-511), but that one is the hedge along
// the front of the house, so the roof can't be told from the hedge by its colour, only by
// where in the palette it is read.
//
// Windows are a block too: the pale-blue-to-blue gradient at x 352-383, y 128-255, which every
// suburban and commercial model reads for its window glass and for nothing else (the suburban
// models read 7 blocks of the palette in all and the commercial ones 8, counted from their UVs).
// At night the glass glows.

/** The palette picture's width and height in pixels. */
export const PALETTE_SIZE = 512;
/** The roof's block of the palette, in pixels. */
export const ROOF_BLOCK = { x: 32, y: 128, w: 32, h: 128 } as const;
/** The pixel in that block that most roof faces read (about 3/4 of the roof area): the roof's base green. */
export const ROOF_TEXEL = { x: 40, y: 160 } as const;

/** The window glass's block of the palette (the colormap of suburban and commercial models alike), in pixels. */
export const WINDOW_BLOCK = { x: 352, y: 128, w: 32, h: 128 } as const;

/** The colour of one pixel of a loaded picture, in Three's working colour space. */
export function readTexel(image: CanvasImageSource & { width: number; height: number }, x: number, y: number): THREE.Color {
  if (image.width !== PALETTE_SIZE || image.height !== PALETTE_SIZE) {
    throw new Error(`palette is ${image.width}x${image.height}, expected ${PALETTE_SIZE}x${PALETTE_SIZE}`);
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d canvas to read the palette with");
  ctx.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
}

/** What the roof block's texel becomes: the instance colour, as light or dark as the texel is against the roof's base green. */
const RECOLOUR = /* glsl */ `
#ifdef USE_COLOR
	if ( all( greaterThanEqual( vMapUv, roofBlock.xy ) ) && all( lessThan( vMapUv, roofBlock.zw ) ) ) {
		float shade = dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) / roofLuma;
		sampledDiffuseColor.rgb = vColor.rgb * clamp( shade, 0.0, 1.3 );
	}
#endif
`;

/**
 * Window glass turns warm and lights itself by `night`: the texel moves towards the lit colour
 * and the same colour is added as emitted light, so it stays bright when the sun and the glow dim.
 */
const GLOW = /* glsl */ `
	if ( all( greaterThanEqual( vMapUv, windowBlock.xy ) ) && all( lessThan( vMapUv, windowBlock.zw ) ) ) {
		sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, windowLit, night );
		totalEmissiveRadiance += windowLit * night;
	}
`;

/** The uniforms every window glow reads. */
const GLOW_UNIFORMS = "uniform vec4 windowBlock;\nuniform vec3 windowLit;\nuniform float night;";

/** How far the night has come, 0 to 1: one object shared by every patched material, so changing `value` relights them all on the next draw. */
export interface NightUniform {
  value: number;
}

function glowUniforms(night: NightUniform) {
  return {
    windowBlock: {
      value: new THREE.Vector4(
        WINDOW_BLOCK.x / PALETTE_SIZE,
        WINDOW_BLOCK.y / PALETTE_SIZE,
        (WINDOW_BLOCK.x + WINDOW_BLOCK.w) / PALETTE_SIZE,
        (WINDOW_BLOCK.y + WINDOW_BLOCK.h) / PALETTE_SIZE,
      ),
    },
    windowLit: { value: new THREE.Color(WINDOW_LIT) },
    night,
  };
}

const MAP = THREE.ShaderChunk.map_fragment;
const SAMPLE_END = "diffuseColor *= sampledDiffuseColor;";

/**
 * Makes a suburban material swap its roof texels for each instance's colour (`setColorAt`),
 * keeping the roof's own light-to-dark shading, and leave every other texel exactly as it is.
 * `roofTexel` is the roof's base green read from the palette; shading is each texel's brightness
 * against it. Walls, doors and hedges are not touched, and the instance colour is not multiplied
 * into them as it is on other models. Window glass lights up with `night`.
 */
export function patchPalette(material: THREE.MeshLambertMaterial, roofTexel: THREE.Color, night: NightUniform): void {
  if (!MAP.includes(SAMPLE_END)) throw new Error("this Three.js version's map_fragment has changed; palette patch needs updating");
  const luma = roofTexel.r * 0.2126 + roofTexel.g * 0.7152 + roofTexel.b * 0.0722;
  const mapFragment = MAP.replace(SAMPLE_END, RECOLOUR + GLOW + SAMPLE_END);
  const roofBlock = new THREE.Vector4(
    ROOF_BLOCK.x / PALETTE_SIZE,
    ROOF_BLOCK.y / PALETTE_SIZE,
    (ROOF_BLOCK.x + ROOF_BLOCK.w) / PALETTE_SIZE,
    (ROOF_BLOCK.y + ROOF_BLOCK.h) / PALETTE_SIZE,
  );
  material.onBeforeCompile = (shader) => {
    shader.uniforms.roofBlock = { value: roofBlock };
    shader.uniforms.roofLuma = { value: luma };
    Object.assign(shader.uniforms, glowUniforms(night));
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform vec4 roofBlock;\nuniform float roofLuma;\n${GLOW_UNIFORMS}`)
      .replace("#include <map_fragment>", mapFragment)
      // the stock line multiplies the instance colour into the whole texel; here it only goes into the roof
      .replace("#include <color_fragment>", "");
  };
  material.customProgramCacheKey = () => "palette-roof-window";
}

/**
 * Lights the window glass of a model that otherwise keeps its own colours (the commercial
 * buildings), with `night`. Nothing else about the material changes, so instance colours still apply.
 */
export function patchWindows(material: THREE.MeshLambertMaterial, night: NightUniform): void {
  if (!MAP.includes(SAMPLE_END)) throw new Error("this Three.js version's map_fragment has changed; palette patch needs updating");
  const mapFragment = MAP.replace(SAMPLE_END, GLOW + SAMPLE_END);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, glowUniforms(night));
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${GLOW_UNIFORMS}`)
      .replace("#include <map_fragment>", mapFragment);
  };
  material.customProgramCacheKey = () => "palette-window";
}
