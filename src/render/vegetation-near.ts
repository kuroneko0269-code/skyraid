// 近くの木の形とマテリアル（4-9 で vegetation.ts から分けた）。
// 形は少しずつずらした円錐 3 段 + 最上段の頂点を丸める輪 + 3 角柱の幹（36 三角形）。葉の法線は上へ曲げ、
// 空の環境マップ（4-10）で影側も空の色で照らす（MeshStandardMaterial）。数値は src/data/vegetation.ts
import { BufferAttribute, BufferGeometry, Color, MeshStandardMaterial } from 'three';
import { VEGETATION_CONFIG } from '../data/vegetation';
import { WIND_CONFIG } from '../data/wind';
import { terrainLinear } from './terrain-layers-glsl';

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : String(x));

/** 葉・幹の色（地形の層と同じく彩度を下げた線形 RGB。4-7） */
export function treeColor(hex: number): Color {
  const [r, g, b] = terrainLinear(hex);
  return new Color(r, g, b);
}

type P3 = [number, number, number];

/** 三角形を足していく入れ物（頂点ごとに位置・法線・幹か） */
class TriangleList {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly parts: number[] = [];

  add(p: readonly P3[], n: readonly P3[], part: number): void {
    for (let i = 0; i < 3; i++) {
      this.positions.push(...(p[i] ?? [0, 0, 0]));
      this.normals.push(...(n[i] ?? [0, 1, 0]));
      this.parts.push(part);
    }
  }
}

/** 側面の法線（半径 r の輪から高さ dy 上の半径 r2 の輪へ向かう面、角度 a）を上へ bend だけ曲げる */
function sideNormal(a: number, dr: number, dy: number, bend: number): P3 {
  // 面の傾き: 外向き dy、上向き dr（半径が減る分）
  const nx = Math.cos(a) * dy;
  const nz = Math.sin(a) * dy;
  const ny = dr;
  const len = Math.hypot(nx, ny, nz) || 1;
  const x = nx / len;
  const y = ny / len + bend;
  const z = nz / len;
  const l2 = Math.hypot(x, y, z) || 1;
  return [x / l2, y / l2, z / l2];
}

/**
 * 高さ 1・幅 1（半径 0.5）の木。y = 0 が根元。頂点カラーで幹と葉（下ほど暗い）を塗る。
 * treePart は幹 1・葉 0（幹と葉で別の個体差の色を掛けるため。4-8）
 */
