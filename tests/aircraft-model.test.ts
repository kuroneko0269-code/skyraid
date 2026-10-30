import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { AIRCRAFT_MODEL_CONFIG } from '../src/data/aircraft-model';
import { AIRCRAFT_MODELS } from '../src/data/aircraft';
import { ENEMY_SHAPE, TRANSPORT_SHAPE, type AircraftShape } from '../src/data/aircraft-shapes';
import { resolveLoadout } from '../src/progression/loadout';
import { initialUpgrades } from '../src/progression/save';
import { buildAircraft, type BuiltAircraft } from '../src/render/aircraft-model/build';
import { samplePanel } from '../src/render/aircraft-model/panel-texture';
import {
  MISSILE_PART_BASE,
  PART,
  controlSurfaceAngles,
  loadFactor,
  pylonLayout,
  type SurfaceAngles,
} from '../src/render/aircraft-model/planform';

const DEG = Math.PI / 180;
const budget = AIRCRAFT_MODEL_CONFIG.triangleBudget;

/** 4 機種（Lv0 と武装 Lv5 の積載）+ 敵機 + 輸送機 */
const CASES: { name: string; shape: AircraftShape; missiles: number[] }[] = [
  ...AIRCRAFT_MODELS.map((m) => ({
    name: m.name,
    shape: m.shape,
    missiles: [
      resolveLoadout(m, initialUpgrades()).missiles,
      resolveLoadout(m, { ...initialUpgrades(), weapons: 5 }).missiles,
    ],
  })),
  { name: 'enemy', shape: ENEMY_SHAPE, missiles: [AIRCRAFT_MODEL_CONFIG.enemyMissiles] },
  { name: 'transport', shape: TRANSPORT_SHAPE, missiles: [0] },
];

/** ミサイルの頂点の番号（100 + n）の種類 */
function missileSlots(b: BuiltAircraft): Set<number> {
  const part = b.body.getAttribute('aPart');
  const slots = new Set<number>();
  for (let i = 0; i < part.count; i++) {
    const p = Math.round(part.getX(i));
    if (p > MISSILE_PART_BASE) slots.add(p - MISSILE_PART_BASE);
  }
  return slots;
}

describe('機体モデルの生成器（4-3）', () => {
  for (const c of CASES) {
    for (const missiles of c.missiles) {
      it(`${c.name}（ミサイル ${missiles}）を例外なく作れて、三角形の数が上限内`, () => {
        const high = buildAircraft(c.shape, { detail: 'high', missiles, mergeCanopy: false });
        const low = buildAircraft(c.shape, { detail: 'low', missiles, mergeCanopy: true });
        expect(high.triangles).toBeGreaterThanOrEqual(budget.highMin);
        expect(high.triangles).toBeLessThanOrEqual(budget.highMax);
        expect(low.triangles).toBeLessThanOrEqual(budget.lowMax);
        // index の三角形の数と一致し、頂点の値に NaN がない
        const index = high.body.getIndex();
        const canopy = high.canopy?.getIndex()?.count ?? 0;
        expect(((index?.count ?? 0) + canopy) / 3).toBe(high.triangles);
        for (const name of ['position', 'normal', 'uv', 'color']) {
          const a = high.body.getAttribute(name).array;
          expect(a.every((v) => Number.isFinite(v))).toBe(true);
        }
      });

      it(`${c.name}（ミサイル ${missiles}）のパイロンの数が積載と一致し、番号は 1〜${missiles}`, () => {
        const b = buildAircraft(c.shape, { detail: 'high', missiles, mergeCanopy: true });
        expect(b.pylons).toBe(missiles);
        expect([...missileSlots(b)].sort((x, y) => x - y)).toEqual(
          Array.from({ length: missiles }, (_, i) => i + 1),
        );
      });
    }
  }

  it('全長は 4 機種とも 15m 前後（13.5〜17.5m）、輸送機は 26m', () => {
    for (const m of AIRCRAFT_MODELS) {
      const b = buildAircraft(m.shape, { detail: 'low', missiles: 0, mergeCanopy: true });
      b.body.computeBoundingBox();
      const box = b.body.boundingBox;
      const length = (box?.max.z ?? 0) - (box?.min.z ?? 0);
      expect(length).toBeGreaterThan(13.5);
      expect(length).toBeLessThan(17.5);
    }
    expect(TRANSPORT_SHAPE.length).toBe(26);
  });

  it('双垂直尾翼・双発の機体はノズルが 2 つ、輸送機は 4 発、単発は 1 つ', () => {
    const nozzles = (s: AircraftShape): number =>
      buildAircraft(s, { detail: 'low', missiles: 0, mergeCanopy: true }).nozzles.length;
    expect(nozzles(AIRCRAFT_MODELS[0]?.shape ?? ENEMY_SHAPE)).toBe(1);
    expect(nozzles(AIRCRAFT_MODELS[2]?.shape ?? ENEMY_SHAPE)).toBe(2);
    expect(nozzles(TRANSPORT_SHAPE)).toBe(4);
  });

  it('パイロンは左右対称に並び、奇数なら 1 つは胴体の下', () => {
    const shape = AIRCRAFT_MODELS[0]?.shape ?? ENEMY_SHAPE;
    const spots = pylonLayout(shape, 5);
    expect(spots).toHaveLength(5);
    expect(spots.filter((s) => s.kind === 'center')).toHaveLength(1);
    const sideSum = spots.reduce((sum, s) => sum + s.x, 0);
    expect(sideSum).toBeCloseTo(0, 6);
    expect(spots.filter((s) => s.kind === 'tip')).toHaveLength(2);
  });
});

