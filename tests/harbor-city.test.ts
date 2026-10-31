// 6-4: 港湾都市（マップの定義・地形・街の配置）。建物の判定と破壊は buildings.test.ts、切り替えは map-switch.test.ts
import { describe, expect, it } from 'vitest';
import { CITY_CONFIG } from '../src/data/city';
import { RAID_CONFIG } from '../src/data/kaiju';
import { HARBOR_MAP, MAPS } from '../src/data/maps';
import { MISSIONS } from '../src/data/missions';
import { RAID_MISSION } from '../src/data/missions-special';
import { HARBOR_TERRAIN } from '../src/data/terrain-harbor';
import { generateCity, type Building } from '../src/render/city/layout';
import { placeTrees } from '../src/render/terrain-gen/forest';
import { harborCoastZ } from '../src/render/terrain-gen/harbor-shape';
import { createHeightField } from '../src/render/terrain-height';

const harbor = createHeightField(HARBOR_TERRAIN);
const HARBOR_SHAPE =
  HARBOR_TERRAIN.shape.harbor ??
  (() => {
    throw new Error('港湾都市の形');
  })();
const city = generateCity();

function overlaps(
  a: { minX: number; maxX: number; minZ: number; maxZ: number },
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
): boolean {
  const e = 1e-6;
  return a.minX < b.maxX - e && a.maxX > b.minX + e && a.minZ < b.maxZ - e && a.maxZ > b.minZ + e;
}

function partRect(
  b: Building,
  k: number,
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const p = b.parts[k];
  if (!p) throw new Error('part');
  return { minX: p.cx - p.w / 2, maxX: p.cx + p.w / 2, minZ: p.cz - p.d / 2, maxZ: p.cz + p.d / 2 };
}

describe('マップの定義', () => {
  it('島と港湾都市。キャンペーン M1〜M5 は島、レイドは港湾都市に固定', () => {
    expect(Object.keys(MAPS).sort()).toEqual(['harbor', 'island']);
    for (const m of MISSIONS) expect([m.id, m.mapId]).toEqual([m.id, 'island']);
    expect(RAID_MISSION.mapId).toBe('harbor');
    expect(RAID_CONFIG.mapId).toBe('harbor');
  });

  it('レイド: 湾の沖 3km から上陸してタワー群へ、開始は街の北・高度 800m・機首は湾側（+Z）', () => {
    const r = CITY_CONFIG.rect;
    expect(HARBOR_MAP.kaiju.from.z - r.maxZ).toBe(3000);
    expect(HARBOR_MAP.kaiju.goal).toEqual(CITY_CONFIG.center);
    expect(HARBOR_MAP.raidStart.y).toBe(800);
    expect(HARBOR_MAP.raidStart.z).toBeLessThan(r.minZ);
    expect(HARBOR_MAP.raidStart.headingDeg).toBe(180);
    // 上陸地点は海、開始位置の下は陸（街の北）
    expect(harbor.getHeight(HARBOR_MAP.kaiju.from.x, HARBOR_MAP.kaiju.from.z)).toBeLessThan(-20);
    expect(harbor.getHeight(HARBOR_MAP.raidStart.x, HARBOR_MAP.raidStart.z)).toBeGreaterThan(0);
  });
});

