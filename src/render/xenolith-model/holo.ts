// 10-7d: UFO ゼノリスの光の効果（描画だけ）: 六角の模様のホログラムのバリア（揺らぐと六角が欠けてほどける・当たると波紋が六角を
// 光らせて広がる・走査の線・「低」は 10-5a の青い殻）・瞬間移動の光の柱（上へ流れる光の帯・地上の回る輪。登場の光の柱にも使う）・
// 光の波は waves.ts。どれも出ているときだけ描く
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { XENOLITH_MODEL_CONFIG } from '../../data/xenolith-model';
import { XENOLITH_VISUAL } from '../../data/xenolith-visual';
import { f } from '../kaiju-look/glsl';

const M = XENOLITH_MODEL_CONFIG;
const V = XENOLITH_VISUAL;

export const additive = (
  u: Record<string, { value: unknown }>,
  vs: string,
  fs: string,
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    vertexShader: vs,
    fragmentShader: fs,
  });

/** 六角の格子（uv は格子の座標）: x = 縁までの距離（0 が縁・0.5 が真ん中）、yz = 六角の番号 */
const HEX_GLSL = /* glsl */ `
  float hexDist(vec2 p) { p = abs(p); return max(dot(p, vec2(0.5, 0.8660254)), p.x); }
  vec3 hexCell(vec2 uv) {
    vec2 r = vec2(1.0, 1.7320508);
    vec2 h = r * 0.5;
    vec2 a = mod(uv, r) - h;
    vec2 b = mod(uv - h, r) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    return vec3(0.5 - hexDist(gv), uv - gv);
  }
  float cellHash(vec2 id) { return fract(sin(dot(id, vec2(127.1, 311.7))) * 43758.5453); }
`;

