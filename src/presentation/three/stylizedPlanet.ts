/**
 * Microscope-eye planet — the far zoom is not “space”, it is looking down a
 * microscope ocular at a gigantic silicon die. The sphere reads as an eye
 * (iris + pupil) whose iris is etched with PCB traces, pads and vias; the
 * group spins slowly so the chip “disconnects” under the lens. No canvas
 * plotting: every layer is a live GLSL shader.
 */

import * as THREE from 'three';

const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm(vec3 p) {
  float f = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    f += a * snoise(p);
    p *= 2.05;
    a *= 0.5;
  }
  return f;
}

vec3 rotateY(vec3 p, float a) {
  float c = cos(a); float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}
`;

const SURFACE_VERT = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
varying vec3 vLocalPos;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vLocalPos = normalize(position);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/** Silicon die + iris rings + pupil — the eye of the microscope. */
const SURFACE_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uSpin;
uniform vec3 uSunDir;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
varying vec3 vLocalPos;

${NOISE_GLSL}

void main() {
  vec3 n = normalize(vWorldNormal);
  vec3 lp = rotateY(normalize(vLocalPos), uSpin);
  // Spherical → “iris radius” from the facing pole (eye looking up the ocular).
  float polar = acos(clamp(lp.y, -1.0, 1.0));
  float irisR = polar / 3.14159265; // 0 at pupil pole → 1 at back

  // PCB substrate (FR4 green / deep silicon).
  vec3 board = mix(vec3(0.02, 0.08, 0.05), vec3(0.04, 0.12, 0.09), 0.5 + 0.5 * fbm(lp * 3.0));

  // Grid of copper traces (chip streets).
  vec2 uv = vec2(atan(lp.z, lp.x) / 6.2831853 + 0.5, lp.y * 0.5 + 0.5);
  vec2 grid = abs(fract(uv * vec2(48.0, 28.0) + uSpin * 0.08) - 0.5);
  float traceH = smoothstep(0.045, 0.012, grid.x);
  float traceV = smoothstep(0.055, 0.015, grid.y);
  float bus = max(traceH, traceV);

  // Irregular vias / pads.
  float pads = smoothstep(0.55, 0.85, fbm(lp * 18.0 + 2.0));
  float vias = smoothstep(0.72, 0.92, fbm(lp * 42.0 - uTime * 0.02));

  // Concentric iris rings (eye looking into the microscope).
  float rings = abs(fract(irisR * 11.0 - uTime * 0.015) - 0.5);
  float irisLine = smoothstep(0.08, 0.02, rings);
  float irisBand = smoothstep(0.08, 0.18, irisR) * (1.0 - smoothstep(0.42, 0.55, irisR));

  // Pupil — dark void at the facing pole (Genesis under the lens).
  float pupil = 1.0 - smoothstep(0.0, 0.14, irisR);
  float pupilGlow = smoothstep(0.14, 0.0, irisR) * 0.55;

  vec3 copper = vec3(0.85, 0.55, 0.18);
  vec3 neon = vec3(0.2, 0.95, 0.85);
  vec3 irisCol = mix(vec3(0.08, 0.45, 0.55), vec3(0.15, 0.85, 0.7), irisLine);

  vec3 col = board;
  col = mix(col, copper, bus * 0.75);
  col = mix(col, copper * 1.15, pads * 0.35);
  col += neon * vias * 0.55;
  col = mix(col, irisCol, irisBand * 0.85);
  col = mix(col, vec3(0.01, 0.015, 0.03), pupil);
  col += vec3(0.25, 0.9, 1.0) * pupilGlow;

  // Specular “solder” flash + soft microscope lighting.
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float ndl = max(dot(n, normalize(uSunDir)), 0.0);
  float spec = pow(max(dot(n, normalize(normalize(uSunDir) + viewDir)), 0.0), 64.0);
  col *= 0.22 + 0.78 * ndl;
  col += copper * spec * bus * 0.65;

  // Chromatic rim like glass of the ocular.
  float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 2.8);
  col += vec3(0.4, 0.85, 1.0) * fres * 0.35;
  col += vec3(1.0, 0.3, 0.45) * fres * fres * 0.12;

  gl_FragColor = vec4(col, 1.0);
}
`;

