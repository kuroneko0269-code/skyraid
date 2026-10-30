import { describe, expect, it } from 'vitest';
import { Mesh, type Object3D } from 'three';
import { FLIGHT_CONFIG } from '../src/data/flight';
import { QUALITY_PRESETS } from '../src/data/quality';
import { TERRAIN_CONFIG, WORLD_CONFIG } from '../src/data/terrain';
import { Aircraft } from '../src/entities/aircraft';
import { SimplexNoise2D, createRandom } from '../src/render/noise';
import { sunDirection } from '../src/render/atmosphere-model';
import { Terrain } from '../src/render/terrain';
import { createHeightField, getGroundHeight, getHeight } from '../src/render/terrain-height';
import {
  LOD_HIDDEN,
  chunkTriangles,
  distanceToBox,
  edgeVertexIndex,
  lodThresholds,
  selectLod,
  stitchEdge,
} from '../src/render/terrain-lod';

describe('ノイズ', () => {
  it('同じシードなら同じ値、違うシードなら違う値', () => {
    const a = new SimplexNoise2D(42);
    const b = new SimplexNoise2D(42);
    const c = new SimplexNoise2D(43);
    let differs = 0;
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37 - 20;
      const y = i * 0.91 + 3;
      expect(a.noise(x, y)).toBe(b.noise(x, y));
      expect(a.fbm(x, y, 5)).toBe(b.fbm(x, y, 5));
      if (a.noise(x, y) !== c.noise(x, y)) differs++;
    }
    expect(differs).toBeGreaterThan(150);
  });

  it('値はおおよそ -1〜1、リッジは 0〜1', () => {
    const n = new SimplexNoise2D(7);
    for (let i = 0; i < 2000; i++) {
      const x = (i % 50) * 0.23;
      const y = Math.floor(i / 50) * 0.29;
      expect(Math.abs(n.noise(x, y))).toBeLessThanOrEqual(1);
      const r = n.ridged(x, y, 4);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });

  it('乱数列はシードで決まる', () => {
    const a = createRandom(1);
    const b = createRandom(1);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
});

describe('getHeight', () => {
  const half = TERRAIN_CONFIG.size / 2;

  it('同じシードの高さ関数は同じ値を返す', () => {
    const other = createHeightField();
    for (const [x, z] of [
      [0, 0],
      [1234, -567],
      [-3000, 2500],
    ] as const) {
      expect(other.getHeight(x, z)).toBe(getHeight(x, z));
    }
  });

  it('山の高さは 600m 程度で、中央付近が最も高い', () => {
    let max = -Infinity;
    let maxX = 0;
    let maxZ = 0;
    for (let x = -half; x <= half; x += 50) {
      for (let z = -half; z <= half; z += 50) {
        const h = getHeight(x, z);
        if (h > max) [max, maxX, maxZ] = [h, x, z];
      }
    }
    expect(max).toBeGreaterThan(500);
    expect(max).toBeLessThan(700);
    expect(Math.hypot(maxX, maxZ)).toBeLessThan(1000);
  });

  it('8km 四方の縁と初期位置は海で、海底は海面より下・一定の深さより上', () => {
    const depth = TERRAIN_CONFIG.shape.seaDepth;
    for (let t = -half; t <= half; t += 250) {
      for (const [x, z] of [
        [t, -half],
        [t, half],
        [-half, t],
        [half, t],
      ] as const) {
        const h = getHeight(x, z);
        expect(h).toBeLessThan(TERRAIN_CONFIG.seaLevel);
        expect(h).toBeGreaterThanOrEqual(TERRAIN_CONFIG.seaLevel - depth);
      }
    }
    expect(getHeight(WORLD_CONFIG.start.x, WORLD_CONFIG.start.z)).toBeLessThan(0);
  });

  it('衝突用の地表の高さは海の上では海面', () => {
    expect(getGroundHeight(0, 6000)).toBe(TERRAIN_CONFIG.seaLevel);
    expect(getGroundHeight(0, 0)).toBe(getHeight(0, 0));
  });
});

// instanceof だけだと型引数が any になるため、既定の型引数で絞り込む
function isMesh(obj: Object3D): obj is Mesh {
  return obj instanceof Mesh;
}

describe('LOD', () => {
  const thresholds = lodThresholds(3000, [0.12, 0.3, 0.6]);

  it('段の境目は描画距離に比例し、最後は描画距離', () => {
    expect(thresholds).toEqual([360, 900, 1800, 3000]);
    expect(lodThresholds(6000, [0.1, 0.5])).toEqual([600, 3000, 6000]);
  });

  it('最も細かい段は描画距離に依らない距離まで。列は単調に増える（4-7）', () => {
    const { distanceRatios, fineDistance } = TERRAIN_CONFIG.lod;
    expect(lodThresholds(5000, distanceRatios, fineDistance)).toEqual([
      800, 1200, 2400, 3500, 5000,
    ]);
    expect(lodThresholds(3000, distanceRatios, fineDistance)).toEqual([800, 800, 1440, 2100, 3000]);
    // 段 0 は約 8m 間隔
    expect(TERRAIN_CONFIG.lod.blockSize / TERRAIN_CONFIG.lod.segments[0]).toBeCloseTo(7.8, 1);
  });

  it('距離が遠いほど粗い段になり、描画距離の外は描かない', () => {
    expect(selectLod(0, thresholds)).toBe(0);
    expect(selectLod(359, thresholds)).toBe(0);
    expect(selectLod(360, thresholds)).toBe(1);
    expect(selectLod(1000, thresholds)).toBe(2);
    expect(selectLod(2999, thresholds)).toBe(3);
    expect(selectLod(3000, thresholds)).toBe(LOD_HIDDEN);
    let prev = 0;
    for (let d = 0; d < 3000; d += 10) {
      const level = selectLod(d, thresholds);
      expect(level).toBeGreaterThanOrEqual(prev);
      prev = level;
    }
  });

  it('minLevel より細かい段は使わない', () => {
    expect(selectLod(0, thresholds, 1)).toBe(1);
    expect(selectLod(1000, thresholds, 1)).toBe(2);
    expect(selectLod(5000, thresholds, 1)).toBe(LOD_HIDDEN);
  });

  it('粗くするときだけヒステリシス分待つ', () => {
    expect(selectLod(380, thresholds, 0, 0, 100)).toBe(0);
    expect(selectLod(470, thresholds, 0, 0, 100)).toBe(1);
    // 細かくするのはすぐ
    expect(selectLod(350, thresholds, 0, 1, 100)).toBe(0);
    // 描画距離の外へ出るときも待つ
    expect(selectLod(3050, thresholds, 0, 3, 100)).toBe(3);
    expect(selectLod(3050, thresholds, 0, LOD_HIDDEN, 100)).toBe(LOD_HIDDEN);
  });

  it('箱までの距離', () => {
    const box = { minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: 0, maxZ: 10 };
    expect(distanceToBox(5, 5, 5, box)).toBe(0);
    expect(distanceToBox(13, 5, 5, box)).toBe(3);
    expect(distanceToBox(13, 14, 5, box)).toBe(5);
  });

  it('隣が粗い段の縁は、頂点の高さを粗い側の直線上に寄せ、step 1 で元に戻す', () => {
    const segments = 4;
    const count = (segments + 1) ** 2;
    const base = new Float32Array(count).map((_, i) => (i * 7) % 11);
    const positions = new Float32Array(count * 3);
    base.forEach((h, i) => (positions[i * 3 + 1] = h));
    stitchEdge(positions, base, segments, 1, 2);
    const y = (k: number): number => positions[edgeVertexIndex(segments, 1, k) * 3 + 1] ?? NaN;
    const by = (k: number): number => base[edgeVertexIndex(segments, 1, k)] ?? NaN;
    expect(y(0)).toBe(by(0));
    expect(y(1)).toBeCloseTo((by(0) + by(2)) / 2);
    expect(y(2)).toBe(by(2));
    expect(y(3)).toBeCloseTo((by(2) + by(4)) / 2);
    // 縁以外は変えない
    expect(positions[(1 * (segments + 1) + 1) * 3 + 1]).toBe(base[segments + 2]);
    stitchEdge(positions, base, segments, 1, 1);
    for (let k = 0; k <= segments; k++) expect(y(k)).toBe(by(k));
  });

  it('縁の頂点番号', () => {
    // 2 分割: 0 1 2 / 3 4 5 / 6 7 8
    expect([0, 1, 2].map((k) => edgeVertexIndex(2, 0, k))).toEqual([0, 1, 2]);
    expect([0, 1, 2].map((k) => edgeVertexIndex(2, 1, k))).toEqual([2, 5, 8]);
    expect([0, 1, 2].map((k) => edgeVertexIndex(2, 2, k))).toEqual([6, 7, 8]);
    expect([0, 1, 2].map((k) => edgeVertexIndex(2, 3, k))).toEqual([0, 3, 6]);
  });

  it('画質「低」では、どこを飛んでも地形の三角形は 10 万以下', () => {
    const low = QUALITY_PRESETS.low;
    const terrain = new Terrain();
    terrain.setQuality(low.drawDistance, low.terrainMinLod);
    let max = 0;
    for (let x = -5000; x <= 5000; x += 250) {
      for (let z = -5000; z <= 5000; z += 250) {
        for (const above of [5, 300, 1500]) {
          terrain.update({ x, y: getGroundHeight(x, z) + above, z });
          max = Math.max(max, terrain.triangleCount);
        }
      }
    }
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(100_000);
    // 「低」の最も細かい段は約 31m（4-7 の前と同じ）
    expect(
      TERRAIN_CONFIG.lod.blockSize / (TERRAIN_CONFIG.lod.segments[low.terrainMinLod] ?? 1),
    ).toBeCloseTo(31.25);
    expect(chunkTriangles(TERRAIN_CONFIG.lod.segments[0])).toBe(8192);
  });

  it('画質「中」では、どこを飛んでも地形の三角形は 25 万以下で、Mesh（draw call）はチャンクの数のまま（4-7）', () => {
    const medium = QUALITY_PRESETS.medium;
    const terrain = new Terrain();
    terrain.setQuality(medium.drawDistance, medium.terrainMinLod);
    let max = 0;
    for (let x = -4000; x <= 4000; x += 500) {
      for (let z = -4000; z <= 4000; z += 500) {
        for (const above of [5, 300, 1500]) {
          terrain.update({ x, y: getGroundHeight(x, z) + above, z });
          max = Math.max(max, terrain.triangleCount);
        }
      }
    }
    expect(max).toBeGreaterThan(100_000);
    expect(max).toBeLessThanOrEqual(250_000);
    expect(terrain.object.children.length).toBe(TERRAIN_CONFIG.chunks ** 2);
  }, 30000);

  it('ブロックをまとめたチャンクの頂点の高さは、継ぎ目以外は getHeight と一致する（4-7）', () => {
    const terrain = new Terrain();
    terrain.setQuality(5000, 0);
    terrain.update({ x: 300, y: 700, z: 200 });
    let checked = 0;
    for (const child of terrain.object.children) {
      if (!isMesh(child) || !child.visible) continue;
      const position = child.geometry.getAttribute('position');
      for (let v = 0; v < position.count; v += 31) {
        const x = position.getX(v);
        const z = position.getZ(v);
        // 継ぎ合わせで寄せた縁の頂点は、隣の粗い段の直線上にあるので数 m ずれる
        if (
          Math.abs(position.getY(v) - getHeight(x, z)) > 1e-3 &&
          (x + 4000) % 500 !== 0 &&
          (z + 4000) % 500 !== 0
        )
          throw new Error(`ずれ ${x} ${z}`);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

describe('地形との衝突', () => {
  it('高度 500m で島へ水平に飛ぶと山に衝突し、墜落地点の地表から上空にリセットされる', () => {
    const a = new Aircraft(undefined, {}, undefined, getGroundHeight);
    a.respawn(WORLD_CONFIG.start);
    const zero = { pitch: 0, roll: 0, yaw: 0, throttle: 0, afterburner: false };
    let steps = 0;
    let crashZ = Infinity;
    while (a.crashCount === 0 && steps < 60 * 60) {
      crashZ = a.state.position.z;
      a.step(zero, 1 / 60);
      steps++;
    }
    expect(a.crashCount).toBe(1);
    // 海面（高度 0）ではなく島の斜面で当たっている
    expect(getHeight(a.state.position.x, crashZ)).toBeGreaterThan(400);
    const p = a.state.position;
    expect(p.y).toBeCloseTo(getGroundHeight(p.x, p.z) + FLIGHT_CONFIG.spawn.position.y, 6);
  });
});

describe('太陽の方向', () => {
  it('単位ベクトルで、仰角どおりの高さ', () => {
    const d = sunDirection(40, 30);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 10);
    expect(d.y).toBeCloseTo(0.5, 10);
    expect(sunDirection(0, 0)).toEqual({ x: 0, y: 0, z: -1 });
  });
});
