// リングレース（7-1）のコースの保証条件: リングは地表 30m 以上・前のリング（1 個目は開始位置）から見える・
// 連続するリングの間の必要旋回率が全機体（未強化）の最大ピッチ角速度の 80% 以下
import { describe, expect, it } from 'vitest';
import { COURSES, findCourse } from '../src/data/courses';
import { MAPS } from '../src/data/maps';
import { RACE_CONFIG } from '../src/data/race';
import { isWeatherId } from '../src/data/weather';
import { ActiveMap } from '../src/missions/active-map';
import {
  buildRaceRings,
  legTurn,
  legTurnRate,
  minClearance,
  referenceSpecs,
  startAsRing,
} from '../src/missions/race/course';

const maps = new Map<string, ActiveMap>();
function mapFor(id: string): ActiveMap {
  let m = maps.get(id);
  if (!m) {
    m = new ActiveMap();
    m.use(id);
    maps.set(id, m);
  }
  return m;
}

/** 地表と立っている建物の屋根の高い方 */
function groundTop(map: ActiveMap): (x: number, z: number) => number {
  return (x, z) => Math.max(map.ground(x, z), map.buildings?.topAt(x, z) ?? -Infinity);
}

describe('コースの定義', () => {
  it('初期コース 4 本（リングの数・マップ・天候）', () => {
    const summary = COURSES.map((c) => [c.id, c.mapId, c.weatherId, c.rings.length]);
    expect(summary).toEqual([
      ['coast', 'island', 'day-clear', 12],
      ['canyon', 'island', 'day-clear', 18],
      ['harbor-speed', 'harbor', 'day-clear', 20],
      ['acro', 'island', 'evening-clear', 16],
    ]);
    for (const c of COURSES) {
      expect(MAPS[c.mapId], c.id).toBeDefined();
      expect(isWeatherId(c.weatherId), c.id).toBe(true);
      expect(findCourse(c.id)).toBe(c);
      expect(c.goldTimeSeconds, c.id).toBeGreaterThan(0);
      expect(c.timeLimitSeconds, c.id).toBeGreaterThan(c.goldTimeSeconds * 2);
    }
    expect(findCourse('none')).toBeNull();
  });

  it('どのコースにも 4 種類のリングがあり、ゴールは飛ばせない', () => {
    for (const c of COURSES) {
      const kinds = new Set(c.rings.map((r) => r.kind));
      expect([...kinds].sort(), c.id).toEqual(['boost', 'checkpoint', 'normal', 'thin']);
      const rings = buildRaceRings(c);
      expect(rings[rings.length - 1]?.required, c.id).toBe(true);
      for (const r of rings) {
        expect(r.required, `${c.id} ${r.index}`).toBe(
          r.kind === 'checkpoint' || r === rings.at(-1),
        );
        // 細いリングは半径半分（40 → 20m、通過 23m）
        expect(r.radius).toBe(r.kind === 'thin' ? 20 : 40);
        expect(r.passRadius).toBeCloseTo(r.radius * RACE_CONFIG.passRadiusScale);
      }
    }
  });
});

describe('コースの保証条件', () => {
  for (const course of COURSES) {
    describe(course.name, () => {
      const map = mapFor(course.mapId);
      const top = groundTop(map);
      const rings = buildRaceRings(course);

      it(`リングの中心は地表（建物の屋根）から ${RACE_CONFIG.minRingAgl}m 以上`, () => {
        for (const r of rings) {
          const p = r.position;
          expect(p.y - top(p.x, p.z), `${r.index + 1} 個目`).toBeGreaterThanOrEqual(
            RACE_CONFIG.minRingAgl,
          );
        }
        const s = course.start;
        expect(s.y - top(s.x, s.z)).toBeGreaterThanOrEqual(RACE_CONFIG.minRingAgl);
      });

      it('前のリング（1 個目は開始位置）から見える: 地形・建物に遮られず、前方・3km 以内', () => {
        let prev = startAsRing(course);
        for (const r of rings) {
          const a = prev.position;
          const b = r.position;
          const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
          const len = Math.hypot(d.x, d.y, d.z);
          const label = `${r.index + 1} 個目`;
          expect(len, label).toBeLessThanOrEqual(RACE_CONFIG.maxSightDistance);
          expect(minClearance(a, b, top), label).toBeGreaterThanOrEqual(RACE_CONFIG.sightClearance);
          expect(map.buildings?.collides(a, b) ?? false, label).toBe(false);
          // 前のリングを向きどおりに抜けたとき、次のリングが前方（法線から 90° 以内）にある
          const n = prev.normal;
          expect((d.x * n.x + d.y * n.y + d.z * n.z) / len, label).toBeGreaterThan(0);
          prev = r;
        }
      });

      it(`連続するリングの間の必要旋回率が全機体の最大旋回の ${RACE_CONFIG.maxTurnFraction * 100}% 以下`, () => {
        const specs = referenceSpecs();
        expect(specs.map((s) => s.id)).toEqual(['kestrel', 'swift', 'bastion', 'vector']);
        let prev = startAsRing(course);
        for (const r of rings) {
          const leg = legTurn(prev, r);
          for (const spec of specs) {
            const { required, max } = legTurnRate(leg.angle, leg.distance, spec);
            expect(required / max, `${r.index + 1} 個目 ${spec.id}`).toBeLessThanOrEqual(
              RACE_CONFIG.maxTurnFraction,
            );
          }
          prev = r;
        }
      });
    });
  }

  it('旋回の計算: 法線と同じ向きの直線は 0、宙返りの 1/4（半径 R）は速度 / R', () => {
    const spec = referenceSpecs()[0];
    if (!spec) throw new Error('機体がない');
    const a = { position: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: -1 } };
    const b = { position: { x: 0, y: 0, z: -500 }, normal: { x: 0, y: 0, z: -1 } };
    expect(legTurn(a, b).angle).toBeCloseTo(0);
    // 円周上の 2 点（中心角 90°）を接線の向きで抜ける: 角度 90°、距離 R√2
    const R = 500;
    const c = { position: { x: 0, y: R, z: -R }, normal: { x: 0, y: 1, z: 0 } };
    const leg = legTurn(a, c);
    expect(leg.angle).toBeCloseTo(Math.PI / 2);
    expect(leg.distance).toBeCloseTo(R * Math.SQRT2);
    const { required, max } = legTurnRate(leg.angle, leg.distance, spec);
    expect(required).toBeCloseTo((90 * spec.speed.military) / (R * Math.SQRT2));
    // Kestrel のスロットル全開（330 m/s）の最大ピッチ角速度: 75 × 旋回係数 0.91
    expect(max).toBeCloseTo(75 * 0.91, 1);
  });
});
