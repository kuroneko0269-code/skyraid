// 10-4a: メカ怪獣ゴウライのマテリアル: 金属の PBR（色は頂点の色）に発光を足す。核（aGlow 1）は閉じている間は暗く、開くと明るい水色。
// 排気口（2・3）は熱に合わせて橙に明るく（壊れると消える）、ハッチ（4）は一斉発射の予兆で赤く点滅、機銃（5）は回転掃射で赤く、
// 推進器（6）と目（7）はいつも光る。被弾で白く光る。
// 10-7c: 共通の部品（kaiju-look/glsl.ts）で、どの画質も縁の光・稲光の照り返し・目の光（予兆で赤へ・登場の前は暗い）・放熱の格子（8）・
// 口の中（9）・前の装甲の口の切れ目の熾火（10）・登場の水の濡れ（体の下ほど暗くつやつや）。画質「中」「高」は起動時に作った金属の板の絵（textures.ts）で板の継ぎ目・
// リベット・傷（むき出しの金属）・焦げ・汚れの垂れのむら・つや・凹凸（三方向から貼る）と、継ぎ目から漏れる熱の光（熱が高いほど・
// 放熱で強く。後ろと核の周りほど）・排気口の筒が赤く焼ける・後ろの煤
import { Color, MeshStandardMaterial, Vector3, type DataTexture } from 'three';
import { GOURAI_MODEL_CONFIG } from '../../data/gourai-model';
import { GOURAI_VISUAL, type GouraiTierSpec } from '../../data/gourai-visual';
import {
  BUMP,
  common,
  f,
  num,
  rimGlsl,
  sharedUniforms,
  toViewDir,
  triplanarGlsl,
  vec,
  vertexPatch,
  type U,
} from '../kaiju-look/glsl';

const M = GOURAI_MODEL_CONFIG;
const V = GOURAI_VISUAL;

/** 描画フレームごとに入れる値 */
export interface GouraiGlow {
  core: number;
  exhaustL: number;
  exhaustR: number;
  hatch: number;
  gun: number;
  flash: number;
  /** 10-7c: 目（0〜）と怒り（0〜1。赤へ）・熱（0〜1）・放熱（0〜1。継ぎ目と格子）・口の中（0〜1）・濡れ（0〜1。登場） */
  eye: number;
  anger: number;
  heat: number;
  vent: number;
  mouth: number;
  /** 前の装甲の口の切れ目の熾火（0〜） */
  slit: number;
  wet: number;
  /** 嵐 0〜1・倒れた 0〜1・稲光の明るさと向き（ワールド） */
  storm: number;
  dead: number;
  lightning: number;
  readonly lightningDir: Vector3;
}

export function createGouraiGlow(): GouraiGlow {
  return {
    core: M.glow.coreClosed,
    exhaustL: M.glow.exhaustMin,
    exhaustR: M.glow.exhaustMin,
    hatch: 0,
    gun: 0,
    flash: 0,
    eye: 1,
    anger: 0,
    heat: 0,
    vent: 0,
    mouth: 0,
    slit: 0.4,
    wet: 0,
    storm: 0,
    dead: 0,
    lightning: 0,
    lightningDir: new Vector3(0, 1, 0),
  };
}

export interface GouraiMaterial {
  readonly skin: MeshStandardMaterial;
  set(g: Readonly<GouraiGlow>, time?: number): void;
  /** 日の向き・色（ワールド）と空の色 */
  setSun(dirWorld: Readonly<Vector3>, sun: Readonly<Color>, sky: Readonly<Color>): void;
  /** カメラの向き（view 行列）で日・稲光の向きを直す（onBeforeRender から） */
  toView(viewMatrix: { readonly elements: ArrayLike<number> }): void;
  dispose(): void;
}

/** aGlow の番号 n の重み（その番号の頂点だけ 1） */
const w = (n: number): string => `(1.0 - clamp(abs(vGlow - ${n.toFixed(1)}) * 2.0, 0.0, 1.0))`;

const LOW_SPEC: GouraiTierSpec = V.tiers.low;

