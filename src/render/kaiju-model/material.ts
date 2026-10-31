// 怪獣のマテリアル（6-1）: PBR の皮膚（色は頂点の色。黒〜深緑）に、溶岩のような赤い亀裂を静止姿勢の位置の
// 手続きノイズで描いて発光させる（ブルームに乗る）。目（aGlow = 1）も発光。結晶の棘は青白い発光で、熱線の前に明るくなる
import { Color, MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from 'three';
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
`;

function patchSkin(shader: WebGLProgramParametersWithUniforms, u: SkinUniforms): void {
  Object.assign(shader.uniforms, u);
  const crack = new Color(M.colors.crack);
  const eye = new Color(M.colors.eye);
  const c = M.crack;
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
      // 皮膚のむら（鱗の起伏の代わり）
      diffuseColor.rgb *= 0.75 + 0.5 * kjNoise(vRest * 0.35);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.01, 0.0), kCrack);`,
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

/** 結晶の棘: 青白い発光。明るさは setCrystalGlow で毎フレーム */
export function createCrystalMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.18,
    metalness: 0.05,
    emissive: new Color(M.colors.crystalGlow),
    emissiveIntensity: M.crystal.idle,
  });
}

/** 結晶の明るさ（glow 0.15 が常時、1 が熱線の直前。壊れていれば暗く） */
export function setCrystalGlow(m: MeshStandardMaterial, glow: number, broken: boolean): void {
  const c = M.crystal;
  const k = Math.max(0, (glow - 0.15) / 0.85);
  m.emissiveIntensity = (c.idle + (c.max - c.idle) * k) * (broken ? c.brokenScale : 1);
}
