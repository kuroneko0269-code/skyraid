import { describe, expect, it } from 'vitest';
import { FREE_FLIGHT_ENEMIES } from '../src/data/ai';
import { MISSIONS } from '../src/data/missions';
import { DRONE_CONFIG } from '../src/data/targets';
import { TERRAIN_CONFIG } from '../src/data/terrain';
import { VEGETATION_CONFIG } from '../src/data/vegetation';
import { TerrainPalette, buildChunkGeometry } from '../src/render/terrain-geometry';
import { erode } from '../src/render/terrain-gen/erosion';
import { forestDensity, forestGlsl, placeTrees, slopeDeg } from '../src/render/terrain-gen/forest';
import {
  createHeightField,
  defaultHeightField,
  getGroundHeight,
  getHeight,
} from '../src/render/terrain-height';

const EROSION = TERRAIN_CONFIG.erosion;
const unEroded = createHeightField(undefined, { erosion: false });

/** 中心から角度ごとに外から内へ探した、最も外側の海岸線（高さ 0）までの距離の平均 */
function meanCoastRadius(height: (x: number, z: number) => number): number {
  let sum = 0;
  const rays = 360;
  for (let a = 0; a < rays; a++) {
    const dx = Math.cos((a / rays) * 2 * Math.PI);
    const dz = Math.sin((a / rays) * 2 * Math.PI);
    let r = 4000;
    while (r > 0 && height(dx * r, dz * r) < TERRAIN_CONFIG.seaLevel) r -= 5;
    sum += r;
  }
  return sum / rays;
}

function smallGrid(): { resolution: number; heights: Float32Array; mask: Float32Array } {
  const n = 64;
  const heights = new Float32Array(n * n);
  const mask = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = i / n - 0.5;
      const z = j / n - 0.5;
      const h =
        600 * Math.exp(-10 * (x * x + z * z)) + 20 * Math.sin(i * 0.7) * Math.cos(j * 0.5) - 50;
      heights[i + j * n] = h;
      mask[i + j * n] = h > 5 ? 1 : 0;
    }
  }
  return { resolution: n, heights, mask };
}

describe('浸食（4-6）', () => {
  it('同じシードなら同じ結果、違うシードなら違う結果', () => {
    const params = { ...EROSION, droplets: 3000 };
    const a = smallGrid();
    const b = smallGrid();
    const c = smallGrid();
    erode(a, params, 1);
    erode(b, params, 1);
    erode(c, params, 2);
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    expect(Array.from(a.heights)).not.toEqual(Array.from(c.heights));
    // 削った（変わった）点がある。効きが 0 の点は変わらない
    const before = smallGrid();
    let changed = 0;
    for (let k = 0; k < a.heights.length; k++) {
      if (before.mask[k] === 0) expect(a.heights[k]).toBe(before.heights[k]);
      else if (a.heights[k] !== before.heights[k]) changed++;
    }
    expect(changed).toBeGreaterThan(500);
  });

  it('既定の島も毎回同じ高さになる', () => {
    const other = createHeightField();
    for (let i = 0; i < 300; i++) {
      const x = ((i * 137) % 6000) - 3000;
      const z = ((i * 251) % 6000) - 3000;
      expect(other.getHeight(x, z)).toBe(getHeight(x, z));
    }
  });

  it('谷を削り山裾に溜める（地形を実際に変えている）', () => {
    let lower = 0;
    let higher = 0;
    for (let x = -2500; x <= 2500; x += 40) {
      for (let z = -2500; z <= 2500; z += 40) {
        const d = getHeight(x, z) - unEroded.getHeight(x, z);
        if (d < -3) lower++;
        if (d > 1) higher++;
      }
    }
    expect(lower).toBeGreaterThan(1000);
    expect(higher).toBeGreaterThan(500);
  });

  it('海抜 5m 未満の地形は変えない（海岸線・浅瀬・水深は 4-2c のまま）', () => {
    for (let i = 0; i < 4000; i++) {
      const a = (i / 4000) * 2 * Math.PI;
      const r = 2300 + ((i * 97) % 1500);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const base = unEroded.getHeight(x, z);
      if (base < EROSION.minHeight) expect(getHeight(x, z)).toBe(base);
      else expect(getHeight(x, z)).toBeGreaterThanOrEqual(EROSION.minHeight - 1e-9);
    }
  });

  it('海岸線の平均半径は浸食しない島・設定値（2900m）から ±5% 以内', () => {
    const eroded = meanCoastRadius(getHeight);
    const base = meanCoastRadius(unEroded.getHeight);
    expect(Math.abs(eroded / base - 1)).toBeLessThan(0.05);
    expect(Math.abs(eroded / TERRAIN_CONFIG.shape.coastRadius - 1)).toBeLessThan(0.05);
  });

  it('最高点は 550〜650m', () => {
    let max = -Infinity;
    for (let x = -1500; x <= 1500; x += 10) {
      for (let z = -1500; z <= 1500; z += 10) max = Math.max(max, getHeight(x, z));
    }
    expect(max).toBeGreaterThan(550);
    expect(max).toBeLessThan(650);
  });

  it('起動時の浸食は 200ms 以内', () => {
    // 既定の島（読み込み時の 1 回目）と作り直し 1 回の速い方（テストの並列実行による揺れを避ける）
    const again = createHeightField();
    expect(Math.min(defaultHeightField.erosionMs, again.erosionMs)).toBeLessThan(200);
    expect(defaultHeightField.erosionMs).toBeGreaterThan(0);
  });
});

