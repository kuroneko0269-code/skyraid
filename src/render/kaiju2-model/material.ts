// 9-6a: ネフィルガのマテリアル: PBR（色は頂点の色）に発光を足す。皮膚は目（aGlow 1）と喉の袋（2。雷球の予兆で光る）、
// 翼の膜（両面）は筋（aGlow 0〜1）が紫白にゆっくり脈打ち、雷球の予兆で強くなる（ブルームに乗る）
import {
  Color,
  DoubleSide,
  MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { KAIJU2_MODEL_CONFIG } from '../../data/kaiju2-model';

const M = KAIJU2_MODEL_CONFIG;

export interface Kaiju2Materials {
  readonly skin: MeshStandardMaterial;
  readonly membrane: MeshStandardMaterial;
  /** throat: 喉の袋 0〜1、vein: 膜の筋の強まり 0〜1 */
  setGlow(throat: number, vein: number, time: number): void;
}

function patch(
  shader: WebGLProgramParametersWithUniforms,
  uniforms: Record<string, { value: number }>,
  emissive: string,
): void {
  Object.assign(shader.uniforms, uniforms);
  const decl = Object.keys(uniforms)
    .map((k) => `uniform float ${k};`)
    .join('\n');
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nvarying float vGlow;\n${decl}`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${emissive}`);
}

const vec = (hex: number): string => {
  const c = new Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};

export function createKaiju2Materials(): Kaiju2Materials {
  const skinU: { uThroat: { value: number } } = { uThroat: { value: M.glow.throatIdle } };
  const memU: { uVein: { value: number } } = { uVein: { value: M.glow.veinIdle } };
  const skin = new MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 });
  skin.onBeforeCompile = (shader) => {
    patch(
      shader,
      skinU,
      /* glsl */ `
      float eyeW = 1.0 - clamp(abs(vGlow - 1.0) * 2.0, 0.0, 1.0);
      float throatW = 1.0 - clamp(abs(vGlow - 2.0) * 2.0, 0.0, 1.0);
      totalEmissiveRadiance += ${vec(M.colors.eye)} * ${M.glow.eye.toFixed(2)} * eyeW
        + ${vec(M.colors.storm)} * uThroat * throatW;`,
    );
  };
  const membrane = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.6,
    metalness: 0,
    side: DoubleSide,
  });
  membrane.onBeforeCompile = (shader) => {
    patch(
      shader,
      memU,
      /* glsl */ `totalEmissiveRadiance += ${vec(M.colors.storm)} * uVein * vGlow;`,
    );
  };
  // 同じ形の部品でシェーダーを共有する鍵（onBeforeCompile の中身が違うので分ける）
  skin.customProgramCacheKey = () => 'kaiju2-skin';
  membrane.customProgramCacheKey = () => 'kaiju2-membrane';
  return {
    skin,
    membrane,
    setGlow(throat, vein, time) {
      const g = M.glow;
      skinU.uThroat.value = g.throatIdle + (g.throatMax - g.throatIdle) * throat;
      const pulse = 0.75 + 0.25 * Math.sin(time * 1.7);
      memU.uVein.value = (g.veinIdle + (g.veinMax - g.veinIdle) * vein) * pulse;
    },
  };
}