export function createGouraiMaterial(
  spec: GouraiTierSpec = LOW_SPEC,
  tex: DataTexture | null = null,
): GouraiMaterial {
  const detail = tex !== null && spec.surfaceDetail;
  const shared = sharedUniforms();
  const sunWorld = new Vector3(0.4, 0.8, 0.3);
  const lightWorld = new Vector3(0, 1, 0);
  const u = {
    ...shared,
    uCore: num(M.glow.coreClosed),
    uExhaustL: num(M.glow.exhaustMin),
    uExhaustR: num(M.glow.exhaustMin),
    uHatch: num(0),
    uGun: num(0),
    uFlash: num(0),
    uEye: num(1),
    uAnger: num(0),
    uHeat: num(0),
    uVent: num(0),
    uMouth: num(0),
    uSlit: num(0.4),
    uWet: num(0),
  };
  const texU: U = detail ? { tPlate: { value: tex } } : {};
  const skin = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.5,
    flatShading: false,
  });
  skin.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, texU);
    vertexPatch(shader, { uv: false, belly: '0.0' });
    const sample = detail
      ? `${triplanarGlsl('tPlate', V.plate.tileMeters)}
      // 遠くでは細かい凹凸と継ぎ目を弱める（ちらつかないように）
      float kNear = 1.0 - smoothstep(0.08, 0.45, length(fwidth(vRestPos)) * ${f(8 / V.plate.tileMeters)});
      kTex = mix(vec4(0.55 + (kTex.r - 0.55) * 0.5, 0.5, 0.6, 0.0), kTex, kNear);`
      : 'vec4 kTex = vec4(0.6, 0.5, 0.6, 0.0);';
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', common({ ...u, ...texU }, ''))
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float kBody = 1.0 - step(0.5, vGlow);
        ${sample}
        // 後ろ（排気口のまわり）の煤と、核の部屋のまわりの焦げ
        float kSoot = smoothstep(62.0, 96.0, vRestPos.z) * (0.6 + 0.4 * kTex.r)
          + smoothstep(-48.0, -66.0, vRestPos.z) * smoothstep(26.0, 6.0, abs(vRestPos.x)) * smoothstep(24.0, 4.0, vRestPos.y) * 0.5;
        // むら・汚れ・焦げ・傷（むき出しの金属は明るい）
        diffuseColor.rgb *= mix(1.0, 0.72 + kTex.r * 0.5, kBody);
        diffuseColor.rgb = mix(diffuseColor.rgb, ${vec(V.colors.rust)}, smoothstep(0.36, 0.22, kTex.r) * 0.3 * kBody);
        diffuseColor.rgb = mix(diffuseColor.rgb, ${vec(V.colors.bare)}, smoothstep(0.78, 0.9, kTex.r) * 0.6 * kBody);
        diffuseColor.rgb = mix(diffuseColor.rgb, ${vec(V.colors.scorch)}, clamp(kSoot, 0.0, 1.0) * 0.55 * kBody);
        // 登場の濡れ（体の下ほど暗い）
        float kWet = uWet * smoothstep(30.0, -30.0, vRestPos.y);
        diffuseColor.rgb *= 1.0 - kWet * 0.35;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\nroughnessFactor = clamp(mix(roughnessFactor, 0.28 + kTex.g * 0.7 + kSoot * 0.25, kBody), 0.18, 1.0);\nroughnessFactor = mix(roughnessFactor, 0.12, kWet);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, clamp(0.35 + (kTex.r - 0.55) * 0.6 - kSoot * 0.25, 0.1, 0.75), kBody);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\n${detail ? `float kh = (kTex.b - 0.6) * ${f(V.plate.bump)} * kBody;\n${BUMP}` : ''}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        float kLive = 1.0 - uDead;
        vec3 eyeC = mix(${vec(V.colors.eye)}, ${vec(V.colors.eyeAngry)}, uAnger);
        totalEmissiveRadiance += ${vec(M.colors.core)} * uCore * ${w(1)}
          + ${vec(M.colors.exhaust)} * (uExhaustL * ${w(2)} + uExhaustR * ${w(3)})
          + ${vec(M.colors.hatch)} * uHatch * ${w(4)}
          + ${vec(M.colors.gun)} * uGun * ${w(5)}
          + ${vec(M.colors.hover)} * ${f(M.glow.hover)} * ${w(6)} * kLive
          + eyeC * uEye * ${w(7)}
          + ${vec(V.colors.grill)} * (uVent * ${f(V.heat.grill)} + uHeat * 0.4) * ${w(8)} * (0.8 + 0.2 * sin(uTime * 7.0 + vRestPos.z))
          + ${vec(V.colors.mouth)} * uMouth * ${f(V.heat.mouth)} * ${w(9)}
          + ${vec(V.colors.mouth)} * uSlit * (0.85 + 0.15 * sin(uTime * 2.3 + vRestPos.x * 0.2)) * ${w(10)} * kLive
          + vec3(uFlash);
        ${
          detail
            ? `// 継ぎ目から漏れる熱（後ろ・核の部屋のまわり・背ほど強い。ゆっくり脈打つ）
        {
          float region = 0.35 + smoothstep(10.0, 80.0, vRestPos.z) * 0.65 + smoothstep(-40.0, -64.0, vRestPos.z) * 0.8
            + smoothstep(18.0, 30.0, vRestPos.y) * 0.3;
          float pulse = 0.75 + 0.25 * sin(uTime * ${f(V.heat.pulseHz * Math.PI * 2)} - vRestPos.z * 0.05);
          float leak = kTex.a * kBody * region * pulse * (smoothstep(0.55, 1.0, uHeat) * ${f(V.heat.seam)} + uVent * ${f(V.heat.seamVent)});
          totalEmissiveRadiance += ${vec(V.colors.seamHeat)} * leak * kLive;
        }`
            : ''
        }
        // 排気口の筒が熱で赤く焼ける（後ろの端ほど）
        {
          float nz = smoothstep(80.0, 97.0, vRestPos.z) * smoothstep(17.0, 9.0, abs(abs(vRestPos.x) - 24.0)) * kBody;
          float ex = vRestPos.x < 0.0 ? uExhaustL : uExhaustR;
          totalEmissiveRadiance += ${vec(V.colors.seamHeat)} * nz * ex * ${f(V.heat.nozzle / M.glow.exhaustMax)} * (0.3 + 0.7 * uHeat) * kLive;
        }`,
      )
      .replace(
        '#include <aomap_fragment>',
        /* glsl */ `${rimGlsl(V.rim, V.colors)}
        {
          // 影の側の金属が真っ黒にならないよう、空の光を少し
          vec3 skyT = uSkyColor / max(1.0, max(uSkyColor.r, max(uSkyColor.g, uSkyColor.b)));
          float ndl = dot(normal, uSunDirV);
          totalEmissiveRadiance += skyT * 0.05 * (1.0 - saturate(ndl)) * diffuseColor.rgb;
        }
        #include <aomap_fragment>`,
      );
  };
  skin.customProgramCacheKey = () => `gourai-skin-${detail ? 'd' : 'p'}`;
  return {
    skin,
    set(g, time = 0) {
      u.uCore.value = g.core;
      u.uExhaustL.value = g.exhaustL;
      u.uExhaustR.value = g.exhaustR;
      u.uHatch.value = g.hatch;
      u.uGun.value = g.gun;
      u.uFlash.value = g.flash * 0.5;
      u.uEye.value = g.eye;
      u.uAnger.value = g.anger;
      u.uHeat.value = g.heat;
      u.uVent.value = g.vent;
      u.uMouth.value = g.mouth;
      u.uSlit.value = g.slit;
      u.uWet.value = g.wet;
      shared.uTime.value = time;
      shared.uStorm.value = g.storm;
      shared.uDead.value = g.dead;
      shared.uLightning.value = g.lightning;
      lightWorld.copy(g.lightningDir);
    },
    setSun(dir, sun, sky) {
      sunWorld.copy(dir).normalize();
      shared.uSunColor.value.copy(sun);
      shared.uSkyColor.value.copy(sky);
    },
    toView(m) {
      toViewDir(sunWorld, shared.uSunDirV.value, m.elements);
      toViewDir(lightWorld, shared.uLightDirV.value, m.elements);
    },
    dispose() {
      skin.dispose();
    },
  };
}