describe('海岸の作り分け（4-6）', () => {
  /** 海岸線から内陸へ 40m の平均の傾き（m/m） */
  function coastSlope(deg: number): number {
    const dx = Math.cos((deg * Math.PI) / 180);
    const dz = Math.sin((deg * Math.PI) / 180);
    let r = 4000;
    while (getHeight(dx * r, dz * r) < 0) r -= 1;
    return getHeight(dx * (r - 40), dz * (r - 40)) / 40;
  }

  it('風上（風が吹いてくる南西）は崖、風下（北東）は遠浅の浜', () => {
    // 風向き 30°（+X から +Z へ吹いていく）。風上は 210° 側
    const windward = [195, 210, 225].map(coastSlope);
    const leeward = [15, 30, 45].map(coastSlope);
    for (const s of windward) expect(s).toBeGreaterThan(0.5);
    for (const s of leeward) expect(s).toBeLessThan(0.1);
  });
});

describe('getHeight と描画メッシュ', () => {
  it('チャンクの頂点の高さは getHeight と一致する（継ぎ合わせ前）', () => {
    const palette = new TerrainPalette();
    for (const [minX, minZ] of [
      [-2000, -2000],
      [0, 0],
      [-4000, 2000],
    ] as const) {
      for (const segments of TERRAIN_CONFIG.lod.segments) {
        const chunk = buildChunkGeometry({ minX, minZ, size: 2000 }, segments, getHeight, palette);
        const p = chunk.positions;
        for (let v = 0; v < p.length / 3; v += 7) {
          const x = p[v * 3] ?? 0;
          const z = p[v * 3 + 2] ?? 0;
          expect(p[v * 3 + 1]).toBeCloseTo(getHeight(x, z), 3);
        }
      }
    }
  });
});

describe('木の配置（4-6）', () => {
  const v = VEGETATION_CONFIG;

  it('同じ本数なら毎回同じ。少ない本数は多い本数の先頭と同じ並び', () => {
    const a = placeTrees(getHeight, 3000);
    const b = placeTrees(getHeight, 3000);
    const c = placeTrees(getHeight, 12000);
    expect(a.count).toBe(3000);
    expect(c.count).toBe(12000);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(c.positions.subarray(0, 9000))).toEqual(Array.from(a.positions));
  });

  it('森の層（高度 20〜350m・傾斜 25° 以下）の、森の密度がある所にだけ置き、根元は getHeight の高さ', () => {
    const t = placeTrees(getHeight, 12000);
    for (let i = 0; i < t.count; i++) {
      const x = t.positions[i * 3] ?? 0;
      const y = t.positions[i * 3 + 1] ?? 0;
      const z = t.positions[i * 3 + 2] ?? 0;
      expect(y).toBeCloseTo(getHeight(x, z), 3);
      expect(y).toBeGreaterThanOrEqual(v.minHeight);
      expect(y).toBeLessThanOrEqual(v.maxHeight);
      expect(slopeDeg(getHeight, x, z, v.slopeStep)).toBeLessThanOrEqual(v.maxSlopeDeg);
      expect(forestDensity(x, z)).toBeGreaterThan(0);
    }
  });

  it('画質「高」の 30000 本も置ける', () => {
    expect(placeTrees(getHeight, 30000).count).toBe(30000);
  });

  it('GLSL の森の密度は同じ定数（ハッシュの乗数・格子の大きさ）を使う', () => {
    const glsl = forestGlsl();
    expect(glsl).toContain('1597334677u');
    expect(glsl).toContain('3812015801u');
    expect(glsl).toContain('2246822519u');
    expect(glsl).toContain(`/ ${v.density.cellLarge}.0`);
    expect(glsl).toContain(`/ ${v.density.cellSmall}.0`);
  });
});

describe('出現位置が浸食後の地形に埋まらない（4-6）', () => {
  // リングは tests/mission-sim.test.ts（地表から 300m 以上）で確かめている
  const CLEARANCE = 100;

  it('ドローンの円軌道は全周で地表から 100m 以上', () => {
    for (const o of DRONE_CONFIG.orbits) {
      for (let a = 0; a < 360; a++) {
        const t = (a * Math.PI) / 180;
        const x = o.centerX + o.radius * Math.cos(t);
        const z = o.centerZ + o.radius * Math.sin(t);
        expect(o.altitude - getGroundHeight(x, z)).toBeGreaterThan(CLEARANCE);
      }
    }
  });

  it('敵機の出現位置と巡航の経路の点（フリーフライト・ミッション）は地表から 100m 以上', () => {
    const points: { x: number; y: number; z: number }[] = [
      ...FREE_FLIGHT_ENEMIES.spawns,
      ...FREE_FLIGHT_ENEMIES.patrols.flat(),
    ];
    for (const m of MISSIONS) {
      points.push(m.start);
      for (const sp of m.spawns) {
        if (sp.kind === 'enemyFighter') points.push(...sp.positions, ...sp.patrol);
      }
    }
    expect(points.length).toBeGreaterThan(10);
    for (const p of points) expect(p.y - getGroundHeight(p.x, p.z)).toBeGreaterThan(CLEARANCE);
  });
});
