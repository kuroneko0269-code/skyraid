// 10-7d: UFO ゼノリスのマテリアル（10-5a の material.ts を作り直した）: 鏡のような金属（空・水平線・海・日が映り込む。どの画質も）・
// 発光（縁の帯 1・発光体 2〜5・砲口 6・発生器 7〜9・ドーム 10・結晶 11・浮かぶ光の輪 12・下の光の輪 13）・ドームの中の光る核
// （ガラスの奥に浮かぶ光の玉。目から見た線と核の中心の距離で）・瞬間移動で光がほどけて組み上がる（ノイズで欠け、欠けの縁が光る）・
// 被弾の光・縁の光と稲光（共通の kaiju-look/glsl.ts）。
// 画質「中」「高」は上の面の板（周 16 × 輪 4）の一部が見る角度で色が変わる虹色・板の継ぎ目を外へ走る光の筋と、継ぎ目の輪を回る光・
// 下の面の浮かぶ模様（輪ごとに逆へ回る光の点線）。絵は作らない（式だけ）
import { Color, MeshStandardMaterial, Vector3 } from 'three';
import { XENOLITH_MODEL_CONFIG } from '../../data/xenolith-model';
import { XENOLITH_VISUAL, type XenolithTierSpec } from '../../data/xenolith-visual';
import {
  common,
  f,
  num,
  rimGlsl,
  sharedUniforms,
  toViewDir,
  vec,
  vertexPatch,
} from '../kaiju-look/glsl';

const M = XENOLITH_MODEL_CONFIG;
const V = XENOLITH_VISUAL;

/** 描画フレームごとに入れる値 */
export interface XenolithGlow {
  rim: number;
  /** 発光体 4 つ・発生器 3 つの光（壊れると 0） */
  readonly emitters: number[];
  readonly gens: number[];
  cannon: number;
  dome: number;
  flash: number;
  /** 10-7d: 核（0〜）・光の筋の強さ（急加速・攻撃で強い）・浮かぶ光の輪・下の模様・ほどける割合（0〜1）・倒れた（0〜1）・嵐・稲光 */
  core: number;
  trace: number;
  halo: number;
  glyph: number;
  dissolve: number;
  dead: number;
  storm: number;
  lightning: number;
  readonly lightningDir: Vector3;
}

export function createXenolithGlow(): XenolithGlow {
  return {
    rim: 0,
    emitters: [0, 0, 0, 0],
    gens: [0, 0, 0],
    cannon: 0,
    dome: 0,
    flash: 0,
    core: 1,
    trace: 1,
    halo: 1,
    glyph: 1,
    dissolve: 0,
    dead: 0,
    storm: 0,
    lightning: 0,
    lightningDir: new Vector3(0, 1, 0),
  };
}

export interface XenolithMaterial {
  readonly skin: MeshStandardMaterial;
  set(g: Readonly<XenolithGlow>, time: number): void;
  /** 日の向き・色（ワールド）と空の色・水平線の色・海の色 */
  setSky(
    dirWorld: Readonly<Vector3>,
    sun: Readonly<Color>,
    sky: Readonly<Color>,
    horizon: Readonly<Color>,
    sea: Readonly<Color>,
  ): void;
  /** カメラの向き（view 行列）で日・稲光の向きとドームの核の中心を直す（onBeforeRender から）。core はワールドの核の中心 */
  toView(viewMatrix: { readonly elements: ArrayLike<number> }, core: Readonly<Vector3>): void;
  dispose(): void;
}

/** aGlow の番号 n の重み（その番号の頂点だけ 1） */
const w = (n: number): string => `(1.0 - clamp(abs(vGlow - ${n.toFixed(1)}) * 2.0, 0.0, 1.0))`;

const TAU = Math.PI * 2;

