// 地形のマテリアル（4-1）。画質「中」以上は PBR + 三面マッピングの手続きノイズで近距離のディテール、
// 「低」は従来どおり Lambert（頂点カラーだけ）
import { MeshLambertMaterial, MeshStandardMaterial, type Material } from 'three';
import { TERRAIN_DETAIL_CONFIG } from '../data/terrain';

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : String(x));

function detailGlsl(): string {
  const c = TERRAIN_DETAIL_CONFIG;
  return /* glsl */ `
  varying vec3 vDetailPos;
  varying vec3 vDetailNormal;
  // 正弦を使わないハッシュ（大きな座標でも精度が落ちにくい。Dave Hoskins の hash12）
  float detailHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float detailNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 u = fract(p);
    u = u * u * (3.0 - 2.0 * u);
    float a = detailHash(i);
    float b = detailHash(i + vec2(1.0, 0.0));
    float c = detailHash(i + vec2(0.0, 1.0));
    float d = detailHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  // 三面マッピング: 法線の向きで 3 方向の投影を混ぜる（急斜面でも伸びない）
  float detailTriplanar(vec3 p, vec3 w) {
    return detailNoise(p.yz) * w.x + detailNoise(p.xz) * w.y + detailNoise(p.xy + 17.0) * w.z;
  }
  vec3 terrainDetail(vec3 albedo) {
    float dist = distance(vDetailPos, cameraPosition);
    vec3 n = normalize(vDetailNormal);
    vec3 w = n * n;
    w *= w;
    w /= w.x + w.y + w.z;
    float rock = 1.0 - smoothstep(${f(c.rockNormalY.to)}, ${f(c.rockNormalY.from)}, n.y);
    float boost = mix(1.0, ${f(c.rockBoost)}, rock);
    float k = 0.0;
    float fine = 1.0 - smoothstep(${f(c.fine.fadeStart)}, ${f(c.fine.fadeEnd)}, dist);
    if (fine > 0.0) {
      k += (detailTriplanar(vDetailPos / ${f(c.fine.cell)}, w) - 0.5) * 2.0 * ${f(c.fine.amplitude)} * boost * fine;
    }
    float mid = 1.0 - smoothstep(${f(c.medium.fadeStart)}, ${f(c.medium.fadeEnd)}, dist);
    if (mid > 0.0) {
      k += (detailTriplanar(vDetailPos / ${f(c.medium.cell)}, w) - 0.5) * 2.0 * ${f(c.medium.amplitude)} * boost * mid;
    }
    float macroFade = 1.0 - smoothstep(${f(c.macro.fadeStart)}, ${f(c.macro.fadeEnd)}, dist);
    float m = (detailNoise(vDetailPos.xz / ${f(c.macro.cell)}) - 0.5) * 2.0 * macroFade;
    // 大きな色むら: 明るさ + 草の色相（黄緑 ⇄ 深緑）。岩・雪では色相を変えない
    vec3 hue = mix(vec3(1.0), vec3(1.0 + 0.6 * m, 1.0 + 0.15 * m, 1.0 - 0.5 * m), (1.0 - rock) * ${f(c.macro.amplitude)});
    return albedo * hue * max(0.0, 1.0 + k + m * ${f(c.macro.amplitude)} * 0.5);
  }
`;
}

/** 画質「中」以上: PBR（粗い拡散面）+ 近距離のディテール。影を受ける */
export function createDetailedTerrainMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: TERRAIN_DETAIL_CONFIG.roughness,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vDetailPos;\nvarying vec3 vDetailNormal;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vDetailPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vDetailNormal = mat3(modelMatrix) * objectNormal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${detailGlsl()}`)
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb = terrainDetail(diffuseColor.rgb);',
      );
  };
  // onBeforeCompile の中身が違うことをプログラムのキャッシュに伝える
  material.customProgramCacheKey = () => 'terrain-detail';
  return material;
}

/** 画質「低」: 頂点カラーの Lambert（従来どおり。負荷を増やさない） */
export function createSimpleTerrainMaterial(): Material {
  return new MeshLambertMaterial({ vertexColors: true });
}