describe('地形', () => {
  it('島の地形と木は 6-4 の前と同じ（高さの合計・木の位置の合計を 6-4 の前のコードで測った値と比べる）', () => {
    const f = createHeightField();
    let sum = 0;
    for (let z = -4000; z <= 4000; z += 37)
      for (let x = -4000; x <= 4000; x += 37) sum += f.getHeight(x, z);
    expect(sum).toBeCloseTo(946715.334573, 3);
    const t = placeTrees(f.getHeight, 5000, undefined, undefined, true);
    let ts = 0;
    for (const v of t.positions) ts += v;
    expect(t.count).toBe(5000);
    expect(ts).toBeCloseTo(-111771.1391, 2);
  });

  it('港湾都市: 8km 四方。南は湾（海）、北に約 300m の山、街の範囲は平ら', () => {
    expect(HARBOR_TERRAIN.size).toBe(8000);
    // 湾の沖・外周は海
    expect(harbor.getHeight(0, 2500)).toBeLessThan(-20);
    expect(harbor.getHeight(3900, 0)).toBeLessThan(-20);
    expect(harbor.getHeight(0, -3950)).toBeLessThan(-20);
    let peak = 0;
    for (let z = -3500; z < -1500; z += 25)
      for (let x = -3000; x < 3000; x += 25) peak = Math.max(peak, harbor.getHeight(x, z));
    expect(peak).toBeGreaterThan(270);
    expect(peak).toBeLessThan(330);
    const r = CITY_CONFIG.rect;
    for (let k = 0; k < 30 * 51; k++) {
      const x = r.minX + (k % 51) * 50;
      const z = r.minZ + Math.floor(k / 51) * 50;
      expect(harbor.getHeight(x, z)).toBeCloseTo(CITY_CONFIG.groundHeight, 1);
    }
    // 岸壁の外はすぐ深い
    expect(harbor.getHeight(0, r.maxZ + 20)).toBeLessThan(-10);
  });

  it('平野の木は少なく、街の範囲には木がない', () => {
    const area = {
      radius: HARBOR_MAP.vegetation.radius,
      mask: (x: number, z: number, h: number) => {
        const v = HARBOR_MAP.vegetation;
        const c = v.clear;
        if (c && x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) return 0;
        return h < v.lowlandFull ? v.lowlandScale : 1;
      },
    };
    const t = placeTrees(harbor.getHeight, 6000, undefined, undefined, false, area);
    let inCity = 0;
    let plain = 0;
    const c = HARBOR_MAP.vegetation.clear;
    for (let i = 0; i < t.count; i++) {
      const x = t.positions[i * 3] ?? 0;
      const y = t.positions[i * 3 + 1] ?? 0;
      const z = t.positions[i * 3 + 2] ?? 0;
      if (c && x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) inCity++;
      if (y < 30) plain++;
    }
    expect(inCity).toBe(0);
    expect(plain / t.count).toBeLessThan(0.25);
  });
});

describe('街の配置', () => {
  it('道路の格子と建物の配置は決定的（同じ設定なら同じ）', () => {
    const again = generateCity();
    expect(JSON.stringify(again.buildings)).toBe(JSON.stringify(city.buildings));
    expect(again.roadX).toEqual(city.roadX);
    expect(again.roadZ).toEqual(city.roadZ);
    expect(again.viewOrder).toEqual(city.viewOrder);
  });

  it('道路は幅 20m・主要道路 40m の格子、建物は 4000 棟、中心部にタワー 6〜10 棟（25〜40 階）', () => {
    const widths = new Set(
      city.roads.map((r) => Math.round(Math.min(r.maxX - r.minX, r.maxZ - r.minZ))),
    );
    expect([...widths].sort((a, b) => a - b)).toEqual([20, 40]);
    expect(city.buildings.length).toBe(4000);
    const towers = city.buildings.filter((b) => b.kind === 'tower');
    expect(towers.length).toBeGreaterThanOrEqual(6);
    expect(towers.length).toBeLessThanOrEqual(10);
    const t = CITY_CONFIG.kinds.tower;
    for (const b of towers) {
      expect(b.height).toBeGreaterThanOrEqual(t.floors[0] * t.floorHeight - 1e-6);
      expect(b.height).toBeLessThanOrEqual(t.floors[1] * t.floorHeight + 1e-6);
      const cx = (b.minX + b.maxX) / 2 - CITY_CONFIG.center.x;
      const cz = (b.minZ + b.maxZ) / 2 - CITY_CONFIG.center.z;
      expect(Math.hypot(cx, cz)).toBeLessThan(CITY_CONFIG.towers.radius);
    }
    const kinds = new Set(city.buildings.map((b) => b.kind));
    expect([...kinds].sort()).toEqual(['low', 'mid', 'tower', 'warehouse']);
  });

  it('建物は道路と海に重ならない（部品の箱が道路の四角にかからず、足元はすべて街の平らな陸）', () => {
    for (const b of city.buildings) {
      for (let k = 0; k < b.parts.length; k++) {
        const rect = partRect(b, k);
        for (const road of city.roads) expect(overlaps(rect, road)).toBe(false);
        for (const [x, z] of [
          [rect.minX, rect.minZ],
          [rect.maxX, rect.minZ],
          [rect.minX, rect.maxZ],
          [rect.maxX, rect.maxZ],
        ] as const) {
          expect(harbor.getHeight(x, z)).toBeGreaterThan(CITY_CONFIG.groundHeight - 0.5);
          expect(z).toBeLessThan(harborCoastZ(HARBOR_SHAPE, x));
        }
      }
    }
  });

  it('建物の三角形は街全体で 30 万以下（単位の箱 10 三角形 × 部品の数）', () => {
    const parts = city.buildings.reduce((a, b) => a + b.parts.length, 0);
    expect(parts * 10).toBeLessThanOrEqual(300000);
  });

  it('街の生成は 300ms 以内', () => {
    const t0 = performance.now();
    generateCity();
    expect(performance.now() - t0).toBeLessThan(300);
  });
});