/** 画質「中」「高」の上の面の板・光の筋・下の模様（kChromeTint・kSeam を作る / 光を足す） */
function surfaceGlsl(): string {
  const C = V.chrome;
  const L = V.lights;
  const bands = C.bands.map((b) => f(b));
  return /* glsl */ `
    {
      float rr = length(vRestPos.xz);
      float ang = atan(vRestPos.x, -vRestPos.z);
      float a01 = ang / ${f(TAU)} + 0.5;
      float top = smoothstep(0.3, 0.6, vRestNrm.y) * kBody;
      float under = (1.0 - smoothstep(-0.6, -0.3, vRestNrm.y)) * kBody;
      // panels: sectors x bands
      float band = step(${bands[0]}, rr) + step(${bands[1]}, rr) + step(${bands[2]}, rr) + step(${bands[3]}, rr);
      float sec = floor(a01 * ${f(C.sectors)});
      float pid = fract(sin(sec * 12.9898 + band * 78.233) * 43758.5453);
      float onPanel = top * step(0.5, band) * step(band, 3.5);
      // 継ぎ目までの距離（m）: 周の境目（弧の長さ）と輪の境目
      float dSec = abs(fract(a01 * ${f(C.sectors)} + 0.5) - 0.5) / ${f(C.sectors)} * ${f(TAU)} * rr;
      float dBand = min(min(abs(rr - ${bands[0]}), abs(rr - ${bands[1]})), min(abs(rr - ${bands[2]}), abs(rr - ${bands[3]})));
      float seamW = max(fwidth(rr) * 1.5, 0.45);
      kSeam = top * max((1.0 - smoothstep(0.0, seamW, dSec)) * step(${bands[0]}, rr) * step(rr, ${bands[3]} + 2.0), 1.0 - smoothstep(0.0, seamW, dBand));
      kSeam *= step(${f(C.bands[0] - 4)}, rr);
      // 虹色の板（一部の板だけ。見る角度で色が変わる）
      float iri = onPanel * step(0.42, pid);
      vec3 film = kFilm(kNdv * 1.7 + pid * 0.6 + uTime * 0.02);
      kChromeTint = mix(kChromeTint, film * 1.1, iri * ${f(C.iridescence)});
      // 表面を走る光の筋（周の継ぎ目を外へ）と、輪の継ぎ目を回る光
      float lineS = (1.0 - smoothstep(0.0, seamW * 1.2, dSec)) * top * step(${bands[0]}, rr) * step(rr, ${bands[3]} + 3.0);
      float run = fract((rr - uTime * ${f(L.traceSpeed)}) / ${f(L.traceGap)} + pid * 0.37);
      float streak = lineS * smoothstep(0.72, 0.97, run) * (0.4 + 0.6 * step(0.3, pid));
      float lineB = (1.0 - smoothstep(0.0, seamW * 1.2, dBand)) * top;
      float orbit = fract(a01 * 2.0 - uTime * ${f(L.haloHz)} * (mod(band, 2.0) * 2.0 - 1.0));
      float arc = lineB * smoothstep(0.78, 0.98, orbit);
      kLight += ${vec(V.colors.trace)} * (streak * 1.4 + arc) * ${f(L.trace)} * uTrace;
      // 下の面の浮かぶ模様: 輪ごとに逆へ回る光の点線
      float cell = floor(rr / 8.0);
      float inCell = 1.0 - smoothstep(0.6, 1.4, abs(fract(rr / 8.0) - 0.5) * 8.0);
      float dashes = step(0.55, fract(a01 * (10.0 + cell * 4.0) + uTime * ${f(L.glyphHz)} * (mod(cell, 2.0) * 2.0 - 1.0) * (1.0 + cell * 0.2)));
      float glyph = under * inCell * dashes * step(2.5, cell) * step(cell, 8.5);
      kLight += ${vec(V.colors.glyph)} * glyph * ${f(L.glyph)} * uGlyph;
    }`;
}

