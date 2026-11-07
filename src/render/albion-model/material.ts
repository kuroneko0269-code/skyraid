// 10-3a: 白鯨アルビオンのマテリアル: PBR（色は頂点の色）に発光を足す。目（aGlow 1）は淡い青、噴気孔（2）は潮吹きの予兆で白く、
// 腹の巣（3・4・5）は赤くゆっくり脈打つ（壊れた巣は光が消えて黒ずむ）。被弾で白く光る
import { Color, MeshStandardMaterial } from 'three';
import { ALBION_MODEL_CONFIG } from '../../data/albion-model';

const M = ALBION_MODEL_CONFIG;

export interface AlbionMaterial {
  readonly skin: MeshStandardMaterial;
  /** spout: 噴気孔 0〜1、nests: 巣ごとの光 0〜1、eye: 目 0〜1（頭が壊れると暗い）、flash: 被弾 0〜1 */
  set(spout: number, nests: readonly number[], eye: number, flash: number): void;
}

const vec = (hex: number): string => {
  const c = new Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};

export function createAlbionMaterial(): AlbionMaterial {
  const u = {
    uSpout: { value: 0 },
    uNest0: { value: 1 },
    uNest1: { value: 1 },
    uNest2: { value: 1 },
    uEye: { value: 1 },
    uFlash: { value: 0 },
  };
  const skin = new MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
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
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float nb = (1.0 - clamp(abs(vGlow - 3.0) * 2.0, 0.0, 1.0)) * (1.0 - step(0.01, uNest0))
          + (1.0 - clamp(abs(vGlow - 4.0) * 2.0, 0.0, 1.0)) * (1.0 - step(0.01, uNest1))
          + (1.0 - clamp(abs(vGlow - 5.0) * 2.0, 0.0, 1.0)) * (1.0 - step(0.01, uNest2));
        diffuseColor.rgb = mix(diffuseColor.rgb, ${vec(M.colors.nestDark)}, clamp(nb, 0.0, 1.0));`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        float wEye = 1.0 - clamp(abs(vGlow - 1.0) * 2.0, 0.0, 1.0);
        float wHole = 1.0 - clamp(abs(vGlow - 2.0) * 2.0, 0.0, 1.0);
        float wNest = (1.0 - clamp(abs(vGlow - 3.0) * 2.0, 0.0, 1.0)) * uNest0
          + (1.0 - clamp(abs(vGlow - 4.0) * 2.0, 0.0, 1.0)) * uNest1
          + (1.0 - clamp(abs(vGlow - 5.0) * 2.0, 0.0, 1.0)) * uNest2;
        totalEmissiveRadiance += ${vec(M.colors.eye)} * ${M.glow.eye.toFixed(2)} * uEye * wEye
          + ${vec(M.colors.spout)} * uSpout * wHole
          + ${vec(M.colors.nest)} * wNest
          + vec3(uFlash);`,
      );
  };
  skin.customProgramCacheKey = () => 'albion-skin';
  return {
    skin,
    set(spout, nests, eye, flash) {
      u.uSpout.value = spout * M.glow.blowholeMax;
      u.uNest0.value = nests[0] ?? 0;
      u.uNest1.value = nests[1] ?? 0;
      u.uNest2.value = nests[2] ?? 0;
      u.uEye.value = eye;
      u.uFlash.value = flash * 0.6;
    },
  };
}
