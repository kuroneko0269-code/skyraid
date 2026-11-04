// 傾き操作・ドラッグ操作（9-4。src/core/tilt.ts）: 端末の持ち方（deviceorientation の β・γ と画面の向き）→ スティックの値
import { describe, expect, it } from 'vitest';
import { dragStick, screenUp, TiltReader } from '../src/core/tilt';
import { DRAG_CONFIG, TILT_CONFIG } from '../src/data/steer';

const DEG = Math.PI / 180;

/**
 * 人の持ち方 → deviceorientation の値。back: 画面を奥へ寝かせた角度（0 = 立てる）、right: 右へ傾けた角度（ハンドルを右へ切る向き）、
 * toward: 上端を手前へ傾けた角度、angle: 画面の向き（90 = 端末の上端が左の横向き、270 = 右の横向き、0 = 縦）
 */
function pose(angle: number, back: number, right = 0, toward = 0): [number, number] {
  const b = (back - toward) * DEG;
  const a = right * DEG;
  // 画面の座標での上の向き
  const sx = -Math.sin(a) * Math.cos(b);
  const sy = Math.cos(a) * Math.cos(b);
  const sz = Math.sin(b);
  // 端末の座標へ（screenUp の逆）
  const th = angle * DEG;
  const dx = sx * Math.cos(th) + sy * Math.sin(th);
  const dy = -sx * Math.sin(th) + sy * Math.cos(th);
  const dz = sz;
  const beta = Math.asin(dy) / DEG;
  const gamma = Math.atan2(-dx, dz) / DEG;
  return [beta, gamma];
}

function feed(r: TiltReader, angle: number, p: [number, number], ms: number, seconds = 1): void {
  // 60Hz でしばらく同じ持ち方（平滑が追いつく）
  for (let i = 0; i <= seconds * 60; i++) r.read(p[0], p[1], angle, ms + (i * 1000) / 60);
}

describe('画面から見た上の向き', () => {
  it('縦に立てて持つと画面の上、机に置くと画面の手前', () => {
    const u = { x: 0, y: 0, z: 0 };
    screenUp(90, 0, 0, u);
    expect(u.y).toBeCloseTo(1, 6);
    screenUp(0, 0, 0, u);
    expect(u.z).toBeCloseTo(1, 6);
  });

  it('横向き（左右どちら）でも、立てて持つと画面の上', () => {
    const u = { x: 0, y: 0, z: 0 };
    for (const angle of [90, 270]) {
      const [b, g] = pose(angle, 0.0001);
      screenUp(b, g, angle, u);
      expect(u.y, String(angle)).toBeCloseTo(1, 4);
      expect(Math.abs(u.x), String(angle)).toBeLessThan(1e-4);
    }
  });
});