export function createXenolithMaterial(spec: XenolithTierSpec = V.tiers.low): XenolithMaterial {
  const detail = spec.surfaceDetail;
  const shared = sharedUniforms();
  const sunWorld = new Vector3(0.4, 0.8, 0.3);
  const lightWorld = new Vector3(0, 1, 0);
  const u = {
    ...shared,
    uRim: num(0),
    uE0: num(0),
    uE1: num(0),
    uE2: num(0),
    uE3: num(0),
    uCannon: num(0),
    uG0: num(0),
    uG1: num(0),
    uG2: num(0),
    uDome: num(0),
    uFlash: num(0),
    uCore: num(1),
    uTrace: num(1),
    uHalo: num(1),
    uGlyph: num(1),
    uDissolve: num(0),
    uCoreV: { value: new Vector3() },
    uHorizon: { value: new Color(0.7, 0.75, 0.8) },
    uSea: { value: new Color(V.colors.sea) },
  };
  const skin = new MeshStandardMaterial({
    vertexColors: true,
    roughness: V.chrome.roughness,
    metalness: 1,
  });
  skin.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    vertexPatch(shader, { uv: false, belly: '0.0' });
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        common(
          u,
          /* glsl */ `
          // 虹色の膜（桃 → 紫 → 青 → 水色。黄は出さない）
          vec3 kFilm(float t) {
            return vec3(0.6, 0.6, 0.8) + vec3(0.4, 0.4, 0.2) * cos(6.2831853 * (vec3(t) + vec3(0.0, 0.25, 0.5)));
          }
          float kHash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
          float kNoise3(vec3 p) {
            vec3 i = floor(p); vec3 fr = fract(p); fr = fr * fr * (3.0 - 2.0 * fr);
            return mix(mix(mix(kHash3(i), kHash3(i + vec3(1,0,0)), fr.x), mix(kHash3(i + vec3(0,1,0)), kHash3(i + vec3(1,1,0)), fr.x), fr.y),
              mix(mix(kHash3(i + vec3(0,0,1)), kHash3(i + vec3(1,0,1)), fr.x), mix(kHash3(i + vec3(0,1,1)), kHash3(i + vec3(1,1,1)), fr.x), fr.y), fr.z);
          }`,
        ),
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float kBody = 1.0 - step(0.5, vGlow);
        // 瞬間移動: 光がほどける（ノイズの低い所から欠ける。欠けの縁が光る）
        float kDis = kNoise3(vRestPos * 0.09) * 0.7 + kNoise3(vRestPos * 0.31) * 0.3;
        if (kDis < uDissolve * 1.05) discard;
        float kEdge = uDissolve > 0.001 ? 1.0 - smoothstep(0.0, 0.07, kDis - uDissolve * 1.05) : 0.0;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        float kSeam = 0.0;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        float kLive = 1.0 - uDead;
        vec3 kVdir = normalize(vViewPosition);
        float kNdv = saturate(dot(normal, kVdir));
        vec3 kChromeTint = diffuseColor.rgb;
        vec3 kLight = vec3(0.0);
        ${detail ? surfaceGlsl() : ''}
        // 鏡の金属: 映り込み（空・水平線・海・日）にフレネルを掛ける
        {
          vec3 rv = reflect(-kVdir, normal);
          vec3 rw = inverseTransformDirection(rv, viewMatrix);
          vec3 skyN = uSkyColor / max(1.0, max(uSkyColor.r, max(uSkyColor.g, uSkyColor.b)));
          vec3 sunN = uSunColor / max(1.0, max(uSunColor.r, max(uSunColor.g, uSunColor.b)));
          float up = rw.y;
          vec3 sky = mix(uHorizon * 0.95, skyN * 0.8, smoothstep(0.02, 0.5, up));
          vec3 sea = mix(uHorizon * 0.4, uSea, 1.0 - smoothstep(-0.3, 0.0, up));
          vec3 env = mix(sea, sky, smoothstep(-0.02, 0.02, up));
          env += uHorizon * 0.45 * exp(-abs(up) * 45.0);
          float sd = saturate(dot(rv, uSunDirV));
          env += sunN * (pow(sd, 700.0) * 14.0 + pow(sd, 40.0) * 0.35);
          vec3 F0 = kChromeTint;
          vec3 fres = F0 + (1.0 - F0) * pow(1.0 - kNdv, 5.0);
          float glass = ${w(10)};
          float crystal = ${w(11)};
          float reflK = kBody * (1.0 - kSeam * 0.55) + glass * 0.6 + crystal;
          totalEmissiveRadiance += env * fres * reflK * ${f(V.chrome.reflect)} * (1.0 - 0.75 * uDead);
          if (crystal > 0.0) {
            vec3 film = kFilm(kNdv * 2.2 + uTime * 0.05);
            totalEmissiveRadiance += film * crystal * (0.25 + 0.6 * pow(1.0 - kNdv, 2.0)) * kLive;
          }
        }
        // ドームの中の光る核（目から見た線と核の中心の距離）と、ガラスの縁の光
        {
          vec3 dirV = normalize(-vViewPosition);
          float tC = max(dot(uCoreV, dirV), 0.0);
          float dist = length(uCoreV - dirV * tC);
          float pulse = 0.82 + 0.18 * sin(uTime * ${f(V.lights.coreHz * TAU)});
          float k = exp(-pow(dist / (${f(V.lights.coreSize)} * pulse), 2.0));
          float halo = exp(-pow(dist / ${f(V.lights.coreSize * 2.4)}, 2.0));
          float glass = ${w(10)};
          totalEmissiveRadiance += (${vec(V.colors.core)} * k * 1.6 + ${vec(V.colors.coreEdge)} * halo * 0.5) * uCore * glass;
          totalEmissiveRadiance += ${vec(M.colors.dome)} * glass * uDome * (0.25 + pow(1.0 - kNdv, 2.5) * 1.2);
        }
        totalEmissiveRadiance += kLight * kLive;
        totalEmissiveRadiance += ${vec(M.colors.rim)} * uRim * ${w(1)}
          + ${vec(M.colors.emitter)} * (uE0 * ${w(2)} + uE1 * ${w(3)} + uE2 * ${w(4)} + uE3 * ${w(5)})
          + ${vec(M.colors.cannon)} * uCannon * ${w(6)}
          + ${vec(M.colors.gen)} * (uG0 * ${w(7)} + uG1 * ${w(8)} + uG2 * ${w(9)})
          + ${vec(V.colors.halo)} * uHalo * ${w(12)} * (0.55 + 0.45 * smoothstep(0.6, 1.0, fract(atan(vRestPos.x, -vRestPos.z) / ${f(TAU)} * 6.0 - uTime * 0.9))) * kLive
          + ${vec(V.colors.glyph)} * uGlyph * ${w(13)} * (0.6 + 0.4 * sin(uTime * 3.0 + length(vRestPos.xz) * 0.3)) * kLive
          + ${vec(V.colors.warpEdge)} * kEdge * 5.0
          + vec3(uFlash);`,
      )
      .replace(
        '#include <aomap_fragment>',
        `${rimGlsl(V.rim, { rim: V.colors.halo, lightning: 0xdde6ff })}\n#include <aomap_fragment>`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        // 継ぎ目は少しざらつかせる（日の照り返しが板ごとに分かれる）
        `material.roughness = clamp(mix(material.roughness, ${f(V.chrome.seamRoughness)}, kSeam), 0.0525, 1.0);\n#include <lights_fragment_begin>`,
      );
  };
  skin.customProgramCacheKey = () => `xenolith-chrome-${detail ? 'd' : 'p'}`;
  return {
    skin,
    set(g, time) {
      u.uRim.value = g.rim;
      u.uE0.value = g.emitters[0] ?? 0;
      u.uE1.value = g.emitters[1] ?? 0;
      u.uE2.value = g.emitters[2] ?? 0;
      u.uE3.value = g.emitters[3] ?? 0;
      u.uCannon.value = g.cannon;
      u.uG0.value = g.gens[0] ?? 0;
      u.uG1.value = g.gens[1] ?? 0;
      u.uG2.value = g.gens[2] ?? 0;
      u.uDome.value = g.dome;
      u.uFlash.value = g.flash * 0.5;
      u.uCore.value = g.core * V.lights.core;
      u.uTrace.value = g.trace;
      u.uHalo.value = g.halo * V.lights.halo;
      u.uGlyph.value = g.glyph;
      u.uDissolve.value = g.dissolve;
      shared.uTime.value = time;
      shared.uStorm.value = g.storm;
      shared.uDead.value = g.dead;
      shared.uLightning.value = g.lightning;
      lightWorld.copy(g.lightningDir);
    },
    setSky(dir, sun, sky, horizon, sea) {
      sunWorld.copy(dir).normalize();
      shared.uSunColor.value.copy(sun);
      shared.uSkyColor.value.copy(sky);
      u.uHorizon.value.copy(horizon);
      u.uSea.value.copy(sea);
    },
    toView(m, core) {
      toViewDir(sunWorld, shared.uSunDirV.value, m.elements);
      toViewDir(lightWorld, shared.uLightDirV.value, m.elements);
      const e = m.elements;
      const c = u.uCoreV.value;
      c.set(
        (e[0] ?? 0) * core.x + (e[4] ?? 0) * core.y + (e[8] ?? 0) * core.z + (e[12] ?? 0),
        (e[1] ?? 0) * core.x + (e[5] ?? 0) * core.y + (e[9] ?? 0) * core.z + (e[13] ?? 0),
        (e[2] ?? 0) * core.x + (e[6] ?? 0) * core.y + (e[10] ?? 0) * core.z + (e[14] ?? 0),
      );
    },
    dispose() {
      skin.dispose();
    },
  };
}