const TRACE_VERT = /* glsl */ `
varying vec3 vLocalPos;
varying vec3 vWorldNormal;
void main() {
  vLocalPos = normalize(position);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Floating neon signal layer — data moving on the die. */
const TRACE_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uSpin;
varying vec3 vLocalPos;
varying vec3 vWorldNormal;

${NOISE_GLSL}

void main() {
  vec3 lp = rotateY(normalize(vLocalPos), uSpin * 1.2);
  float polar = acos(clamp(lp.y, -1.0, 1.0)) / 3.14159265;
  vec2 uv = vec2(atan(lp.z, lp.x) / 6.2831853 + 0.5, polar);
  float lane = abs(fract(uv.x * 36.0 + uTime * 0.12) - 0.5);
  float pulse = smoothstep(0.04, 0.0, lane);
  float ring = abs(fract(uv.y * 9.0 - uTime * 0.08) - 0.5);
  float ringPulse = smoothstep(0.06, 0.0, ring);
  float mask = smoothstep(0.12, 0.2, polar) * (1.0 - smoothstep(0.48, 0.6, polar));
  float a = (pulse * 0.55 + ringPulse * 0.4) * mask;
  vec3 col = mix(vec3(0.1, 1.0, 0.85), vec3(0.4, 0.7, 1.0), pulse);
  gl_FragColor = vec4(col, a * 0.7);
}
`;

const ATMO_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/** Glass of the microscope ocular around the eye. */
const ATMO_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uPower;
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fres = pow(1.0 - max(dot(normalize(vNormal), viewDir), 0.0), uPower);
  gl_FragColor = vec4(uColor, fres * uIntensity);
}
`;

export interface StylizedPlanet {
  readonly group: THREE.Group;
  tick: (seconds: number) => void;
  dispose: () => void;
}

/** Gigantic chip-eye under a microscope — layers spin independently. */
export function createStylizedPlanet(): StylizedPlanet {
  const group = new THREE.Group();
  const spinRoot = new THREE.Group();
  spinRoot.name = 'planet-spin';
  group.add(spinRoot);

  const sunDir = new THREE.Vector3(0.4, 0.75, 0.35).normalize();

  const surfaceUniforms = {
    uTime: { value: 0 },
    uSpin: { value: 0 },
    uSunDir: { value: sunDir.clone() },
  };
  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(1, 128, 96),
    new THREE.ShaderMaterial({
      uniforms: surfaceUniforms,
      vertexShader: SURFACE_VERT,
      fragmentShader: SURFACE_FRAG,
    })
  );
  surface.name = 'planet-surface';

  const traceUniforms = {
    uTime: { value: 0 },
    uSpin: { value: 0 },
  };
  const traces = new THREE.Mesh(
    new THREE.SphereGeometry(1.012, 96, 72),
    new THREE.ShaderMaterial({
      uniforms: traceUniforms,
      vertexShader: TRACE_VERT,
      fragmentShader: TRACE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  traces.name = 'planet-traces';

  const makeGlass = (radius: number, color: string, intensity: number, power: number, side: THREE.Side): THREE.Mesh => {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uIntensity: { value: intensity },
        uPower: { value: power },
      },
      vertexShader: ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      transparent: true,
      depthWrite: false,
      side,
      blending: THREE.AdditiveBlending,
    });
    return new THREE.Mesh(new THREE.SphereGeometry(radius, 80, 64), mat);
  };

  const ocularInner = makeGlass(1.035, '#5eead4', 0.5, 2.6, THREE.FrontSide);
  ocularInner.name = 'planet-ocular-inner';
  const ocularRim = makeGlass(1.09, '#22d3ee', 0.75, 3.4, THREE.BackSide);
  ocularRim.name = 'planet-ocular-rim';
  const ocularHalo = makeGlass(1.16, '#a5f3fc', 0.32, 4.0, THREE.BackSide);
  ocularHalo.name = 'planet-ocular-halo';

  for (const obj of [surface, traces, ocularInner, ocularRim, ocularHalo]) {
    obj.raycast = () => undefined;
  }

  spinRoot.add(surface, traces);
  group.add(ocularInner, ocularRim, ocularHalo);

  const tick = (seconds: number): void => {
    // Slow disconnect under the lens — the eye drifts away from the ocular.
    const spin = seconds * 0.055;
    surfaceUniforms.uTime.value = seconds;
    surfaceUniforms.uSpin.value = spin;
    traceUniforms.uTime.value = seconds;
    traceUniforms.uSpin.value = spin * 1.15;
    spinRoot.rotation.y = spin * 0.35;
    spinRoot.rotation.z = Math.sin(seconds * 0.09) * 0.06;
    spinRoot.rotation.x = 0.22 + Math.sin(seconds * 0.04) * 0.03;
  };

  const dispose = (): void => {
    for (const obj of [surface, traces, ocularInner, ocularRim, ocularHalo]) {
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
  };

  return { group, tick, dispose };
}
