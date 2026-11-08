// 10-5a: UFO ゼノリスのマテリアル: 銀の金属の PBR（色は頂点の色）に発光を足す。縁の帯（aGlow 1）はいつも水色に光り、バリアの揺らぎで
// 点滅する。発光体（2〜5）は白く、壊れると消える。砲口（6）は溜め撃ちで橙に明るく、発生器（7〜9）は青く（壊れると消える）、
// ドーム（10）は薄紫。被弾で白く光る
import { Color, MeshStandardMaterial } from 'three';
import { XENOLITH_MODEL_CONFIG } from '../../data/xenolith-model';

const M = XENOLITH_MODEL_CONFIG;

export interface XenolithGlow {
  rim: number;
  /** 発光体 4 つ・発生器 3 つの光（壊れると 0） */
  readonly emitters: number[];
  readonly gens: number[];
  cannon: number;
  dome: number;
  flash: number;
}

export interface XenolithMaterial {
  readonly skin: MeshStandardMaterial;
  set(g: Readonly<XenolithGlow>): void;
}

const vec = (hex: number): string => {
  const c = new Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};

/** aGlow の番号 n の重み（その番号の頂点だけ 1） */
const w = (n: number): string => `(1.0 - clamp(abs(vGlow - ${n.toFixed(1)}) * 2.0, 0.0, 1.0))`;

export function createXenolithMaterial(): XenolithMaterial {
  const u = {
    uRim: { value: 0 },
    uE0: { value: 0 },
    uE1: { value: 0 },
    uE2: { value: 0 },
    uE3: { value: 0 },
    uCannon: { value: 0 },
    uG0: { value: 0 },
    uG1: { value: 0 },
    uG2: { value: 0 },
    uDome: { value: 0 },
    uFlash: { value: 0 },
  };
  const skin = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.28,
    metalness: 0.85,
  });
  skin.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    const decl = Object.keys(u)
      .map((k) => `uniform float ${k};`)
      .join('\n');
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aGlow;\nvarying float vGlow;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vGlow;\n${decl}`)
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        totalEmissiveRadiance += ${vec(M.colors.rim)} * uRim * ${w(1)}
          + ${vec(M.colors.emitter)} * (uE0 * ${w(2)} + uE1 * ${w(3)} + uE2 * ${w(4)} + uE3 * ${w(5)})
          + ${vec(M.colors.cannon)} * uCannon * ${w(6)}
          + ${vec(M.colors.gen)} * (uG0 * ${w(7)} + uG1 * ${w(8)} + uG2 * ${w(9)})
          + ${vec(M.colors.dome)} * uDome * ${w(10)}
          + vec3(uFlash);`,
      );
  };
  skin.customProgramCacheKey = () => 'xenolith-skin';
  return {
    skin,
    set(g) {
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
    },
  };
}
