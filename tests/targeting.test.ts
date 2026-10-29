import { describe, expect, it } from 'vitest';
import { inCone, Targeting, type Trackable } from '../src/combat/targeting';
import { TARGETING_CONFIG } from '../src/data/weapons';
import type { Quat, Vec3 } from '../src/flight/math';
import { edgeArrow, formatDistance, pickNearest } from '../src/ui/hud-math';

const DT = 1 / 60;
const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };
const observer = { position: ORIGIN, orientation: IDENTITY };

/** 原点から見て、機首（-Z）から右へ deg 度・距離 d の点にいる対象 */
function at(
  deg: number,
  d: number,
  active = true,
): Trackable & { position: Vec3; active: boolean } {
  const a = (deg * Math.PI) / 180;
  return { position: { x: Math.sin(a) * d, y: 0, z: -Math.cos(a) * d }, active };
}

describe('ロック円錐の判定', () => {
  const f: Vec3 = { x: 0, y: 0, z: -1 };

  it('角度と距離の両方が内側なら true', () => {
    expect(inCone(ORIGIN, f, at(11, 2000).position, 2500, 12)).toBe(true);
    expect(inCone(ORIGIN, f, at(13, 2000).position, 2500, 12)).toBe(false);
    expect(inCone(ORIGIN, f, at(5, 2600).position, 2500, 12)).toBe(false);
    // 真後ろ
    expect(inCone(ORIGIN, f, at(180, 100).position, 2500, 12)).toBe(false);
  });
});

describe('ターゲットの選択', () => {
  it('索敵範囲（距離・視野角）内の対象を機首に近い順に並べ、既定は機首に最も近い対象', () => {
    const near = at(5, 3000);
    const mid = at(-20, 1000);
    const wide = at(70, 1000);
    const far = at(0, 6000);
    const t = new Targeting();
    t.step(observer, [mid, wide, far, near], false, DT);
    expect(t.candidates).toEqual([near, mid]);
    expect(t.selected).toBe(near);
  });

  it('targetNext で機首に近い順に切り替わり、末尾の次は先頭', () => {
    const a = at(2, 1000);
    const b = at(10, 1000);
    const c = at(-30, 1000);
    const t = new Targeting();
    t.step(observer, [a, b, c], false, DT);
    expect(t.selected).toBe(a);
    t.step(observer, [a, b, c], true, DT);
    expect(t.selected).toBe(b);
    t.step(observer, [a, b, c], true, DT);
    expect(t.selected).toBe(c);
    t.step(observer, [a, b, c], true, DT);
    expect(t.selected).toBe(a);
  });

  it('選択中の対象が撃墜されたら自動で次の対象へ', () => {
    const a = at(1, 1000);
    const b = at(15, 1000);
    const t = new Targeting();
    t.step(observer, [a, b], false, DT);
    expect(t.selected).toBe(a);
    a.active = false;
    t.step(observer, [a, b], false, DT);
    expect(t.selected).toBe(b);
  });

  it('視野の外へ出ても keepRange 内なら選んだまま（画面外の矢印で示す）', () => {
    const a = at(1, 1000);
    const t = new Targeting();
    t.step(observer, [a], false, DT);
    a.position.x = 1000;
    a.position.z = 500;
    t.step(observer, [a], false, DT);
    expect(t.candidates).toEqual([]);
    expect(t.selected).toBe(a);
    a.position.x = TARGETING_CONFIG.keepRange + 1;
    t.step(observer, [a], false, DT);
    expect(t.selected).toBeNull();
  });
});

describe('ロックオンの時間', () => {
  const spec = TARGETING_CONFIG;

  it('ロック円錐に lockSeconds 入り続けるとロック完了', () => {
    const a = at(spec.lockConeDeg - 1, spec.lockRange - 100);
    const t = new Targeting();
    const steps = Math.round(spec.lockSeconds / DT);
    for (let i = 0; i < steps - 1; i++) t.step(observer, [a], false, DT);
    expect(t.locked).toBe(false);
    t.step(observer, [a], false, DT);
    expect(t.locked).toBe(true);
  });

  it('円錐の外（索敵範囲内）ではロックが進まない', () => {
    const a = at(spec.lockConeDeg + 2, 1000);
    const t = new Targeting();
    for (let i = 0; i < 300; i++) t.step(observer, [a], false, DT);
    expect(t.selected).toBe(a);
    expect(t.lockProgress).toBe(0);
  });

  it('外れるとゲージが lockDecaySeconds で減り、戻ればそこから再開する', () => {
    const a = at(0, 1000);
    const t = new Targeting();
    for (let i = 0; i < Math.round(spec.lockSeconds / 2 / DT); i++)
      t.step(observer, [a], false, DT);
    expect(t.lockProgress).toBeCloseTo(0.5, 1);
    a.position.x = 400; // 約 22°
    for (let i = 0; i < Math.round(spec.lockDecaySeconds / 4 / DT); i++)
      t.step(observer, [a], false, DT);
    expect(t.lockProgress).toBeCloseTo(0.25, 1);
    a.position.x = 0;
    t.step(observer, [a], false, DT);
    expect(t.lockProgress).toBeGreaterThan(0.25);
  });

  it('対象を切り替えるとロックはやり直し', () => {
    const a = at(0, 1000);
    const b = at(3, 1000);
    const t = new Targeting();
    for (let i = 0; i < 120; i++) t.step(observer, [a, b], false, DT);
    expect(t.locked).toBe(true);
    t.step(observer, [a, b], true, DT);
    expect(t.selected).toBe(b);
    expect(t.lockProgress).toBeLessThan(0.1);
  });
});

describe('HUD の対象マーカーの計算', () => {
  it('画面外の対象の矢印は、対象の方向の画面端（margin 内側）に置く', () => {
    const out = { x: 0, y: 0, deg: 0 };
    // 右の画面外
    edgeArrow(out, 3, 0, false, 1000, 600, 40);
    expect(out.x).toBeCloseTo(960);
    expect(out.y).toBeCloseTo(300);
    expect(out.deg).toBeCloseTo(0);
    // 上の画面外（ndc の y は上が正、画面の y は下が正）
    edgeArrow(out, 0, 5, false, 1000, 600, 40);
    expect(out.y).toBeCloseTo(40);
    expect(out.deg).toBeCloseTo(-90);
    // カメラの後ろで投影が反転した点は向きを戻す（投影 x が負 = 実際は右）
    edgeArrow(out, -0.5, 0, true, 1000, 600, 40);
    expect(out.x).toBeCloseTo(960);
  });

  it('タップは半径内で最も近いマーカーを選ぶ', () => {
    const pts = [
      { x: 100, y: 100 },
      { x: 130, y: 100 },
      { x: 500, y: 500 },
    ];
    expect(pickNearest(pts, 3, 125, 100, 48)).toBe(1);
    expect(pickNearest(pts, 3, 300, 300, 48)).toBe(-1);
    // count より後ろは見ない
    expect(pickNearest(pts, 2, 500, 500, 48)).toBe(-1);
  });

  it('距離の表示', () => {
    expect(formatDistance(850.4)).toBe('850 m');
    expect(formatDistance(999.7)).toBe('1.0 km');
    expect(formatDistance(1849)).toBe('1.8 km');
  });
});