export function createTreeGeometry(): BufferGeometry {
  const v = VEGETATION_CONFIG;
  const s = v.nearShape;
  const bend = v.environment.normalUp;
  const n = s.segments;
  const list = new TriangleList();
  // 幹: 3 角柱（上下は開いている）
  const tn = s.trunkSegments;
  for (let i = 0; i < tn; i++) {
    const a0 = (i / tn) * Math.PI * 2;
    const a1 = ((i + 1) / tn) * Math.PI * 2;
    const p = (a: number, r: number, y: number): P3 => [Math.cos(a) * r, y, Math.sin(a) * r];
    const nn = (a: number): P3 => [Math.cos(a), 0, Math.sin(a)];
    list.add(
      [p(a0, 0.06, 0), p(a1, 0.045, s.trunkTop), p(a1, 0.06, 0)],
      [nn(a0), nn(a1), nn(a1)],
      1,
    );
    list.add(
      [p(a0, 0.06, 0), p(a0, 0.045, s.trunkTop), p(a1, 0.045, s.trunkTop)],
      [nn(a0), nn(a0), nn(a1)],
      1,
    );
  }
  // 葉: 段ごとに中心を少しずらし（向きは段ごとに 2.1 rad 回す）、輪の向きも半分ずつ回す
  s.tiers.forEach(([y0, y1, r, off], k) => {
    const cx = Math.cos(k * 2.1) * off;
    const cz = Math.sin(k * 2.1) * off;
    const turn = (k * Math.PI) / n;
    const last = k === s.tiers.length - 1;
    // 最上段は頂点の手前に輪を足して丸める: 下の輪 → 丸めの輪 → 頂点
    const rings: [number, number][] = last
      ? [
          [r, y0],
          [r * s.roundRadius, y0 + (y1 - y0) * s.roundAt],
          [0, y1],
        ]
      : [
          [r, y0],
          [0, y1],
        ];
    for (let j = 0; j + 1 < rings.length; j++) {
      const [ra, ya] = rings[j] ?? [0, 0];
      const [rb, yb] = rings[j + 1] ?? [0, 0];
      // 丸めの輪の法線は上下の面の平均（なめらかに丸く見える）
      const prev = j > 0 ? rings[j - 1] : undefined;
      const next = rings[j + 2];
      for (let i = 0; i < n; i++) {
        const a0 = turn + (i / n) * Math.PI * 2;
        const a1 = turn + ((i + 1) / n) * Math.PI * 2;
        const am = (a0 + a1) / 2;
        const pt = (a: number, rr: number, y: number): P3 => [
          cx + Math.cos(a) * rr,
          y,
          cz + Math.sin(a) * rr,
        ];
        const face = (a: number): P3 => sideNormal(a, ra - rb, yb - ya, bend);
        const blend = (a: number, other: [number, number] | undefined, below: boolean): P3 => {
          if (!other) return face(a);
          const o = below
            ? sideNormal(a, other[0] - ra, ya - other[1], bend)
            : sideNormal(a, rb - other[0], other[1] - yb, bend);
          const mine = face(a);
          const m: P3 = [mine[0] + o[0], mine[1] + o[1], mine[2] + o[2]];
          const l = Math.hypot(...m) || 1;
          return [m[0] / l, m[1] / l, m[2] / l];
        };
        if (rb === 0) {
          // 頂点へ向かう扇: 頂点の法線は三角形の中央の向き
          list.add(
            [pt(a0, ra, ya), pt(am, 0, yb), pt(a1, ra, ya)],
            [blend(a0, prev, true), face(am), blend(a1, prev, true)],
            0,
          );
        } else {
          list.add(
            [pt(a0, ra, ya), pt(a1, rb, yb), pt(a1, ra, ya)],
            [blend(a0, prev, true), blend(a1, next, false), blend(a1, prev, true)],
            0,
          );
          list.add(
            [pt(a0, ra, ya), pt(a0, rb, yb), pt(a1, rb, yb)],
            [blend(a0, prev, true), blend(a0, next, false), blend(a1, next, false)],
            0,
          );
        }
      }
    }
  });
  const count = list.parts.length;
  const colors = new Float32Array(count * 3);
  const foliage = treeColor(v.colors.foliage);
  const bark = treeColor(v.colors.trunk);
  for (let i = 0; i < count; i++) {
    const trunk = list.parts[i] === 1;
    const y = list.positions[i * 3 + 1] ?? 0;
    const col = trunk ? bark : foliage;
    // 葉は下ほど暗い（枝の重なりの陰）。4-9 で 0.55〜1.15 → 0.65〜1.1（下側が黒くつぶれない）
    const shade = trunk ? 1 : 0.65 + 0.45 * y;
    colors.set([col.r * shade, col.g * shade, col.b * shade], i * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(list.positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(list.normals), 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setAttribute('treePart', new BufferAttribute(new Float32Array(list.parts), 1));
  return geometry;
}

export function createNearMaterial(
  time: { value: number },
  sway: { value: number } = { value: 1 },
): MeshStandardMaterial {
  const v = VEGETATION_CONFIG;
  const wind = (WIND_CONFIG.direction * Math.PI) / 180;
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: v.environment.roughness,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTreeTime = time;
    shader.uniforms.uTreeSway = sway;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTreeTime;\nuniform float uTreeSway;\nattribute float treePart;\nattribute vec3 instanceTrunkColor;',
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        #ifdef USE_INSTANCING_COLOR
          // 個体差（4-8）: 葉は instanceColor、幹は instanceTrunkColor
          vColor.xyz = color.xyz * mix(instanceColor.xyz, instanceTrunkColor, treePart);
        #endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          // 風の揺れ: 梢ほど大きく（position.y は高さに対する割合）。位相は木の位置で変える。
          // 木は向きをランダムに回すので（4-9）、風の向きを木のローカルの向きに直す
          float swayPhase = dot(instanceMatrix[3].xz, vec2(0.071, 0.053));
          float sway = sin(uTreeTime * ${f(v.sway.speed)} + swayPhase)
            + 0.35 * sin(uTreeTime * ${f(v.sway.speed * 2.3)} + swayPhase * 1.7);
          float widthScale = max(length(instanceMatrix[0].xyz), 0.1);
          vec2 windDir = vec2(${f(Math.cos(wind))}, ${f(Math.sin(wind))});
          vec2 windLocal = vec2(dot(instanceMatrix[0].xz, windDir), dot(instanceMatrix[2].xz, windDir)) / widthScale;
          transformed.xz += windLocal * sway * (${f(v.sway.amplitude)} * uTreeSway / widthScale) * position.y * position.y;
          // 遠景（ビルボード）の距離ではつぶす
          if (distance(instanceMatrix[3].xyz, cameraPosition) > ${f(v.nearDistance)}) transformed = vec3(0.0);
        #endif`,
      );
  };
  material.customProgramCacheKey = () => 'tree-near';
  return material;
}
