// 10-4a: メカ怪獣ゴウライのマテリアル: 金属の PBR（色は頂点の色）に発光を足す。核（aGlow 1）は閉じている間は暗く、開くと明るい水色。
// 排気口（2・3）は熱に合わせて橙に明るく（壊れると消える）、ハッチ（4）は一斉発射の予兆で赤く点滅、機銃（5）は回転掃射で赤く、
// 推進器（6）と目の帯（7）はいつも光る。被弾で白く光る
import { Color, MeshStandardMaterial } from 'three';
import { GOURAI_MODEL_CONFIG } from '../../data/gourai-model';

const M = GOURAI_MODEL_CONFIG;

export interface GouraiGlow {
  core: number;
  exhaustL: number;
  exhaustR: number;
  hatch: number;
  gun: number;
  flash: number;
}

export interface GouraiMaterial {
  readonly skin: MeshStandardMaterial;
  set(g: Readonly<GouraiGlow>): void;
}

const vec = (hex: number): string => {
  const c = new Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};

/** aGlow の番号 n の重み（その番号の頂点だけ 1） */
const w = (n: number): string => `(1.0 - clamp(abs(vGlow - ${n.toFixed(1)}) * 2.0, 0.0, 1.0))`;

export function createGouraiMaterial(): GouraiMaterial {
  const core: number = M.glow.coreClosed;
  const exhaust: number = M.glow.exhaustMin;
  const u = {
    uCore: { value: core },
    uExhaustL: { value: exhaust },
    uExhaustR: { value: exhaust },
    uHatch: { value: 0 },
    uGun: { value: 0 },
    uFlash: { value: 0 },
  };
  const skin = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.5,
    flatShading: false,
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
        totalEmissiveRadiance += ${vec(M.colors.core)} * uCore * ${w(1)}
          + ${vec(M.colors.exhaust)} * (uExhaustL * ${w(2)} + uExhaustR * ${w(3)})
          + ${vec(M.colors.hatch)} * uHatch * ${w(4)}
          + ${vec(M.colors.gun)} * uGun * ${w(5)}
          + ${vec(M.colors.hover)} * ${M.glow.hover.toFixed(2)} * ${w(6)}
          + ${vec(M.colors.visor)} * ${M.glow.visor.toFixed(2)} * ${w(7)}
          + vec3(uFlash);`,
      );
  };
  skin.customProgramCacheKey = () => 'gourai-skin';
  return {
    skin,
    set(g) {
      u.uCore.value = g.core;
      u.uExhaustL.value = g.exhaustL;
      u.uExhaustR.value = g.exhaustR;
      u.uHatch.value = g.hatch;
      u.uGun.value = g.gun;
      u.uFlash.value = g.flash * 0.5;
    },
  };
}