describe('傾き → スティックの値', () => {
  for (const angle of [90, 270, 0]) {
    it(`画面の向き ${angle}°: 飛び始めの持ち方が中立、右・手前・奥・左で旋回・上昇・下降`, () => {
      const r = new TiltReader();
      feed(r, angle, pose(angle, 40), 0);
      expect(r.value.x).toBe(0);
      expect(r.value.y).toBe(0);
      feed(r, angle, pose(angle, 40, 15), 1000);
      expect(r.value.x).toBeGreaterThan(0.2);
      expect(Math.abs(r.value.y)).toBeLessThan(0.05);
      feed(r, angle, pose(angle, 40, -15), 2000);
      expect(r.value.x).toBeLessThan(-0.2);
      feed(r, angle, pose(angle, 40, 0, 15), 3000);
      expect(r.value.y).toBeGreaterThan(0.2);
      expect(Math.abs(r.value.x)).toBeLessThan(0.05);
      feed(r, angle, pose(angle, 40, 0, -15), 4000);
      expect(r.value.y).toBeLessThan(-0.2);
    });
  }

  it('手前へ大きく傾け続けると上へ端まで（宙返りの 0.9 以上）。小さな揺れはデッドゾーンで 0', () => {
    const r = new TiltReader();
    feed(r, 90, pose(90, 45), 0);
    feed(r, 90, pose(90, 45, 0, TILT_CONFIG.fullPitchDeg + 3), 1000);
    expect(r.value.y).toBeGreaterThanOrEqual(0.9);
    feed(r, 90, pose(90, 45, 2, 1.5), 2000);
    expect(r.value.x).toBe(0);
    expect(r.value.y).toBe(0);
  });

  it('合わせ直すと今の持ち方が中立。画面の向きが変わったら（持ち替え）自動で合わせ直す', () => {
    const r = new TiltReader();
    feed(r, 90, pose(90, 40), 0);
    feed(r, 90, pose(90, 20), 1000);
    expect(r.value.y).toBeGreaterThan(0.5);
    r.calibrate();
    feed(r, 90, pose(90, 20), 2000);
    expect(r.value.y).toBe(0);
    // 左右を持ち替える（270°）: その持ち方が中立
    feed(r, 270, pose(270, 35), 3000);
    expect(r.value.x).toBe(0);
    expect(r.value.y).toBe(0);
    feed(r, 270, pose(270, 35, 15), 4000);
    expect(r.value.x).toBeGreaterThan(0.2);
  });

  it('値はなめらかに追う（急に傾けても 1 回目の値は端まで行かない）', () => {
    const r = new TiltReader();
    feed(r, 90, pose(90, 40), 0);
    const p = pose(90, 40, 30);
    r.read(p[0], p[1], 90, 1000 + 1000 / 60);
    expect(r.value.x).toBeGreaterThan(0);
    expect(r.value.x).toBeLessThan(0.5);
  });

  it('値の無い端末（β・γ が null）は読めない', () => {
    const r = new TiltReader();
    expect(r.read(null, null, 0, 0)).toBe(false);
    expect(r.received).toBe(false);
  });
});

describe('ドラッグ → スティックの値', () => {
  const W = 844;
  const H = 390;
  const v = { x: 0, y: 0 };
  it('中央は 0、右は右、上は上。画面の上端の近くは上へ端まで（宙返り）', () => {
    dragStick(W / 2, H / 2, W, H, DRAG_CONFIG.radiusRatio, v);
    expect(v).toEqual({ x: 0, y: 0 });
    dragStick(W / 2 + 60, H / 2, W, H, DRAG_CONFIG.radiusRatio, v);
    expect(v.x).toBeCloseTo(60 / (H * DRAG_CONFIG.radiusRatio), 6);
    expect(v.y).toBeCloseTo(0, 6);
    dragStick(W / 2, 10, W, H, DRAG_CONFIG.radiusRatio, v);
    expect(v.y).toBeGreaterThanOrEqual(0.9);
    dragStick(W / 2, H - 10, W, H, DRAG_CONFIG.radiusRatio, v);
    expect(v.y).toBeLessThanOrEqual(-0.9);
  });

  it('隅は向きを保って長さ 1 で頭打ち', () => {
    dragStick(W, 0, W, H, DRAG_CONFIG.radiusRatio, v);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 6);
    expect(v.x).toBeGreaterThan(v.y);
  });

  it('画面が右へ 90° 傾いていると、画面の上（機体の背中の側）を押さえると右へ。90° より深くは戻さない', () => {
    dragStick(W / 2, H / 2 - 80, W, H, DRAG_CONFIG.radiusRatio, v, Math.PI / 2);
    expect(v.x).toBeGreaterThan(0.4);
    expect(Math.abs(v.y)).toBeLessThan(1e-9);
    // 背面（180°）でも 90° として扱う（上下が入れ替わらない）
    dragStick(W / 2, H / 2 - 80, W, H, DRAG_CONFIG.radiusRatio, v, Math.PI);
    expect(v.x).toBeGreaterThan(0.4);
  });
});
