// 10-7e: ヴォルガスの皮膚（部位をまとめた 1 つのメッシュ）: 6-1 の溶岩のような赤い亀裂（式のノイズ）はそのまま、溝に沈め、まわりに
// にじむ熱を足し、熱線の溜めで尾から頭へ流れる脈で黄白に白熱する（uHeat）。喉の奥が光る（uThroat）・上陸の直後は暗くつやつや（uWet）・
// 縁の光（逆光で強い）・倒れると光が消える（uDead）。画質「中」「高」は起動時に作った絵（textures.ts）を三方向から貼り、鱗の板・しわ・
// 古傷の明るさ・つや・凹凸。「低」は 6-1b の式の鱗（絵なし）。部位を壊すと、その部位の亀裂が消える（uCrackP。頂点の aPart で選ぶ）
import { MeshStandardMaterial, Vector3, type DataTexture } from 'three';
import { KAIJU_MODEL_CONFIG } from '../../data/kaiju-model';
import { VORGAS_VISUAL } from '../../data/vorgas-visual';
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
import { NOISE } from './skin-glsl';

const M = KAIJU_MODEL_CONFIG;
const V = VORGAS_VISUAL;

/** 描画フレームごとに入れる値 */
export interface VorgasLookValues {
  /** 熱線の溜め 0〜1・喉の光 0〜1・濡れ 0〜1・倒れた 0〜1・呼吸のふくらみ m・被弾の光 0〜1 */
  heat: number;
  throat: number;
  wet: number;
  dead: number;
  breath: number;
  flash: number;
  /** 部位ごとの亀裂の明るさ（aPart の順: 胴・頭・腕・脚・尾） */
  readonly crack: number[];
}

export interface VorgasSkin {
  readonly material: MeshStandardMaterial;
  set(look: Readonly<VorgasLookValues>, time: number): void;
  setSun(
    dirWorld: Readonly<Vector3>,
    sun: { r: number; g: number; b: number },
    sky: { r: number; g: number; b: number },
  ): void;
  toView(viewMatrix: { readonly elements: ArrayLike<number> }): void;
  dispose(): void;
}

const RIM = rimGlsl(V.rim, V.colors);
/** 呼吸: 胴の腹（下を向く面）がふくらむ */
const BELLY =
  '(1.0 - step(0.5, aPart)) * smoothstep(0.1, -0.6, normal.y) * smoothstep(42.0, 12.0, abs(position.z + 6.0)) * smoothstep(40.0, 55.0, position.y) * smoothstep(100.0, 85.0, position.y)';

