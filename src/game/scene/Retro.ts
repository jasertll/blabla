import { BlendFunction, Effect } from "postprocessing";
import * as THREE from "three";

// The PlayStation look, the way the original Silent Hill games were drawn:
// a low internal resolution scaled up without smoothing, colour reduced to
// a few bits per channel with ordered dithering, and vertices snapped to the
// screen's pixel grid so geometry wobbles slightly as the camera moves.

const fragment = /* glsl */ `
uniform float levels;
float bayer4(vec2 p) {
  vec2 q = mod(p, 4.0);
  int i = int(q.x) + int(q.y) * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return float(m[i]) / 16.0 - 0.5;
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // quantise in display (sRGB-like) space, or the shadows collapse to black
  vec3 c = pow(max(inputColor.rgb, 0.0), vec3(1.0 / 2.2));
  c += bayer4(floor(uv * resolution)) / levels;
  c = floor(c * levels + 0.5) / levels;
  outputColor = vec4(pow(max(c, 0.0), vec3(2.2)), inputColor.a);
}
`;

export class DitherEffect extends Effect {
  constructor(levels = 24) {
    super("DitherEffect", fragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([["levels", new THREE.Uniform(levels)]]),
    });
  }
}

let snapped = false;

/** Snap every vertex to a coarse clip-space grid (the PS1 wobble). Applies to
 *  all materials compiled afterwards, so call it before the first render. */
export function enableVertexSnap(grid = [320, 240]) {
  if (snapped) return;
  snapped = true;
  THREE.ShaderChunk.project_vertex = THREE.ShaderChunk.project_vertex.replace(
    "gl_Position = projectionMatrix * mvPosition;",
    `gl_Position = projectionMatrix * mvPosition;
  {
    vec2 g = vec2(${grid[0].toFixed(1)}, ${grid[1].toFixed(1)}) * 0.5;
    gl_Position.xy = floor(gl_Position.xy / gl_Position.w * g + 0.5) / g * gl_Position.w;
  }`,
  );
}
