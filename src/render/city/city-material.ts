// 建物のマテリアル（6-4）: 単位の箱（InstancedMesh）に、手続きの窓の格子を描く。画像なし。
// インスタンスの属性 aBuild = (1 階の高さ, 窓の横の間隔, 種類の番号, 部品の下端の高さ)。種類: 0 低層 1 中層 2 タワー 3 倉庫 4 瓦礫。
// 箱の大きさはインスタンス行列の列の長さから取り、窓の大きさが箱の大きさで伸びないようにする。窓は粗さを下げて空を映す
import { MeshStandardMaterial } from 'three';
import { CITY_CONFIG } from '../../data/city';

export const KIND_CODE = { low: 0, mid: 1, tower: 2, warehouse: 3, rubble: 4 } as const;

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : String(x));

export function createBuildingMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ roughness: 0.85, metalness: 0.05 });
  const k = CITY_CONFIG.kinds;
  const ratios = [k.low, k.mid, k.tower, k.warehouse].map(
    (s) => `vec2(${f(s.windowRatio[0])}, ${f(s.windowRatio[1])})`,
  );
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aBuild;\nvarying vec3 vBox;\nvarying vec3 vBoxN;\nvarying vec4 vBuild;',
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vec3 kSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vBox = position * kSize;
        vBoxN = normal;
        vBuild = aBuild;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vBox;
        varying vec3 vBoxN;
        varying vec4 vBuild;
        float cityHash(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        vec2 cityRatio(float kind) {
          if (kind < 0.5) return ${ratios[0]};
          if (kind < 1.5) return ${ratios[1]};
          if (kind < 2.5) return ${ratios[2]};
          return ${ratios[3]};
        }
        float cityWindow = 0.0;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float kind = vBuild.z;
        if (kind > 3.5) {
          // 瓦礫: 粗いまだら
          diffuseColor.rgb *= 0.7 + 0.5 * cityHash(floor(vBox.xz * 0.5) + floor(vBox.y));
        } else if (abs(vBoxN.y) > 0.5) {
          // 屋根: 暗く、設備の箱のようなまだら
          diffuseColor.rgb *= 0.55 + 0.2 * cityHash(floor(vBox.xz / 4.0));
        } else {
          float u = abs(vBoxN.x) > 0.5 ? vBox.z : vBox.x;
          float v = vBox.y + vBuild.w;
          vec2 cell = vec2(u / vBuild.y, v / vBuild.x);
          vec2 fr = fract(cell);
          vec2 r = cityRatio(kind);
          vec2 lo = (1.0 - r) * 0.5;
          // 画面上で窓が細かすぎる距離では平均の色にする（ちらつき防止）
          vec2 fw = fwidth(cell);
          float aa = clamp(1.0 - max(fw.x, fw.y) * 1.5, 0.0, 1.0);
          float wx = smoothstep(lo.x - fw.x, lo.x + fw.x, fr.x) * (1.0 - smoothstep(1.0 - lo.x - fw.x, 1.0 - lo.x + fw.x, fr.x));
          float wy = smoothstep(lo.y - fw.y, lo.y + fw.y, fr.y) * (1.0 - smoothstep(1.0 - lo.y - fw.y, 1.0 - lo.y + fw.y, fr.y));
          float w = mix(r.x * r.y, wx * wy, aa);
          // 低層の 1 階は店の大きな窓
          if (kind < 0.5 && v < vBuild.x) w = smoothstep(0.1, 0.2, fr.x) * (1.0 - smoothstep(0.8, 0.9, fr.x)) * step(0.1, fr.y) * step(fr.y, 0.85);
          float shade = cityHash(floor(cell));
          vec3 glass = mix(vec3(0.16, 0.21, 0.27), vec3(0.34, 0.42, 0.50), shade);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, w);
          cityWindow = w;
          // 階ごとのわずかな帯
          diffuseColor.rgb *= 0.94 + 0.06 * step(0.92, fr.y);
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, cityWindow);',
      )
      .replace(
        '#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.35, cityWindow);',
      );
  };
  material.customProgramCacheKey = () => 'city-building';
  return material;
}