/** バリアの殻（ワールドに置く。形は縦の軸の周りに対称なので回さない）。hex: 六角のホログラム（「中」「高」） */
export function createBarrierMesh(
  segments: number,
  hex: boolean,
): {
  mesh: Mesh;
  set(
    opacity: number,
    rippleDir: Readonly<Vector3>,
    ripple: number,
    flicker: number,
    time: number,
  ): void;
} {
  const geo = new SphereGeometry(1, segments, Math.max(6, Math.round(segments / 2)));
  const B = V.hex;
  const u = {
    uColor: { value: new Color(hex ? V.colors.hex : M.colors.barrier) },
    uFill: { value: new Color(V.colors.hexFill) },
    uOpacity: { value: 0 },
    uRipple: { value: new Vector3(0, 1, 0) },
    uRippleK: { value: 0 },
    uFlicker: { value: 0 },
    uTime: { value: 0 },
  };
  const hexPart = /* glsl */ `
        // 六角: 横は筒の周（周の数は整数で継ぎ目なし）、上下の面は真上からの平面。向きで混ぜる
        vec3 cs = hexCell(vec2(atan(vL.x, -vL.z) / 6.2831853 * ${f(B.cells)}, vL.y * ${f(B.cells * 0.16)}));
        vec3 ct = hexCell(vL.xz * ${f(B.cells * 0.34)});
        float wt = smoothstep(0.55, 0.85, abs(vL.y));
        float edgeD = mix(cs.x, ct.x, wt);
        vec2 id = mix(cs.yz, ct.yz + 50.0, step(0.5, wt));
        float hsh = cellHash(id);
        float line = 1.0 - smoothstep(0.0, ${f(B.line)}, edgeD);
        float shimmer = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 2.2 + hsh * 6.2831), 3.0);
        // 揺らぎで六角が欠けていく（ほどける）
        float alive = step(uFlicker * ${f(B.flickerDrop)}, hsh);
        float scan = exp(-pow((vL.y - (fract(uTime * ${f(B.scanHz)}) * 2.0 - 1.0)) * 6.0, 2.0));
        float ringCell = ring * (0.7 + 0.3 * hsh) * 1.6;
        vec3 col = uColor * (line * 1.3 + scan * 0.5) + uFill * (0.18 * shimmer + ringCell * 1.2);
        float a = (uOpacity * (0.25 + fres * 1.1) * (line * 1.6 + 0.22 * shimmer + scan * 0.6) + ringCell * (0.5 + line)) * alive;
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));`;
  const plainPart = /* glsl */ `
        float a = uOpacity * (0.25 + fres * 1.6) + ring * 0.9;
        gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));`;
  const mat = additive(
    u,
    /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vL;
      void main() {
        vL = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uFill;
      uniform float uOpacity;
      uniform vec3 uRipple;
      uniform float uRippleK;
      uniform float uFlicker;
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vL;
      ${hex ? HEX_GLSL : ''}
      void main() {
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);
        float ang = acos(clamp(dot(vL, uRipple), -1.0, 1.0));
        float front = (1.0 - uRippleK) * 1.4;
        float ring = exp(-pow((ang - front) * 7.0, 2.0)) * uRippleK;
        ${hex ? hexPart : plainPart}
      }`,
  );
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  return {
    mesh,
    set(opacity, rippleDir, ripple, flicker, time) {
      u.uOpacity.value = opacity;
      u.uRipple.value.copy(rippleDir);
      u.uRippleK.value = ripple;
      u.uFlicker.value = flicker;
      u.uTime.value = time;
    },
  };
}

/** 光の柱と地上の輪（瞬間移動の予兆・登場）。柱は上へ流れる光の帯、輪は回る点線 */
export function createWarpFx(): {
  pillar: Mesh;
  ring: Mesh;
  /** 柱の真ん中 (x, y, z)・床・強さ k（0〜1）・柱の太さ・高さ（m）・時計 */
  set(
    visible: boolean,
    x: number,
    y: number,
    z: number,
    floor: number,
    k: number,
    radius?: number,
    height?: number,
    time?: number,
  ): void;
} {
  const pg = new CylinderGeometry(1, 1, 1, 20, 1, true);
  const pu = { uK: { value: 0 }, uTime: { value: 0 }, uColor: { value: new Color(M.colors.warp) } };
  const pm = additive(
    pu,
    /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        vY = position.y + 0.5;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    /* glsl */ `
      uniform float uK;
      uniform float uTime;
      uniform vec3 uColor;
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        float c = abs(dot(normalize(vN), normalize(vV)));
        float bands = 0.6 + 0.4 * sin(vY * 60.0 - uTime * 9.0) * sin(vY * 13.0 + uTime * 3.0);
        float ends = smoothstep(0.0, 0.08, vY) * smoothstep(1.0, 0.75, vY);
        float a = (pow(c, 1.4) * 0.9 + pow(c, 8.0) * 0.8) * bands * ends * (0.25 + 0.65 * uK);
        gl_FragColor = vec4(uColor * (1.0 + pow(c, 8.0)), clamp(a, 0.0, 1.0));
      }`,
  );
  const pillar = new Mesh(pg, pm);
  const rg = new RingGeometry(0.72, 1, 64);
  rg.rotateX(-Math.PI / 2);
  const ru = { uK: { value: 0 }, uTime: { value: 0 }, uColor: { value: new Color(M.colors.warp) } };
  const rm = additive(
    ru,
    /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    /* glsl */ `
      uniform float uK;
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vP;
      void main() {
        float r = length(vP);
        float a01 = atan(vP.x, vP.y) / 6.2831853 + 0.5;
        float dash = step(0.35, fract(a01 * 24.0 - uTime * 0.6));
        float edge = smoothstep(0.72, 0.8, r) * smoothstep(1.0, 0.93, r);
        float inner = exp(-pow((r - 0.86) * 30.0, 2.0));
        float a = (edge * (0.35 + 0.65 * dash) + inner) * (0.35 + 0.6 * uK);
        gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
      }`,
  );
  const ring = new Mesh(rg, rm);
  for (const o of [pillar, ring]) {
    o.frustumCulled = false;
    o.visible = false;
  }
  const W = M.warp;
  return {
    pillar,
    ring,
    set(visible, x, y, z, floor, k, radius = W.pillarRadius, height = W.pillarHeight, time = 0) {
      pillar.visible = visible;
      ring.visible = visible;
      if (!visible) return;
      // 柱は細く始まって太く、移る直前に一番明るい
      const r = radius * (0.4 + 0.6 * k);
      pillar.position.set(x, y, z);
      pillar.scale.set(r, height, r);
      pu.uK.value = k;
      pu.uTime.value = time;
      ring.position.set(x, floor + 2, z);
      const rr = W.ringRadius * (radius / W.pillarRadius) ** 0.5 * (1.6 - 0.6 * k);
      ring.scale.set(rr, 1, rr);
      ru.uK.value = k;
      ru.uTime.value = time;
    },
  };
}