describe('操舵面の角度（4-3）', () => {
  const out: SurfaceAngles = { aileronLeft: 0, aileronRight: 0, elevator: 0, rudder: 0 };
  const max = AIRCRAFT_MODEL_CONFIG.surfaces.maxDeflectionDeg;

  it('角度は入力に比例し、入力 ±1 で最大 20°（それより大きい入力は 20° で止まる）', () => {
    expect(max).toBe(20);
    for (const x of [-1, -0.5, -0.1, 0, 0.25, 0.7, 1]) {
      controlSurfaceAngles(x, x, x, out);
      expect(out.aileronLeft).toBeCloseTo(x * max * DEG, 10);
      expect(out.aileronRight).toBeCloseTo(-x * max * DEG, 10);
      expect(out.elevator).toBeCloseTo(-x * max * DEG, 10);
      expect(out.rudder).toBeCloseTo(x * max * DEG, 10);
    }
    controlSurfaceAngles(3, -3, 2, out);
    expect(out.elevator).toBeCloseTo(-max * DEG, 10);
    expect(out.aileronLeft).toBeCloseTo(-max * DEG, 10);
    expect(out.rudder).toBeCloseTo(max * DEG, 10);
  });

  /** シェーダーと同じ回し方（ロドリゲスの式）で、操舵面の後縁の点を回す */
  function deflect(b: BuiltAircraft, part: number, angle: number): Vector3 {
    const h = b.hinges[part - 1];
    if (!h) throw new Error('no hinge');
    const pos = b.body.getAttribute('position');
    const parts = b.body.getAttribute('aPart');
    // その部品のいちばん後ろ（後縁）の点
    let best = -1;
    for (let i = 0; i < pos.count; i++) {
      if (Math.round(parts.getX(i)) !== part) continue;
      if (best < 0 || pos.getZ(i) > pos.getZ(best)) best = i;
    }
    const p = new Vector3().fromBufferAttribute(pos, best);
    const before = p.clone();
    const k = new Vector3(h.axis.x, h.axis.y, h.axis.z);
    const o = new Vector3(h.position.x, h.position.y, h.position.z);
    const v = p.sub(o);
    const rotated = v
      .clone()
      .multiplyScalar(Math.cos(angle))
      .add(new Vector3().crossVectors(k, v).multiplyScalar(Math.sin(angle)))
      .add(k.clone().multiplyScalar(k.dot(v) * (1 - Math.cos(angle))));
    return rotated.add(o).sub(before);
  }

  it('右ロールで右のエルロンの後縁が上がり左は下がる、機首上げで水平尾翼の後縁が上がる、機首右でラダーの後縁が右へ', () => {
    const b = buildAircraft(AIRCRAFT_MODELS[3]?.shape ?? ENEMY_SHAPE, {
      detail: 'low',
      missiles: 0,
      mergeCanopy: true,
    });
    controlSurfaceAngles(1, 1, 1, out);
    expect(deflect(b, PART.aileronRight, out.aileronRight).y).toBeGreaterThan(0.1);
    expect(deflect(b, PART.aileronLeft, out.aileronLeft).y).toBeLessThan(-0.1);
    expect(deflect(b, PART.stabilizerLeft, out.elevator).y).toBeGreaterThan(0.1);
    expect(deflect(b, PART.stabilizerRight, out.elevator).y).toBeGreaterThan(0.1);
    expect(deflect(b, PART.rudderLeft, out.rudder).x).toBeGreaterThan(0.1);
    expect(deflect(b, PART.rudderRight, out.rudder).x).toBeGreaterThan(0.1);
  });
});

describe('飛行機雲の G・パネルのテクスチャ（4-3）', () => {
  it('G = ピッチの角速度 × 速度 ÷ 9.8 + 1。巡航 250 m/s で最大ピッチ（75°/s）の約 56% から飛行機雲', () => {
    expect(loadFactor(0, 300)).toBe(1);
    expect(loadFactor(-1, 98)).toBeCloseTo(11, 10);
    const rate = 75 * DEG * 0.56;
    expect(loadFactor(rate, 250)).toBeGreaterThan(19.5);
    expect(loadFactor(rate * 0.9, 250)).toBeLessThan(20);
  });

  it('胴体の後端（排気周り）は中ほどより暗く、主翼の付け根は翼端より暗い', () => {
    const s = { shade: 1, groove: 0 };
    const avg = (u0: number, v0: number, du: number, dv: number): number => {
      let sum = 0;
      for (let i = 0; i < 20; i++) {
        for (let j = 0; j < 20; j++)
          sum += samplePanel(u0 + (du * i) / 20, v0 + (dv * j) / 20, 512, s).shade;
      }
      return sum / 400;
    };
    expect(avg(0.97, 0, 0.02, 0.5)).toBeLessThan(avg(0.5, 0, 0.02, 0.5) * 0.7);
    expect(avg(0.01, 0.52, 0.05, 0.2)).toBeLessThan(avg(0.9, 0.52, 0.05, 0.2) * 0.9);
  });
});
