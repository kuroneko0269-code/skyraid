import { describe, expect, it } from 'vitest';
import { HUD_CONFIG } from '../src/data/hud';
import { multiplyQuat, quatFromRotationVector, quatIdentity, type Quat } from '../src/flight/math';
import {
  attitudeFromQuat,
  changed,
  formatAltitude,
  formatSpeed,
  isGroundWarning,
  isStallWarning,
  ladderRungs,
  ladderTransform,
  radarPoint,
  rungOffsetPx,
  type Attitude,
  type LadderTransform,
  type RadarPoint,
} from '../src/ui/hud-math';

const DEG = Math.PI / 180;

/** 方位（右回り）→ ピッチ → ロール（右が正）の順に回した姿勢 */
function pose(headingDeg: number, pitchDeg: number, rollDeg: number): Quat {
  const yaw = quatFromRotationVector(quatIdentity(), 0, -headingDeg * DEG, 0);
  const pitch = quatFromRotationVector(quatIdentity(), pitchDeg * DEG, 0, 0);
  const roll = quatFromRotationVector(quatIdentity(), 0, 0, -rollDeg * DEG);
  const q = multiplyQuat(quatIdentity(), yaw, pitch);
  return multiplyQuat(quatIdentity(), q, roll);
}

function attitude(q: Quat): Attitude {
  return attitudeFromQuat({ pitch: 0, roll: 0, heading: 0 }, q);
}

describe('表示値の整形', () => {
  it('速度は m/s 相当の値を整数に丸める（負にしない）', () => {
    expect(formatSpeed(250)).toBe('250');
    expect(formatSpeed(249.5)).toBe('250');
    expect(formatSpeed(249.49)).toBe('249');
    expect(formatSpeed(-0.3)).toBe('0');
  });

  it('高度は海面基準の m を整数に丸め、-0 を出さない', () => {
    expect(formatAltitude(500.4)).toBe('500');
    expect(formatAltitude(99.5)).toBe('100');
    expect(formatAltitude(-0.2)).toBe('0');
  });
});

describe('警告しきい値', () => {
  it('地表との距離が 100m 未満で地面接近警告', () => {
    const t = HUD_CONFIG.groundWarningAgl;
    expect(t).toBe(100);
    expect(isGroundWarning(100, t)).toBe(false);
    expect(isGroundWarning(99.9, t)).toBe(true);
    expect(isGroundWarning(500, t)).toBe(false);
  });

  it('失速の度合いが 0 より大きければ STALL', () => {
    const t = HUD_CONFIG.stallThreshold;
    expect(isStallWarning(0, t)).toBe(false);
    expect(isStallWarning(0.01, t)).toBe(true);
  });

  it('changed は epsilon 以上の変化と未表示（NaN）で true', () => {
    expect(changed(NaN, 0, 0.1)).toBe(true);
    expect(changed(1, 1.05, 0.1)).toBe(false);
    expect(changed(1, 1.1, 0.1)).toBe(true);
  });
});

describe('姿勢角', () => {
  it('初期姿勢は水平・方位 0', () => {
    const a = attitude(quatIdentity());
    expect(a.pitch).toBeCloseTo(0);
    expect(a.roll).toBeCloseTo(0);
    expect(a.heading).toBeCloseTo(0);
  });

  it('ピッチ・ロール・方位を取り出せる', () => {
    const a = attitude(pose(90, 20, 30));
    expect(a.heading).toBeCloseTo(90);
    expect(a.pitch).toBeCloseTo(20);
    expect(a.roll).toBeCloseTo(30);

    const b = attitude(pose(225, -15, -60));
    expect(b.heading).toBeCloseTo(225);
    expect(b.pitch).toBeCloseTo(-15);
    expect(b.roll).toBeCloseTo(-60);
  });

  it('背面飛行はロール ±180', () => {
    expect(Math.abs(attitude(pose(0, 0, 180)).roll)).toBeCloseTo(180);
  });
});

describe('ピッチラダー', () => {
  const xf = (pitch: number, roll: number, ppd = 8): LadderTransform =>
    ladderTransform({ rotateDeg: 0, offsetPx: 0 }, pitch, roll, ppd);

  it('右バンクで反時計回り（CSS の rotate は負）に回る', () => {
    expect(xf(0, 30).rotateDeg).toBe(-30);
    expect(xf(0, -45).rotateDeg).toBe(45);
    expect(Object.is(xf(0, 0).rotateDeg, 0)).toBe(true);
  });

  it('機首上げで水平線が下がる（1 度 = pxPerDeg）', () => {
    expect(xf(10, 0).offsetPx).toBe(80);
    expect(xf(-5, 0, 5).offsetPx).toBe(-25);
  });

  it('機体のピッチの目盛りが窓の中央に来る', () => {
    const ppd = 8;
    for (const pitch of [-30, 0, 20]) {
      expect(rungOffsetPx(pitch, ppd) + xf(pitch, 0, ppd).offsetPx).toBe(0);
    }
  });

  it('目盛りは -90〜+90 を 10 度ごと', () => {
    const rungs = ladderRungs(HUD_CONFIG.ladder.stepDeg);
    expect(rungs).toHaveLength(19);
    expect(rungs[0]).toBe(-90);
    expect(rungs[9]).toBe(0);
    expect(rungs[18]).toBe(90);
  });
});

describe('レーダー', () => {
  const pt = (sx: number, sz: number, heading: number, tx: number, tz: number): RadarPoint =>
    radarPoint({ x: 0, y: 0, clamped: false }, sx, sz, heading, tx, tz, 8000);

  it('機首方向（-Z）の目標は真上', () => {
    const p = pt(0, 4500, 0, 0, 0);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(-4500 / 8000);
    expect(p.clamped).toBe(false);
  });

  it('東（+X）を向くと北の目標は左に見える', () => {
    const p = pt(0, 4000, 90, 0, 0);
    expect(p.x).toBeCloseTo(-0.5);
    expect(p.y).toBeCloseTo(0);
  });

  it('範囲外は向きを保って縁に置く', () => {
    const p = pt(0, 0, 0, 16000, 0);
    expect(p.clamped).toBe(true);
    expect(p.x).toBeCloseTo(1);
    expect(p.y).toBeCloseTo(0);
  });
});
