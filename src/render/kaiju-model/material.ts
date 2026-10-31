// 怪獣のマテリアル（6-1）: PBR の皮膚（色は頂点の色。黒〜深緑）に、溶岩のような赤い亀裂を静止姿勢の位置の
// 手続きノイズで描いて発光させる（ブルームに乗る）。目（aGlow = 1）も発光。結晶は熱線の前に明るくなる。
// 6-1b: 皮膚に鱗の凹凸（法線。セルノイズの高さを画面の微分で法線に）と深緑〜黒のむら。結晶は半透明の
// MeshPhysicalMaterial（反射・クリアコート）で、正面を向く面と根元ほど強く光る（内側が光って見える）
import {
  Color,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { KAIJU_MODEL_CONFIG } from '../../data/kaiju-model';

/** 皮膚 1 枚分の uniform（部位のメッシュごとに持つ。被弾の光・部位破壊で亀裂が消える） */
export interface SkinUniforms {
  readonly uTime: { value: number };
  readonly uFlash: { value: number };
  /** 亀裂の明るさの倍率（部位破壊で下げる） */
  readonly uCrack: { value: number };
}

const M = KAIJU_MODEL_CONFIG;

const NOISE = /* glsl */ `
float kjHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float kjNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(kjHash(i), kjHash(i + vec3(1, 0, 0)), f.x),
        mix(kjHash(i + vec3(0, 1, 0)), kjHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(kjHash(i + vec3(0, 0, 1)), kjHash(i + vec3(1, 0, 1)), f.x),
        mix(kjHash(i + vec3(0, 1, 1)), kjHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// 鱗: 3D のセルノイズ（最も近い点までの距離 F1 と 2 番目 F2）。F2 − F1 が小さい所が鱗の境目の溝
float kjScale(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(kjHash(i + g), kjHash(i + g + 17.3), kjHash(i + g + 41.9));
    float dd = length(g + o - f);
    if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) { f2 = dd; }
  }
  // 鱗の中央が盛り上がり、境目で落ちる
  return smoothstep(0.0, 0.35, f2 - f1) * (1.0 - 0.5 * f1);
}
`;

function patchSkin(shader: WebGLProgramParametersWithUniforms, u: SkinUniforms): void {
  Object.assign(shader.uniforms, u);
  const crack = new Color(M.colors.crack);
  const eye = new Color(M.colors.eye);
  const mottle = new Color(M.colors.mottle);
  const c = M.crack;
  const sc = M.scales;
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      '#include <common>\nattribute vec3 aRest;\nattribute float aGlow;\nvarying vec3 vRest;\nvarying float vGlow;',
    )
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = aRest;\nvGlow = aGlow;');
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>\nvarying vec3 vRest;\nvarying float vGlow;\nuniform float uTime;\nuniform float uFlash;\nuniform float uCrack;\n${NOISE}`,
    )
    .replace(
      '#include <color_fragment>',
      /* glsl */ `#include <color_fragment>
      vec3 kp = vRest * ${c.scale.toFixed(4)};
      // 亀裂: 2 つのノイズの 0.5 の等高線の近く（細い網目）。大きな模様で濃淡を付け、ところどころ途切れさせる
      float kn = abs(kjNoise(kp) - 0.5) + abs(kjNoise(kp * 2.3 + 7.1) - 0.5) * 0.6;
      float kmask = smoothstep(0.35, 0.6, kjNoise(kp * 0.4 + 3.0));
      float kCrack = (1.0 - smoothstep(0.0, ${c.width.toFixed(4)}, kn)) * kmask;
      // 6-1b: 深緑〜黒のむら（大小 2 つのノイズ）と、鱗ごとの明るさの違い
      float kMott = smoothstep(0.3, 0.75, kjNoise(vRest * 0.05 + 11.0) * 0.65 + kjNoise(vRest * 0.21) * 0.35);
      diffuseColor.rgb = mix(diffuseColor.rgb * 0.7, vec3(${mottle.r.toFixed(4)}, ${mottle.g.toFixed(4)}, ${mottle.b.toFixed(4)}), kMott * (1.0 - vGlow));
      // 鱗が画面の 1 画素より細かくなる距離では消す（遠くでちらつかない）
      vec3 kScP = vRest / ${sc.cell.toFixed(3)};
      float kScFade = 1.0 - smoothstep(0.25, 0.8, length(fwidth(kScP)));
      float kSc = kjScale(kScP) * kScFade;
      diffuseColor.rgb *= 0.7 + 0.45 * kSc * (1.0 - vGlow);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.01, 0.0), kCrack);`,
    )
    .replace(
      '#include <normal_fragment_maps>',
      /* glsl */ `#include <normal_fragment_maps>
      // 鱗の凹凸: 高さ kSc の画面上の微分から法線を傾ける（bump map と同じ考え方。目は平らのまま）
      {
        vec3 kdx = dFdx(-vViewPosition);
        vec3 kdy = dFdy(-vViewPosition);
        float khx = dFdx(kSc);
        float khy = dFdy(kSc);
        vec3 kr1 = cross(kdy, normal);
        vec3 kr2 = cross(normal, kdx);
        float kdet = dot(kdx, kr1);
        vec3 kgrad = sign(kdet) * (khx * kr1 + khy * kr2);
        normal = normalize(abs(kdet) * normal - kgrad * ${sc.strength.toFixed(3)} * (1.0 - vGlow));
      }`,
    )
    .replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `#include <emissivemap_fragment>
      float kPulse = 0.8 + 0.2 * sin(uTime * ${(c.pulse * Math.PI * 2).toFixed(4)} + vRest.y * 0.05);
      totalEmissiveRadiance += vec3(${crack.r.toFixed(4)}, ${crack.g.toFixed(4)}, ${crack.b.toFixed(4)})
        * kCrack * ${c.intensity.toFixed(3)} * kPulse * uCrack * (1.0 - vGlow);
      totalEmissiveRadiance += vec3(${eye.r.toFixed(4)}, ${eye.g.toFixed(4)}, ${eye.b.toFixed(4)})
        * vGlow * ${M.eyeIntensity.toFixed(3)};
      totalEmissiveRadiance += vec3(uFlash);`,
    );
}

export function createSkinUniforms(): SkinUniforms {
  return { uTime: { value: 0 }, uFlash: { value: 0 }, uCrack: { value: 1 } };
}

/** 皮膚のマテリアル（SkinnedMesh 用） */
export function createSkinMaterial(u: SkinUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0.02,
  });
  material.onBeforeCompile = (shader) => {
    patchSkin(shader, u);
  };
  material.customProgramCacheKey = () => 'kaiju-skin';
  return material;
}

/**
 * 結晶（6-1b）: 半透明の青い結晶。屈折率・クリアコートの反射で硬い面を出し（transmission は使わない）、
 * 発光は「正面を向く面ほど・根元（aGlow）ほど強い」= 縁が暗く芯が光る。明るさは setCrystalGlow で毎フレーム
 */
export function createCrystalMaterial(): MeshPhysicalMaterial {
  const look = M.crystalLook;
  const material = new MeshPhysicalMaterial({
    vertexColors: true,
    roughness: look.roughness,
    metalness: 0,
    ior: look.ior,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    transparent: true,
    opacity: look.opacity,
    emissive: new Color(M.colors.crystalGlow),
    emissiveIntensity: M.crystal.idle,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aGlow;\nvarying float vCore;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCore = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCore;')
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        float kFacing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
        float kInner = ${look.edge.toFixed(3)} + pow(kFacing, ${look.innerPower.toFixed(3)}) * vCore;
        totalEmissiveRadiance *= kInner;`,
      );
  };
  material.customProgramCacheKey = () => 'kaiju-crystal';
  return material;
}

/** 結晶の明るさ（glow 0.15 が常時、1 が熱線の直前。壊れていれば暗く） */
export function setCrystalGlow(m: MeshStandardMaterial, glow: number, broken: boolean): void {
  const c = M.crystal;
  const k = Math.max(0, (glow - 0.15) / 0.85);
  m.emissiveIntensity = (c.idle + (c.max - c.idle) * k) * (broken ? c.brokenScale : 1);
}