export function createVorgasSkin(tex: DataTexture | null): VorgasSkin {
  const detail = tex !== null;
  const shared = sharedUniforms();
  const sunWorld = new Vector3(0, 1, 0);
  const u = {
    ...shared,
    uFlash: num(0),
    uHeat: num(0),
    uThroat: num(0),
    uWet: num(0),
  };
  const crackP = { value: [1, 1, 1, 1, 1] };
  const texU: U = detail ? { tSkin: { value: tex } } : {};
  const c = M.crack;
  const C = V.crack;
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0.02,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, texU, { uCrackP: crackP });
    vertexPatch(shader, {
      uv: false,
      belly: BELLY,
      extraDecl: 'attribute float aPart;\nuniform float uCrackP[5];\nvarying float vCrackK;',
      extraBody: 'vCrackK = uCrackP[int(aPart + 0.5)];',
    });
    const surface = detail
      ? /* glsl */ `${triplanarGlsl('tSkin', V.skin.tileMeters)}
      // 遠くでは細かい凹凸とむらを弱める（1 画素が鱗の板の大きさに近いとちらつく）
      float kNear = 1.0 - smoothstep(0.1, 0.45, length(fwidth(vRestPos)) * ${f(V.skin.platesPerTile / V.skin.tileMeters)});
      vec4 kS = mix(vec4(0.5, 0.55, 0.5, kTex.a * 0.5), kTex, kNear);
      diffuseColor.rgb *= mix(1.0, 0.45 + kS.r * 0.75, kBody);
      diffuseColor.rgb = mix(diffuseColor.rgb, ${vec(V.colors.scar)} * 0.55, kS.a * 0.55 * kBody);
      float kRough = 0.42 + 0.5 * kS.g;
      float kH = (kS.b - kCrack * ${f(C.groove)}) * ${f(V.skin.bump)} * kBody;`
      : /* glsl */ `
      float kMott = smoothstep(0.3, 0.75, kjNoise(vRestPos * 0.05 + 11.0) * 0.65 + kjNoise(vRestPos * 0.21) * 0.35);
      diffuseColor.rgb = mix(diffuseColor.rgb * 0.7, ${vec(M.colors.mottle)}, kMott * kBody);
      vec3 kScP = vRestPos / ${f(M.scales.cell)};
      float kScFade = 1.0 - smoothstep(0.25, 0.8, length(fwidth(kScP)));
      float kSc = kjScale(kScP) * kScFade;
      diffuseColor.rgb *= 0.7 + 0.45 * kSc * kBody;
      float kRough = 0.78;
      float kH = (kSc * ${f(M.scales.strength * 0.6)} - kCrack * 0.3) * kBody;`;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', common({ ...u, ...texU }, `varying float vCrackK;\n${NOISE}`))
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
      float kBody = 1.0 - step(0.5, vGlow);
      vec3 kp = vRestPos * ${f(c.scale)};
      // 亀裂: 2 つのノイズの 0.5 の等高線の近く（細い網目）。大きな模様で濃淡を付け、ところどころ途切れさせる（6-1）
      float kn = abs(kjNoise(kp) - 0.5) + abs(kjNoise(kp * 2.3 + 7.1) - 0.5) * 0.6;
      float kmask = smoothstep(0.35, 0.6, kjNoise(kp * 0.4 + 3.0));
      float kCrack = (1.0 - smoothstep(0.0, ${f(c.width)}, kn)) * kmask * kBody;
      float kHalo = (1.0 - smoothstep(${f(c.width)}, ${f(c.width + C.halo)}, kn)) * kmask * kBody;
      ${surface}
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.01, 0.0), kCrack);
      // 上陸の直後は暗く（濡れ）
      diffuseColor.rgb *= mix(1.0, ${f(V.wet.darken)}, uWet * kBody);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\nroughnessFactor = clamp(mix(kRough, kRough * ${f(V.wet.gloss)}, uWet * kBody), 0.12, 1.0);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\nfloat kh = kH;\n${BUMP}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
      float kLive = 1.0 - uDead;
      // 熱線の溜め: 尾から頭（−Z）へ流れる脈で、亀裂が橙から黄白へ白熱する
      float kWave = 0.5 + 0.5 * sin(uTime * ${f(C.waveSpeed * Math.PI * 2)} + vRestPos.z * 0.06);
      float kPulse = 0.8 + 0.2 * sin(uTime * ${f(c.pulse * Math.PI * 2)} + vRestPos.y * 0.05);
      vec3 kCol = mix(${vec(M.colors.crack)}, ${vec(V.colors.hot)}, uHeat * (0.35 + 0.65 * kWave));
      float kI = ${f(c.intensity)} * kPulse * (1.0 + ${f(C.heatBoost)} * uHeat * (0.4 + 0.6 * kWave));
      totalEmissiveRadiance += kCol * (kCrack + kHalo * ${f(C.haloStrength)} * (1.0 - 0.5 * uHeat)) * kI * vCrackK * kLive;
      // 目（溜めと喉の光で強く）
      totalEmissiveRadiance += ${vec(M.colors.eye)} * vGlow * ${f(M.eyeIntensity)} * (1.0 + 1.2 * uHeat) * kLive;
      // 喉の奥（口のまわりと首の下側）
      float kTh = smoothstep(20.0, 5.0, length(vRestPos - vec3(0.0, 92.0, -66.0)))
        + 0.6 * smoothstep(9.0, 0.0, abs(vRestPos.x)) * smoothstep(0.2, -0.5, vRestNrm.y) * smoothstep(-20.0, -40.0, vRestPos.z);
      totalEmissiveRadiance += ${vec(V.colors.throat)} * uThroat * kTh * 2.2 * kLive * kBody;
      totalEmissiveRadiance += vec3(uFlash);`,
      )
      .replace('#include <aomap_fragment>', `${RIM}\n#include <aomap_fragment>`);
  };
  material.customProgramCacheKey = () => `vorgas-skin-${detail ? 'd' : 'p'}`;
  return {
    material,
    set(look, time) {
      shared.uTime.value = time;
      shared.uDead.value = look.dead;
      shared.uBreath.value = look.breath;
      u.uHeat.value = look.heat;
      u.uThroat.value = look.throat;
      u.uWet.value = look.wet;
      u.uFlash.value = look.flash * M.flash;
      for (let i = 0; i < 5; i++) crackP.value[i] = look.crack[i] ?? 1;
    },
    setSun(dir, sun, sky) {
      sunWorld.copy(dir).normalize();
      shared.uSunColor.value.setRGB(sun.r, sun.g, sun.b);
      shared.uSkyColor.value.setRGB(sky.r, sky.g, sky.b);
    },
    toView(m) {
      toViewDir(sunWorld, shared.uSunDirV.value, m.elements);
    },
    dispose() {
      material.dispose();
    },
  };
}
